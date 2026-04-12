package collector

import (
	"bufio"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// ProcessData is the snapshot data for the process collector.
type ProcessData struct {
	Total     int
	Zombies   int
	OOMKills  int
	Top       []ProcessInfo
}

// ProcessInfo holds per-process resource usage.
type ProcessInfo struct {
	PID  int32
	Name string
	User string
	CPU  float64
	RAM  float64
}

type processCollector struct {
	prevOOMCount int
	oomInited    bool
}

func NewProcess() Collector {
	return &processCollector{}
}

func (c *processCollector) Name() string     { return "process" }
func (c *processCollector) Cadence() Cadence { return CadenceStandard }
func (c *processCollector) Enabled() bool    { return true }

func (c *processCollector) Init() error {
	c.prevOOMCount = countOOMKills()
	c.oomInited = true
	return nil
}

func (c *processCollector) Collect() (*Snapshot, error) {
	var d ProcessData

	pids, err := process.Pids()
	if err == nil {
		d.Total = len(pids)
	}

	// Sample up to 200 processes to bound cost.
	procs, _ := process.Processes()
	limit := 200
	if len(procs) < limit {
		limit = len(procs)
	}

	type procSample struct {
		info ProcessInfo
		cpu  float64
		ram  float64
	}
	var samples []procSample

	for i := 0; i < limit; i++ {
		p := procs[i]
		name, _ := p.Name()
		user, _ := p.Username()
		status, _ := p.Status()

		// Count zombies.
		for _, s := range status {
			if s == "zombie" || s == "Z" {
				d.Zombies++
			}
		}

		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		samples = append(samples, procSample{
			info: ProcessInfo{
				PID:  p.Pid,
				Name: name,
				User: user,
				CPU:  cpuPct,
				RAM:  float64(memPct),
			},
			cpu: cpuPct,
			ram: float64(memPct),
		})
	}

	// Top 5 by CPU.
	sort.Slice(samples, func(i, j int) bool { return samples[i].cpu > samples[j].cpu })
	topN := 5
	if len(samples) < topN {
		topN = len(samples)
	}
	for i := 0; i < topN; i++ {
		d.Top = append(d.Top, samples[i].info)
	}

	// OOM kills (delta since last check).
	curOOM := countOOMKills()
	if c.oomInited {
		d.OOMKills = curOOM - c.prevOOMCount
		if d.OOMKills < 0 {
			d.OOMKills = 0
		}
	}
	c.prevOOMCount = curOOM
	c.oomInited = true

	return &Snapshot{Key: "process", Data: d, At: time.Now()}, nil
}

// countOOMKills counts OOM kill lines in /dev/kmsg or /var/log/kern.log.
func countOOMKills() int {
	count := 0
	// Try /var/log/kern.log first, then dmesg output via /dev/kmsg.
	for _, path := range []string{"/var/log/kern.log", "/var/log/syslog", "/var/log/messages"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.ToLower(scanner.Text())
			if strings.Contains(line, "killed process") || strings.Contains(line, "oom-killer") {
				count++
			}
		}
		f.Close()
		return count
	}
	return 0
}

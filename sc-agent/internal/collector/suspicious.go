package collector

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// Known crypto miner process names (lowercase).
var knownMiners = []string{
	"xmrig", "minerd", "kdevtmpfsi", "kinsing", "xmr-stak",
	"cpuminer", "cryptonight", "minergate", "ethminer", "nicehash",
	"hashvault", "nanopool", "ccminer", "cgminer", "bfgminer",
	"nbminer", "t-rex", "phoenixminer", "lolminer", "gminer",
}

// Suspicious command-line keywords.
var suspiciousCmdKeywords = []string{
	"stratum+tcp", "stratum+ssl", "pool.minexmr", "xmrpool",
	"moneroocean", "hashrate", "nanopool.org", "f2pool",
}

// Shell process names (for reverse shell parent detection).
var shellNames = map[string]bool{
	"bash": true, "sh": true, "zsh": true, "dash": true,
	"csh": true, "ksh": true, "fish": true, "ash": true,
}

// Suspicious binary paths — processes running from temp/writable dirs.
var suspiciousPaths = []string{"/tmp/", "/dev/shm/", "/var/tmp/", "/run/user/"}

// SuspiciousData is the snapshot data for the suspicious process collector.
type SuspiciousData struct {
	Detections []SuspiciousDetection
}

// SuspiciousDetection represents a single suspicious process finding.
type SuspiciousDetection struct {
	PID        int32
	Name       string
	User       string
	CPU        float64
	RAM        float64
	Cmdline    string
	ParentName string
	Reason     string // "known_miner", "high_cpu_sustained", "reverse_shell", "suspicious_path"
	HasNetwork bool
	Duration   int // seconds at high CPU (for sustained detection)
}

type suspiciousCollector struct {
	mu       sync.Mutex
	highCPU  map[int32]time.Time // PID → first seen above threshold
}

func NewSuspicious() Collector {
	return &suspiciousCollector{
		highCPU: make(map[int32]time.Time),
	}
}

func (c *suspiciousCollector) Name() string     { return "suspicious" }
func (c *suspiciousCollector) Cadence() Cadence { return CadenceStandard }
func (c *suspiciousCollector) Enabled() bool    { return true }
func (c *suspiciousCollector) Init() error      { return nil }

func (c *suspiciousCollector) Collect() (*Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var detections []SuspiciousDetection

	procs, err := process.Processes()
	if err != nil {
		return &Snapshot{Key: "suspicious", Data: SuspiciousData{}, At: time.Now()}, nil
	}

	limit := 200
	if len(procs) < limit {
		limit = len(procs)
	}

	seenPIDs := make(map[int32]bool)
	now := time.Now()

	for i := 0; i < limit; i++ {
		p := procs[i]
		name, _ := p.Name()
		if name == "" {
			continue
		}
		nameLower := strings.ToLower(name)
		seenPIDs[p.Pid] = true

		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		cmdline, _ := p.Cmdline()
		cmdlineLower := strings.ToLower(cmdline)

		user, _ := p.Username()

		// --- Check 1: Known crypto miner name ---
		if matchesMiner(nameLower, cmdlineLower) {
			det := SuspiciousDetection{
				PID: p.Pid, Name: name, User: user,
				CPU: cpuPct, RAM: float64(memPct),
				Cmdline: truncate(cmdline, 500),
				Reason:  "known_miner",
			}
			det.ParentName = parentName(p)
			det.HasNetwork = hasEstablishedConn(p.Pid)
			detections = append(detections, det)
			continue
		}

		// --- Check 2: Suspicious binary path ---
		exe, _ := p.Exe()
		if exe != "" && inSuspiciousPath(exe) && cpuPct > 5 {
			det := SuspiciousDetection{
				PID: p.Pid, Name: name, User: user,
				CPU: cpuPct, RAM: float64(memPct),
				Cmdline: truncate(cmdline, 500),
				Reason:  "suspicious_path",
			}
			det.ParentName = parentName(p)
			det.HasNetwork = hasEstablishedConn(p.Pid)
			detections = append(detections, det)
			continue
		}

		// --- Check 3: Sustained high CPU (>50% for 3+ minutes) ---
		if cpuPct > 50 {
			if firstSeen, ok := c.highCPU[p.Pid]; ok {
				dur := int(now.Sub(firstSeen).Seconds())
				if dur >= 180 {
					det := SuspiciousDetection{
						PID: p.Pid, Name: name, User: user,
						CPU: cpuPct, RAM: float64(memPct),
						Cmdline:  truncate(cmdline, 500),
						Reason:   "high_cpu_sustained",
						Duration: dur,
					}
					det.ParentName = parentName(p)
					det.HasNetwork = hasEstablishedConn(p.Pid)
					detections = append(detections, det)
				}
			} else {
				c.highCPU[p.Pid] = now
			}
		} else {
			delete(c.highCPU, p.Pid)
		}

		// --- Check 4: Reverse shell — network conn + shell parent ---
		if hasEstablishedConn(p.Pid) {
			pname := parentName(p)
			if shellNames[strings.ToLower(pname)] {
				det := SuspiciousDetection{
					PID: p.Pid, Name: name, User: user,
					CPU: cpuPct, RAM: float64(memPct),
					Cmdline:    truncate(cmdline, 500),
					ParentName: pname,
					Reason:     "reverse_shell",
					HasNetwork: true,
				}
				detections = append(detections, det)
			}
		}
	}

	// Prune stale PIDs from highCPU tracker.
	for pid := range c.highCPU {
		if !seenPIDs[pid] {
			delete(c.highCPU, pid)
		}
	}

	return &Snapshot{Key: "suspicious", Data: SuspiciousData{Detections: detections}, At: now}, nil
}

// --- helpers ---

func matchesMiner(nameLower, cmdlineLower string) bool {
	for _, m := range knownMiners {
		if strings.Contains(nameLower, m) {
			return true
		}
	}
	for _, kw := range suspiciousCmdKeywords {
		if strings.Contains(cmdlineLower, kw) {
			return true
		}
	}
	return false
}

func inSuspiciousPath(exe string) bool {
	for _, p := range suspiciousPaths {
		if strings.HasPrefix(exe, p) {
			return true
		}
	}
	return false
}

func parentName(p *process.Process) string {
	parent, err := p.Parent()
	if err != nil || parent == nil {
		return ""
	}
	name, _ := parent.Name()
	return name
}

func hasEstablishedConn(pid int32) bool {
	conns, err := net.ConnectionsPid("tcp", pid)
	if err != nil {
		return false
	}
	for _, c := range conns {
		if c.Status == "ESTABLISHED" {
			return true
		}
	}
	return false
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func init() {
	// Ensure SuspiciousData satisfies the interface used by Snapshot.Data
	_ = SuspiciousData{}
	_ = fmt.Sprintf("")
}

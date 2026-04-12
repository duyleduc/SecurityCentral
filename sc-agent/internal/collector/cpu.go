package collector

import (
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/load"
)

// CPUData is the snapshot data for the CPU collector.
type CPUData struct {
	Percent float64
	IOWait  float64
	Load1   float64
	Load5   float64
	Load15  float64
}

// cpuCollector collects CPU utilization, iowait, and load averages.
type cpuCollector struct {
	prevTimes cpu.TimesStat
	inited    bool
}

func NewCPU() Collector {
	return &cpuCollector{}
}

func (c *cpuCollector) Name() string     { return "cpu" }
func (c *cpuCollector) Cadence() Cadence { return CadenceFast }
func (c *cpuCollector) Enabled() bool    { return true }
func (c *cpuCollector) Init() error {
	// Take a baseline CPU times reading so the first Collect() has a delta.
	times, err := cpu.Times(false)
	if err == nil && len(times) > 0 {
		c.prevTimes = times[0]
		c.inited = true
	}
	return nil
}

func (c *cpuCollector) Collect() (*Snapshot, error) {
	var d CPUData

	// CPU utilization + iowait via delta
	times, err := cpu.Times(false)
	if err == nil && len(times) > 0 {
		cur := times[0]
		if c.inited {
			p := c.prevTimes
			totalDelta := (cur.User - p.User) + (cur.System - p.System) +
				(cur.Idle - p.Idle) + (cur.Nice - p.Nice) +
				(cur.Iowait - p.Iowait) + (cur.Irq - p.Irq) +
				(cur.Softirq - p.Softirq) + (cur.Steal - p.Steal)
			if totalDelta > 0 {
				busyDelta := totalDelta - (cur.Idle - p.Idle)
				d.Percent = (busyDelta / totalDelta) * 100
				d.IOWait = ((cur.Iowait - p.Iowait) / totalDelta) * 100
			}
		}
		c.prevTimes = cur
		c.inited = true
	}

	// Load averages
	la, err := load.Avg()
	if err == nil && la != nil {
		d.Load1 = la.Load1
		d.Load5 = la.Load5
		d.Load15 = la.Load15
	}

	return &Snapshot{Key: "cpu", Data: d, At: time.Now()}, nil
}

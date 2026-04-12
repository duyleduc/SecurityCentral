package collector

import (
	"time"

	"github.com/shirou/gopsutil/v3/mem"
)

// MemoryData is the snapshot data for the memory collector.
type MemoryData struct {
	UsedPercent float64
	SwapUsedPct float64
}

// memoryCollector collects RAM and swap utilization.
type memoryCollector struct{}

func NewMemory() Collector {
	return &memoryCollector{}
}

func (c *memoryCollector) Name() string     { return "memory" }
func (c *memoryCollector) Cadence() Cadence { return CadenceFast }
func (c *memoryCollector) Enabled() bool    { return true }
func (c *memoryCollector) Init() error      { return nil }

func (c *memoryCollector) Collect() (*Snapshot, error) {
	var d MemoryData

	vmem, err := mem.VirtualMemory()
	if err == nil && vmem != nil {
		d.UsedPercent = vmem.UsedPercent
	}

	swap, err := mem.SwapMemory()
	if err == nil && swap != nil && swap.Total > 0 {
		d.SwapUsedPct = swap.UsedPercent
	}

	return &Snapshot{Key: "memory", Data: d, At: time.Now()}, nil
}

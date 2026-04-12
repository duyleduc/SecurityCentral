package collector

import (
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// DiskData is the snapshot data for the disk collector.
type DiskData struct {
	UsedPercent float64
	ReadBps     uint64
	WriteBps    uint64
	IOUtilPct   float64
}

// diskCollector collects disk space usage and I/O throughput.
type diskCollector struct {
	prevIO     map[string]disk.IOCountersStat
	prevTime   time.Time
	prevInited bool
}

func NewDisk() Collector {
	return &diskCollector{}
}

func (c *diskCollector) Name() string     { return "disk" }
func (c *diskCollector) Cadence() Cadence { return CadenceStandard }
func (c *diskCollector) Enabled() bool    { return true }

func (c *diskCollector) Init() error {
	// Baseline I/O counters for delta calculation.
	counters, err := disk.IOCounters()
	if err == nil {
		c.prevIO = counters
		c.prevTime = time.Now()
		c.prevInited = true
	}
	return nil
}

func (c *diskCollector) Collect() (*Snapshot, error) {
	now := time.Now()
	var d DiskData

	// Disk space
	du, err := disk.Usage("/")
	if err == nil && du != nil {
		d.UsedPercent = du.UsedPercent
	}

	// Disk I/O (delta)
	counters, err := disk.IOCounters()
	if err == nil && c.prevInited {
		elapsed := now.Sub(c.prevTime).Seconds()
		if elapsed <= 0 {
			elapsed = 1
		}

		var totalRead, totalWrite, totalWeighted uint64
		for name, cur := range counters {
			if p, ok := c.prevIO[name]; ok {
				totalRead += cur.ReadBytes - p.ReadBytes
				totalWrite += cur.WriteBytes - p.WriteBytes
				totalWeighted += cur.WeightedIO - p.WeightedIO
			}
		}

		d.ReadBps = uint64(float64(totalRead) / elapsed)
		d.WriteBps = uint64(float64(totalWrite) / elapsed)
		d.IOUtilPct = float64(totalWeighted) / (elapsed * 1000) * 100
		if d.IOUtilPct > 100 {
			d.IOUtilPct = 100
		}
	}

	if err == nil {
		c.prevIO = counters
		c.prevTime = now
		c.prevInited = true
	}

	return &Snapshot{Key: "disk", Data: d, At: now}, nil
}

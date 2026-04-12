package collector

import (
	"time"

	gopsNet "github.com/shirou/gopsutil/v3/net"
)

// NetworkData is the snapshot data for the network collector.
type NetworkData struct {
	RxBytesPerSec uint64
	TxBytesPerSec uint64
	Errors        uint64
	Drops         uint64
	Interfaces    []IfaceData
	TCPActive     int
}

// IfaceData holds per-interface delta counters.
type IfaceData struct {
	Name    string
	RxBytes uint64
	TxBytes uint64
	Errors  uint64
	Drops   uint64
}

// networkCollector collects per-interface network I/O and TCP connection count.
type networkCollector struct {
	prevIO     map[string]gopsNet.IOCountersStat
	prevTime   time.Time
	prevInited bool
}

func NewNetwork() Collector {
	return &networkCollector{}
}

func (c *networkCollector) Name() string     { return "network" }
func (c *networkCollector) Cadence() Cadence { return CadenceStandard }
func (c *networkCollector) Enabled() bool    { return true }

func (c *networkCollector) Init() error {
	counters, err := gopsNet.IOCounters(true)
	if err == nil {
		c.prevIO = toNetMap(counters)
		c.prevTime = time.Now()
		c.prevInited = true
	}
	return nil
}

func (c *networkCollector) Collect() (*Snapshot, error) {
	now := time.Now()
	var d NetworkData

	counters, err := gopsNet.IOCounters(true)
	if err == nil {
		curMap := toNetMap(counters)

		if c.prevInited {
			elapsed := now.Sub(c.prevTime).Seconds()
			if elapsed <= 0 {
				elapsed = 1
			}

			var totalRx, totalTx, totalErr, totalDrop uint64
			for name, cur := range curMap {
				if p, ok := c.prevIO[name]; ok {
					rxD := cur.BytesRecv - p.BytesRecv
					txD := cur.BytesSent - p.BytesSent
					errD := (cur.Errin - p.Errin) + (cur.Errout - p.Errout)
					dropD := (cur.Dropin - p.Dropin) + (cur.Dropout - p.Dropout)
					totalRx += rxD
					totalTx += txD
					totalErr += errD
					totalDrop += dropD

					d.Interfaces = append(d.Interfaces, IfaceData{
						Name:    name,
						RxBytes: uint64(float64(rxD) / elapsed),
						TxBytes: uint64(float64(txD) / elapsed),
						Errors:  errD,
						Drops:   dropD,
					})
				}
			}

			d.RxBytesPerSec = uint64(float64(totalRx) / elapsed)
			d.TxBytesPerSec = uint64(float64(totalTx) / elapsed)
			d.Errors = totalErr
			d.Drops = totalDrop
		}

		c.prevIO = curMap
		c.prevTime = now
		c.prevInited = true
	}

	// TCP active connections
	conns, err := gopsNet.Connections("tcp")
	if err == nil {
		for _, conn := range conns {
			if conn.Status == "ESTABLISHED" {
				d.TCPActive++
			}
		}
	}

	return &Snapshot{Key: "network", Data: d, At: now}, nil
}

func toNetMap(counters []gopsNet.IOCountersStat) map[string]gopsNet.IOCountersStat {
	m := make(map[string]gopsNet.IOCountersStat, len(counters))
	for _, c := range counters {
		if c.Name == "lo" || c.Name == "lo0" {
			continue
		}
		m[c.Name] = c
	}
	return m
}

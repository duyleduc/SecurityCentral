package agent

import (
	"sync"

	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

const ringBufferSize = 60

// RingBuffer stores the last N metric samples.
type RingBuffer struct {
	mu      sync.Mutex
	samples []sysinfo.Metrics
	pos     int
	full    bool
}

func NewRingBuffer() *RingBuffer {
	return &RingBuffer{
		samples: make([]sysinfo.Metrics, ringBufferSize),
	}
}

func (rb *RingBuffer) Push(m sysinfo.Metrics) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.samples[rb.pos] = m
	rb.pos = (rb.pos + 1) % ringBufferSize
	if rb.pos == 0 {
		rb.full = true
	}
}

// Aggregate returns avg/max over collected samples.
func (rb *RingBuffer) Aggregate() platform.MetricsData {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	count := rb.pos
	if rb.full {
		count = ringBufferSize
	}
	if count == 0 {
		return platform.MetricsData{}
	}

	var cpuSum, cpuMax, ioWaitSum float64
	var ramSum, ramMax float64
	var swapLast float64
	var diskLast float64
	var diskReadBps, diskWriteBps uint64
	var diskIOUtil float64
	var loadAvg1, loadAvg5, loadAvg15 float64
	var netRx, netTx, netErrors, netDrops uint64

	for i := 0; i < count; i++ {
		s := rb.samples[i]
		cpuSum += s.CPUPercent
		if s.CPUPercent > cpuMax {
			cpuMax = s.CPUPercent
		}
		ioWaitSum += s.CPUIOWait
		ramSum += s.RAMPercent
		if s.RAMPercent > ramMax {
			ramMax = s.RAMPercent
		}
	}

	// Use latest sample for point-in-time values
	latest := rb.samples[(rb.pos-1+ringBufferSize)%ringBufferSize]
	diskLast = latest.DiskPercent
	swapLast = latest.SwapUsedPct
	loadAvg1 = latest.LoadAvg1
	loadAvg5 = latest.LoadAvg5
	loadAvg15 = latest.LoadAvg15
	diskReadBps = latest.DiskReadBps
	diskWriteBps = latest.DiskWriteBps
	diskIOUtil = latest.DiskIOUtil
	netRx = latest.NetRxBytes
	netTx = latest.NetTxBytes
	netErrors = latest.NetErrors
	netDrops = latest.NetDrops

	var ifaces []platform.IfaceMetric
	for _, ifc := range latest.Interfaces {
		ifaces = append(ifaces, platform.IfaceMetric{
			Name:    ifc.Name,
			RxBytes: ifc.RxBytes,
			TxBytes: ifc.TxBytes,
			Errors:  ifc.RxErrors + ifc.TxErrors,
			Drops:   ifc.Drops,
		})
	}

	n := float64(count)
	return platform.MetricsData{
		CPU: platform.CPUMetrics{
			Avg:    cpuSum / n,
			Max:    cpuMax,
			IOWait: ioWaitSum / n,
		},
		RAM: platform.RAMMetrics{
			Avg:         ramSum / n,
			Max:         ramMax,
			SwapUsedPct: swapLast,
		},
		Disk: platform.DiskMetrics{
			Usage:     diskLast,
			IOErrors:  0,
			ReadBps:   diskReadBps,
			WriteBps:  diskWriteBps,
			IOUtilPct: diskIOUtil,
		},
		Load: platform.LoadMetrics{
			Load1:  loadAvg1,
			Load5:  loadAvg5,
			Load15: loadAvg15,
		},
		Network: platform.NetworkMetrics{
			RxBytesPerSec: netRx,
			TxBytesPerSec: netTx,
			Errors:        netErrors,
			Drops:         netDrops,
			Interfaces:    ifaces,
		},
	}
}

// AlertBuffer collects alerts from threshold checks.
type AlertBuffer struct {
	mu     sync.Mutex
	alerts []platform.Alert
}

func NewAlertBuffer() *AlertBuffer {
	return &AlertBuffer{}
}

func (ab *AlertBuffer) Push(alerts []platform.Alert) {
	if len(alerts) == 0 {
		return
	}
	ab.mu.Lock()
	defer ab.mu.Unlock()
	ab.alerts = append(ab.alerts, alerts...)
}

func (ab *AlertBuffer) Drain() []platform.Alert {
	ab.mu.Lock()
	defer ab.mu.Unlock()
	out := ab.alerts
	ab.alerts = nil
	return out
}

func (ab *AlertBuffer) HasAlerts() bool {
	ab.mu.Lock()
	defer ab.mu.Unlock()
	return len(ab.alerts) > 0
}

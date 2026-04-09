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

	var cpuSum, cpuMax, ramSum, ramMax, diskLast float64

	for i := 0; i < count; i++ {
		s := rb.samples[i]
		cpuSum += s.CPUPercent
		if s.CPUPercent > cpuMax {
			cpuMax = s.CPUPercent
		}
		ramSum += s.RAMPercent
		if s.RAMPercent > ramMax {
			ramMax = s.RAMPercent
		}
		diskLast = s.DiskPercent
	}

	return platform.MetricsData{
		CPU:  platform.CPUMetrics{Avg: cpuSum / float64(count), Max: cpuMax},
		RAM:  platform.RAMMetrics{Avg: ramSum / float64(count), Max: ramMax},
		Disk: platform.DiskMetrics{Usage: diskLast, IOErrors: 0},
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

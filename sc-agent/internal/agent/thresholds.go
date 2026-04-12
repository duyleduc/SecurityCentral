package agent

import (
	"math"
	"sync"
	"time"

	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

type ThresholdConfig struct {
	CPUPercent    float64
	RAMPercent    float64
	DiskPercent   float64
	IOWaitPercent float64 // default 20
	SpikePercent  float64 // default 40 (% jump between windows)
}

// SpikeDetector tracks previous metric window averages for spike detection.
type SpikeDetector struct {
	mu      sync.Mutex
	prevCPU float64
	prevRAM float64
	inited  bool
}

// UpdateAndCheck stores the current window averages and returns spike alerts
// if the jump exceeds the threshold. Called once per heartbeat window (60s).
func (sd *SpikeDetector) UpdateAndCheck(cpuAvg, ramAvg, threshold float64) []platform.Alert {
	sd.mu.Lock()
	defer sd.mu.Unlock()

	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	if sd.inited {
		cpuDelta := math.Abs(cpuAvg - sd.prevCPU)
		if cpuDelta > threshold {
			alerts = append(alerts, platform.Alert{
				Type:      "cpu_spike",
				Value:     cpuDelta,
				Threshold: threshold,
				Since:     now,
			})
		}

		ramDelta := math.Abs(ramAvg - sd.prevRAM)
		if ramDelta > threshold {
			alerts = append(alerts, platform.Alert{
				Type:      "ram_spike",
				Value:     ramDelta,
				Threshold: threshold,
				Since:     now,
			})
		}
	}

	sd.prevCPU = cpuAvg
	sd.prevRAM = ramAvg
	sd.inited = true
	return alerts
}

func CheckThresholds(m sysinfo.Metrics, cfg ThresholdConfig) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	if m.CPUPercent > cfg.CPUPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "cpu_high",
			Value:     m.CPUPercent,
			Threshold: cfg.CPUPercent,
			Since:     now,
		})
	}

	if m.RAMPercent > cfg.RAMPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "ram_high",
			Value:     m.RAMPercent,
			Threshold: cfg.RAMPercent,
			Since:     now,
		})
	}

	if m.DiskPercent > cfg.DiskPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "disk_critical",
			Value:     m.DiskPercent,
			Threshold: cfg.DiskPercent,
			Since:     now,
		})
	}

	if cfg.IOWaitPercent > 0 && m.CPUIOWait > cfg.IOWaitPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "iowait_high",
			Value:     m.CPUIOWait,
			Threshold: cfg.IOWaitPercent,
			Since:     now,
		})
	}

	return alerts
}

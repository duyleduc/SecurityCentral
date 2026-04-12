package agent

import (
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/securitycentral/sc-agent/internal/collector"
	"github.com/securitycentral/sc-agent/internal/platform"
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

// ThresholdChecker evaluates incoming snapshots against configured thresholds.
type ThresholdChecker struct {
	cfg        ThresholdConfig
	knownPorts map[string]bool // baseline ports for "new port" detection
	portsInit  bool
}

func NewThresholdChecker(cfg ThresholdConfig) *ThresholdChecker {
	return &ThresholdChecker{cfg: cfg, knownPorts: make(map[string]bool)}
}

// CheckSnapshot evaluates a collector snapshot and returns any threshold alerts.
func (tc *ThresholdChecker) CheckSnapshot(snap collector.Snapshot) []platform.Alert {
	switch snap.Key {
	case "cpu":
		if d, ok := snap.Data.(collector.CPUData); ok {
			return tc.checkCPU(d)
		}
	case "memory":
		if d, ok := snap.Data.(collector.MemoryData); ok {
			return tc.checkMemory(d)
		}
	case "disk":
		if d, ok := snap.Data.(collector.DiskData); ok {
			return tc.checkDisk(d)
		}
	case "service":
		if d, ok := snap.Data.(collector.ServiceData); ok {
			return tc.checkService(d)
		}
	case "security":
		if d, ok := snap.Data.(collector.SecurityData); ok {
			return tc.checkSecurity(d)
		}
	}
	return nil
}

func (tc *ThresholdChecker) checkCPU(d collector.CPUData) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	if d.Percent > tc.cfg.CPUPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "cpu_high",
			Value:     d.Percent,
			Threshold: tc.cfg.CPUPercent,
			Since:     now,
		})
	}

	if tc.cfg.IOWaitPercent > 0 && d.IOWait > tc.cfg.IOWaitPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "iowait_high",
			Value:     d.IOWait,
			Threshold: tc.cfg.IOWaitPercent,
			Since:     now,
		})
	}

	return alerts
}

func (tc *ThresholdChecker) checkMemory(d collector.MemoryData) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	if d.UsedPercent > tc.cfg.RAMPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "ram_high",
			Value:     d.UsedPercent,
			Threshold: tc.cfg.RAMPercent,
			Since:     now,
		})
	}

	return alerts
}

func (tc *ThresholdChecker) checkDisk(d collector.DiskData) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	if d.UsedPercent > tc.cfg.DiskPercent {
		alerts = append(alerts, platform.Alert{
			Type:      "disk_critical",
			Value:     d.UsedPercent,
			Threshold: tc.cfg.DiskPercent,
			Since:     now,
		})
	}

	return alerts
}

func (tc *ThresholdChecker) checkService(d collector.ServiceData) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	for _, unit := range d.FailedUnits {
		alerts = append(alerts, platform.Alert{
			Type:      "service_down",
			Value:     1,
			Threshold: 0,
			Since:     now + "|" + unit,
		})
	}
	return alerts
}

func (tc *ThresholdChecker) checkSecurity(d collector.SecurityData) []platform.Alert {
	var alerts []platform.Alert
	now := time.Now().UTC().Format(time.RFC3339)

	// Build current port set and detect new externally-bound ports.
	curPorts := make(map[string]bool)
	for _, p := range d.ListeningPorts {
		key := fmt.Sprintf("%s/%d", p.Proto, p.Port)
		curPorts[key] = true

		if !tc.portsInit {
			continue
		}

		// Only alert on externally-bound new ports.
		isExternal := p.Bind == "0.0.0.0" || p.Bind == "::" || p.Bind == ""
		if isExternal && !tc.knownPorts[key] {
			alerts = append(alerts, platform.Alert{
				Type:      "port_new",
				Value:     float64(p.Port),
				Threshold: 0,
				Since:     now,
			})
		}
	}

	// Update baseline.
	tc.knownPorts = curPorts
	tc.portsInit = true

	// SSH brute force: more than 10 failures since last scan.
	if d.SSHFailures > 10 {
		alerts = append(alerts, platform.Alert{
			Type:      "ssh_brute_force",
			Value:     float64(d.SSHFailures),
			Threshold: 10,
			Since:     now,
		})
	}

	return alerts
}

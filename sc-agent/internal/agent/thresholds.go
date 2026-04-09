package agent

import (
	"time"

	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

type ThresholdConfig struct {
	CPUPercent  float64
	RAMPercent  float64
	DiskPercent float64
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

	return alerts
}

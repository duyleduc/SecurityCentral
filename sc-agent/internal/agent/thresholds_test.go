package agent

import (
	"testing"

	"github.com/securitycentral/sc-agent/internal/collector"
)

func TestThresholdCheckerCPU(t *testing.T) {
	tc := NewThresholdChecker(ThresholdConfig{
		CPUPercent:    85,
		IOWaitPercent: 20,
	})

	// Under threshold — no alerts
	alerts := tc.CheckSnapshot(collector.Snapshot{
		Key:  "cpu",
		Data: collector.CPUData{Percent: 50, IOWait: 5},
	})
	if len(alerts) != 0 {
		t.Fatalf("expected 0 alerts, got %d", len(alerts))
	}

	// Over CPU threshold
	alerts = tc.CheckSnapshot(collector.Snapshot{
		Key:  "cpu",
		Data: collector.CPUData{Percent: 90, IOWait: 5},
	})
	if len(alerts) != 1 || alerts[0].Type != "cpu_high" {
		t.Fatalf("expected cpu_high alert, got %v", alerts)
	}

	// Over both CPU and IOWait
	alerts = tc.CheckSnapshot(collector.Snapshot{
		Key:  "cpu",
		Data: collector.CPUData{Percent: 90, IOWait: 25},
	})
	if len(alerts) != 2 {
		t.Fatalf("expected 2 alerts, got %d", len(alerts))
	}
}

func TestThresholdCheckerMemory(t *testing.T) {
	tc := NewThresholdChecker(ThresholdConfig{RAMPercent: 85})

	alerts := tc.CheckSnapshot(collector.Snapshot{
		Key:  "memory",
		Data: collector.MemoryData{UsedPercent: 90},
	})
	if len(alerts) != 1 || alerts[0].Type != "ram_high" {
		t.Fatalf("expected ram_high alert, got %v", alerts)
	}
}

func TestThresholdCheckerDisk(t *testing.T) {
	tc := NewThresholdChecker(ThresholdConfig{DiskPercent: 90})

	alerts := tc.CheckSnapshot(collector.Snapshot{
		Key:  "disk",
		Data: collector.DiskData{UsedPercent: 95},
	})
	if len(alerts) != 1 || alerts[0].Type != "disk_critical" {
		t.Fatalf("expected disk_critical alert, got %v", alerts)
	}
}

func TestThresholdCheckerIgnoresUnknown(t *testing.T) {
	tc := NewThresholdChecker(ThresholdConfig{CPUPercent: 85})

	alerts := tc.CheckSnapshot(collector.Snapshot{
		Key:  "network",
		Data: collector.NetworkData{RxBytesPerSec: 999999},
	})
	if len(alerts) != 0 {
		t.Fatalf("expected 0 alerts for network snapshot, got %d", len(alerts))
	}
}

func TestSpikeDetector(t *testing.T) {
	sd := &SpikeDetector{}

	// First call — no previous data, no alerts.
	alerts := sd.UpdateAndCheck(30, 40, 40)
	if len(alerts) != 0 {
		t.Fatalf("first call should produce no alerts, got %d", len(alerts))
	}

	// Second call — no spike (small delta).
	alerts = sd.UpdateAndCheck(35, 45, 40)
	if len(alerts) != 0 {
		t.Fatalf("small delta should produce no alerts, got %d", len(alerts))
	}

	// Third call — CPU spike of 50 (exceeds 40 threshold).
	alerts = sd.UpdateAndCheck(85, 45, 40)
	if len(alerts) != 1 || alerts[0].Type != "cpu_spike" {
		t.Fatalf("expected cpu_spike, got %v", alerts)
	}
}

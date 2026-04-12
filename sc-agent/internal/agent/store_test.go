package agent

import (
	"testing"
	"time"

	"github.com/securitycentral/sc-agent/internal/collector"
)

func TestMetricStoreAggregateEmpty(t *testing.T) {
	store := NewMetricStore()
	md := store.AggregateMetrics()

	if md.CPU.Avg != 0 || md.RAM.Avg != 0 || md.Disk.Usage != 0 {
		t.Fatal("empty store should return zero metrics")
	}
}

func TestMetricStoreCPURingAggregation(t *testing.T) {
	store := NewMetricStore()

	// Push 3 CPU + Memory samples
	for i := 0; i < 3; i++ {
		cpuPct := float64(10 * (i + 1)) // 10, 20, 30
		store.Update(collector.Snapshot{
			Key:  "cpu",
			Data: collector.CPUData{Percent: cpuPct, IOWait: 2, Load1: 1.5},
			At:   time.Now(),
		})
		store.Update(collector.Snapshot{
			Key:  "memory",
			Data: collector.MemoryData{UsedPercent: cpuPct + 5, SwapUsedPct: 3},
			At:   time.Now(),
		})
	}

	md := store.AggregateMetrics()

	// CPU avg should be (10+20+30)/3 = 20
	if md.CPU.Avg != 20 {
		t.Errorf("CPU.Avg = %.1f, want 20.0", md.CPU.Avg)
	}
	if md.CPU.Max != 30 {
		t.Errorf("CPU.Max = %.1f, want 30.0", md.CPU.Max)
	}
	if md.CPU.IOWait != 2 {
		t.Errorf("CPU.IOWait = %.1f, want 2.0", md.CPU.IOWait)
	}

	// RAM avg should be (15+25+35)/3 = 25
	if md.RAM.Avg != 25 {
		t.Errorf("RAM.Avg = %.1f, want 25.0", md.RAM.Avg)
	}
	if md.RAM.SwapUsedPct != 3 {
		t.Errorf("RAM.SwapUsedPct = %.1f, want 3.0", md.RAM.SwapUsedPct)
	}

	// Load from latest CPU snapshot
	if md.Load.Load1 != 1.5 {
		t.Errorf("Load.Load1 = %.1f, want 1.5", md.Load.Load1)
	}
}

func TestMetricStoreLatestValues(t *testing.T) {
	store := NewMetricStore()

	store.Update(collector.Snapshot{
		Key:  "disk",
		Data: collector.DiskData{UsedPercent: 65, ReadBps: 1000, WriteBps: 2000, IOUtilPct: 15},
		At:   time.Now(),
	})

	store.Update(collector.Snapshot{
		Key: "network",
		Data: collector.NetworkData{
			RxBytesPerSec: 5000,
			TxBytesPerSec: 3000,
			Errors:        2,
		},
		At: time.Now(),
	})

	md := store.AggregateMetrics()

	if md.Disk.Usage != 65 {
		t.Errorf("Disk.Usage = %.1f, want 65.0", md.Disk.Usage)
	}
	if md.Disk.ReadBps != 1000 {
		t.Errorf("Disk.ReadBps = %d, want 1000", md.Disk.ReadBps)
	}
	if md.Network.RxBytesPerSec != 5000 {
		t.Errorf("Network.RxBytesPerSec = %d, want 5000", md.Network.RxBytesPerSec)
	}
	if md.Network.Errors != 2 {
		t.Errorf("Network.Errors = %d, want 2", md.Network.Errors)
	}
}

func TestMetricStoreLatestAccessors(t *testing.T) {
	store := NewMetricStore()

	_, ok := store.LatestCPU()
	if ok {
		t.Fatal("LatestCPU should return false on empty store")
	}

	store.Update(collector.Snapshot{
		Key:  "cpu",
		Data: collector.CPUData{Percent: 50},
		At:   time.Now(),
	})

	d, ok := store.LatestCPU()
	if !ok {
		t.Fatal("LatestCPU should return true after update")
	}
	if d.Percent != 50 {
		t.Errorf("LatestCPU().Percent = %.1f, want 50.0", d.Percent)
	}
}

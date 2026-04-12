package agent

import (
	"sync"

	"github.com/securitycentral/sc-agent/internal/collector"
	"github.com/securitycentral/sc-agent/internal/platform"
)

const fastRingSize = 60

// cpuSample stores one fast-cadence CPU sample for ring-buffer aggregation.
type cpuSample struct {
	Percent float64
	IOWait  float64
}

// memSample stores one fast-cadence memory sample for ring-buffer aggregation.
type memSample struct {
	UsedPercent float64
}

// MetricStore holds the latest snapshot from each collector plus ring buffers
// for fast-cadence metrics that need avg/max aggregation (CPU, Memory).
type MetricStore struct {
	mu sync.RWMutex

	// Latest snapshot per collector key
	latest map[string]*collector.Snapshot

	// Ring buffers for fast-cadence aggregation
	cpuRing  [fastRingSize]cpuSample
	memRing  [fastRingSize]memSample
	ringPos  int
	ringFull bool

	// fastSeen tracks which fast collectors have written to the current ringPos.
	// Once all fast collectors write, the position advances.
	fastSeen map[string]bool
}

// fastCollectors is the set of collector keys that use the ring buffer.
var fastCollectors = map[string]bool{"cpu": true, "memory": true}

func NewMetricStore() *MetricStore {
	return &MetricStore{
		latest:   make(map[string]*collector.Snapshot),
		fastSeen: make(map[string]bool),
	}
}

// Update stores a snapshot. For fast-cadence collectors (cpu, memory),
// also pushes to the ring buffer for aggregation. The ring position
// advances only after all fast collectors have written for the current tick.
func (ms *MetricStore) Update(snap collector.Snapshot) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	clone := snap
	ms.latest[snap.Key] = &clone

	if !fastCollectors[snap.Key] {
		return
	}

	// Write to ring at current position.
	switch snap.Key {
	case "cpu":
		if d, ok := snap.Data.(collector.CPUData); ok {
			ms.cpuRing[ms.ringPos] = cpuSample{Percent: d.Percent, IOWait: d.IOWait}
		}
	case "memory":
		if d, ok := snap.Data.(collector.MemoryData); ok {
			ms.memRing[ms.ringPos] = memSample{UsedPercent: d.UsedPercent}
		}
	}

	ms.fastSeen[snap.Key] = true

	// Advance ring position once all fast collectors have written.
	if len(ms.fastSeen) >= len(fastCollectors) {
		ms.ringPos = (ms.ringPos + 1) % fastRingSize
		if ms.ringPos == 0 {
			ms.ringFull = true
		}
		// Reset for next tick.
		for k := range ms.fastSeen {
			delete(ms.fastSeen, k)
		}
	}
}

// AggregateMetrics builds the heartbeat MetricsData payload from current state.
//   - CPU and Memory: avg/max from ring buffer (60s of 1s samples).
//   - Everything else: latest snapshot value.
func (ms *MetricStore) AggregateMetrics() platform.MetricsData {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	md := platform.MetricsData{}

	// --- CPU & Memory aggregation from ring ---
	count := ms.ringPos
	if ms.ringFull {
		count = fastRingSize
	}

	if count > 0 {
		var cpuSum, cpuMax, ioWaitSum float64
		var memSum, memMax float64

		for i := 0; i < count; i++ {
			cs := ms.cpuRing[i]
			cpuSum += cs.Percent
			if cs.Percent > cpuMax {
				cpuMax = cs.Percent
			}
			ioWaitSum += cs.IOWait

			ms2 := ms.memRing[i]
			memSum += ms2.UsedPercent
			if ms2.UsedPercent > memMax {
				memMax = ms2.UsedPercent
			}
		}

		n := float64(count)
		md.CPU.Avg = cpuSum / n
		md.CPU.Max = cpuMax
		md.CPU.IOWait = ioWaitSum / n
		md.RAM.Avg = memSum / n
		md.RAM.Max = memMax
	}

	// --- CPU: load avg from latest snapshot ---
	if snap, ok := ms.latest["cpu"]; ok {
		if d, ok := snap.Data.(collector.CPUData); ok {
			md.Load.Load1 = d.Load1
			md.Load.Load5 = d.Load5
			md.Load.Load15 = d.Load15
		}
	}

	// --- Memory: swap from latest snapshot ---
	if snap, ok := ms.latest["memory"]; ok {
		if d, ok := snap.Data.(collector.MemoryData); ok {
			md.RAM.SwapUsedPct = d.SwapUsedPct
		}
	}

	// --- Disk: latest snapshot ---
	if snap, ok := ms.latest["disk"]; ok {
		if d, ok := snap.Data.(collector.DiskData); ok {
			md.Disk.Usage = d.UsedPercent
			md.Disk.ReadBps = d.ReadBps
			md.Disk.WriteBps = d.WriteBps
			md.Disk.IOUtilPct = d.IOUtilPct
		}
	}

	// --- Network: latest snapshot ---
	if snap, ok := ms.latest["network"]; ok {
		if d, ok := snap.Data.(collector.NetworkData); ok {
			md.Network.RxBytesPerSec = d.RxBytesPerSec
			md.Network.TxBytesPerSec = d.TxBytesPerSec
			md.Network.Errors = d.Errors
			md.Network.Drops = d.Drops

			for _, ifc := range d.Interfaces {
				md.Network.Interfaces = append(md.Network.Interfaces, platform.IfaceMetric{
					Name:    ifc.Name,
					RxBytes: ifc.RxBytes,
					TxBytes: ifc.TxBytes,
					Errors:  ifc.Errors,
					Drops:   ifc.Drops,
				})
			}
		}
	}

	// --- Process: latest snapshot ---
	if snap, ok := ms.latest["process"]; ok {
		if d, ok := snap.Data.(collector.ProcessData); ok {
			pm := &platform.ProcessMetrics{
				Total:    d.Total,
				Zombies:  d.Zombies,
				OOMKills: d.OOMKills,
			}
			for _, p := range d.Top {
				pm.Top = append(pm.Top, platform.ProcessInfo{
					PID: p.PID, Name: p.Name, User: p.User, CPU: p.CPU, RAM: p.RAM,
				})
			}
			md.Process = pm
		}
	}

	// --- Service: latest snapshot ---
	if snap, ok := ms.latest["service"]; ok {
		if d, ok := snap.Data.(collector.ServiceData); ok {
			md.Service = &platform.ServiceMetrics{FailedUnits: d.FailedUnits}
		}
	}

	// --- Docker: latest snapshot ---
	if snap, ok := ms.latest["docker"]; ok {
		if d, ok := snap.Data.(collector.DockerData); ok {
			dm := &platform.DockerMetrics{
				Running: d.Running,
				Stopped: d.Stopped,
			}
			for _, c := range d.Containers {
				dm.Containers = append(dm.Containers, platform.ContainerData{
					ID: c.ID, Name: c.Name, Image: c.Image, State: c.State,
					CPU: c.CPU, Memory: c.Memory, Restarts: c.Restarts,
				})
			}
			md.Docker = dm
		}
	}

	return md
}

// Latest returns the latest snapshot for any collector key.
func (ms *MetricStore) Latest(key string) (collector.Snapshot, bool) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	if snap, ok := ms.latest[key]; ok {
		return *snap, true
	}
	return collector.Snapshot{}, false
}

// LatestSecurity returns the latest security posture data.
func (ms *MetricStore) LatestSecurity() (collector.SecurityData, bool) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	if snap, ok := ms.latest["security"]; ok {
		if d, ok := snap.Data.(collector.SecurityData); ok {
			return d, true
		}
	}
	return collector.SecurityData{}, false
}

// LatestCPU returns the latest CPU data for threshold checking.
func (ms *MetricStore) LatestCPU() (collector.CPUData, bool) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	if snap, ok := ms.latest["cpu"]; ok {
		if d, ok := snap.Data.(collector.CPUData); ok {
			return d, true
		}
	}
	return collector.CPUData{}, false
}

// LatestMemory returns the latest memory data for threshold checking.
func (ms *MetricStore) LatestMemory() (collector.MemoryData, bool) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	if snap, ok := ms.latest["memory"]; ok {
		if d, ok := snap.Data.(collector.MemoryData); ok {
			return d, true
		}
	}
	return collector.MemoryData{}, false
}

// LatestDisk returns the latest disk data for threshold checking.
func (ms *MetricStore) LatestDisk() (collector.DiskData, bool) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	if snap, ok := ms.latest["disk"]; ok {
		if d, ok := snap.Data.(collector.DiskData); ok {
			return d, true
		}
	}
	return collector.DiskData{}, false
}

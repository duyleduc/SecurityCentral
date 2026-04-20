package sysinfo

import (
	"bufio"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gopsNet "github.com/shirou/gopsutil/v3/net"
)

type SystemInfo struct {
	Hostname    string   `json:"hostname"`
	OS          string   `json:"os"`
	Platform    string   `json:"platform"`
	Version     string   `json:"version"`
	Arch        string   `json:"arch"`
	Kernel      string   `json:"kernel"`
	CPUCores    int      `json:"cpuCores"`
	CPUModel    string   `json:"cpuModel,omitempty"`
	TotalRAMMB  int64    `json:"totalRamMb"`
	TotalDiskGB int64    `json:"totalDiskGb"`
	IPAddresses []string `json:"ipAddresses"`
	// BootTime is the unix timestamp (seconds) when the host booted.
	// Used by the dashboard to compute true server uptime.
	BootTime uint64 `json:"bootTime,omitempty"`
}

func GetSystemInfo() SystemInfo {
	hi, _ := host.Info()

	hostname := ""
	platform := runtime.GOOS
	version := ""
	kernel := ""
	var bootTime uint64
	if hi != nil {
		hostname = hi.Hostname
		platform = hi.Platform
		version = hi.PlatformVersion
		kernel = hi.KernelVersion
		bootTime = hi.BootTime
	}

	// Fallback kernel from /proc
	if kernel == "" {
		kernel = kernelVersion()
	}

	// CPU model
	cpuModel := ""
	cpuInfos, err := cpu.Info()
	if err == nil && len(cpuInfos) > 0 {
		cpuModel = cpuInfos[0].ModelName
	}
	if cpuModel == "" {
		cpuModel = cpuModelFromProc()
	}

	// Total RAM
	var totalRAMMB int64
	vmem, err := mem.VirtualMemory()
	if err == nil && vmem != nil {
		totalRAMMB = int64(vmem.Total) / (1024 * 1024)
	}

	// Total disk
	var totalDiskGB int64
	du, err := disk.Usage("/")
	if err == nil && du != nil {
		totalDiskGB = int64(du.Total) / (1024 * 1024 * 1024)
	}

	return SystemInfo{
		Hostname:    hostname,
		OS:          runtime.GOOS,
		Platform:    platform,
		Version:     version,
		Arch:        runtime.GOARCH,
		Kernel:      kernel,
		CPUCores:    runtime.NumCPU(),
		CPUModel:    cpuModel,
		TotalRAMMB:  totalRAMMB,
		TotalDiskGB: totalDiskGB,
		IPAddresses: localIPs(),
		BootTime:    bootTime,
	}
}

type Metrics struct {
	CPUPercent  float64 `json:"cpuPercent"`
	CPUIOWait   float64 `json:"cpuIoWait"`
	RAMPercent  float64 `json:"ramPercent"`
	SwapUsedPct float64 `json:"swapUsedPct"`
	DiskPercent float64 `json:"diskPercent"`
	DiskIOErr   int     `json:"diskIoErrors"`
	LoadAvg1    float64 `json:"loadAvg1"`
	LoadAvg5    float64 `json:"loadAvg5"`
	LoadAvg15   float64 `json:"loadAvg15"`

	// Disk I/O (delta per second since last sample)
	DiskReadBps  uint64  `json:"diskReadBps"`
	DiskWriteBps uint64  `json:"diskWriteBps"`
	DiskIOUtil   float64 `json:"diskIoUtil"`

	// Network (delta per second since last sample, all non-loopback interfaces)
	NetRxBytes uint64 `json:"netRxBytes"`
	NetTxBytes uint64 `json:"netTxBytes"`
	NetErrors  uint64 `json:"netErrors"`
	NetDrops   uint64 `json:"netDrops"`

	// Per-interface network (delta per second)
	Interfaces []IfaceMetrics `json:"interfaces,omitempty"`
}

// IfaceMetrics holds per-interface network counters (delta per second).
type IfaceMetrics struct {
	Name     string `json:"name"`
	RxBytes  uint64 `json:"rxBytes"`
	TxBytes  uint64 `json:"txBytes"`
	RxErrors uint64 `json:"rxErrors"`
	TxErrors uint64 `json:"txErrors"`
	Drops    uint64 `json:"drops"`
}

// prevCounters holds previous sample counters for delta calculation.
type prevCounters struct {
	mu         sync.Mutex
	ts         time.Time
	cpuTimes   cpu.TimesStat
	cpuInited  bool
	diskIO     map[string]disk.IOCountersStat
	diskInited bool
	netIO      map[string]gopsNet.IOCountersStat
	netInited  bool
}

var prev prevCounters

func CollectMetrics() (Metrics, error) {
	var m Metrics
	now := time.Now()

	prev.mu.Lock()
	defer prev.mu.Unlock()

	elapsed := now.Sub(prev.ts).Seconds()
	if elapsed <= 0 {
		elapsed = 1
	}

	// --- CPU utilization + iowait ---
	cpuTimes, err := cpu.Times(false)
	if err == nil && len(cpuTimes) > 0 {
		cur := cpuTimes[0]
		if prev.cpuInited {
			p := prev.cpuTimes
			totalDelta := (cur.User - p.User) + (cur.System - p.System) +
				(cur.Idle - p.Idle) + (cur.Nice - p.Nice) +
				(cur.Iowait - p.Iowait) + (cur.Irq - p.Irq) +
				(cur.Softirq - p.Softirq) + (cur.Steal - p.Steal)
			if totalDelta > 0 {
				busyDelta := totalDelta - (cur.Idle - p.Idle)
				m.CPUPercent = (busyDelta / totalDelta) * 100
				m.CPUIOWait = ((cur.Iowait - p.Iowait) / totalDelta) * 100
			}
		}
		prev.cpuTimes = cur
		prev.cpuInited = true
	}

	// --- Memory ---
	vmem, err := mem.VirtualMemory()
	if err == nil && vmem != nil {
		m.RAMPercent = vmem.UsedPercent
	}

	swap, err := mem.SwapMemory()
	if err == nil && swap != nil && swap.Total > 0 {
		m.SwapUsedPct = swap.UsedPercent
	}

	// --- Load average ---
	la, err := load.Avg()
	if err == nil && la != nil {
		m.LoadAvg1 = la.Load1
		m.LoadAvg5 = la.Load5
		m.LoadAvg15 = la.Load15
	}

	// --- Disk usage ---
	du, err := disk.Usage("/")
	if err == nil && du != nil {
		m.DiskPercent = du.UsedPercent
	}

	// --- Disk I/O (delta) ---
	diskCounters, err := disk.IOCounters()
	if err == nil {
		if prev.diskInited {
			var totalReadDelta, totalWriteDelta, totalWeightedDelta uint64
			for name, cur := range diskCounters {
				if p, ok := prev.diskIO[name]; ok {
					totalReadDelta += cur.ReadBytes - p.ReadBytes
					totalWriteDelta += cur.WriteBytes - p.WriteBytes
					totalWeightedDelta += cur.WeightedIO - p.WeightedIO
				}
			}
			m.DiskReadBps = uint64(float64(totalReadDelta) / elapsed)
			m.DiskWriteBps = uint64(float64(totalWriteDelta) / elapsed)
			// WeightedIO is in ms — utilization = ms_busy / ms_elapsed * 100
			m.DiskIOUtil = float64(totalWeightedDelta) / (elapsed * 1000) * 100
			if m.DiskIOUtil > 100 {
				m.DiskIOUtil = 100
			}
		}
		prev.diskIO = diskCounters
		prev.diskInited = true
	}

	// --- Network I/O (delta, per-interface + totals) ---
	netCounters, err := gopsNet.IOCounters(true)
	if err == nil {
		curMap := make(map[string]gopsNet.IOCountersStat, len(netCounters))
		for _, c := range netCounters {
			if c.Name == "lo" || c.Name == "lo0" {
				continue
			}
			curMap[c.Name] = c
		}

		if prev.netInited {
			var totalRx, totalTx, totalErr, totalDrop uint64
			var ifaces []IfaceMetrics
			for name, cur := range curMap {
				if p, ok := prev.netIO[name]; ok {
					rxD := cur.BytesRecv - p.BytesRecv
					txD := cur.BytesSent - p.BytesSent
					errD := (cur.Errin - p.Errin) + (cur.Errout - p.Errout)
					dropD := (cur.Dropin - p.Dropin) + (cur.Dropout - p.Dropout)
					totalRx += rxD
					totalTx += txD
					totalErr += errD
					totalDrop += dropD
					ifaces = append(ifaces, IfaceMetrics{
						Name:     name,
						RxBytes:  uint64(float64(rxD) / elapsed),
						TxBytes:  uint64(float64(txD) / elapsed),
						RxErrors: errD,
						TxErrors: 0, // combined in errD
						Drops:    dropD,
					})
				}
			}
			m.NetRxBytes = uint64(float64(totalRx) / elapsed)
			m.NetTxBytes = uint64(float64(totalTx) / elapsed)
			m.NetErrors = totalErr
			m.NetDrops = totalDrop
			m.Interfaces = ifaces
		}
		prev.netIO = curMap
		prev.netInited = true
	}

	prev.ts = now
	return m, nil
}

// kernelVersion reads /proc/sys/kernel/osrelease on Linux.
func kernelVersion() string {
	data, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// cpuModelFromProc reads the first "model name" from /proc/cpuinfo.
func cpuModelFromProc() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") || strings.HasPrefix(line, "Model") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}

// localIPs returns non-loopback IPv4 addresses.
func localIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if ok && ipNet.IP.To4() != nil {
				ips = append(ips, ipNet.IP.String())
			}
		}
	}
	return ips
}

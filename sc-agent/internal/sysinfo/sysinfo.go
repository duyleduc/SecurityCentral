package sysinfo

import (
	"bufio"
	"net"
	"os"
	"runtime"
	"strings"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
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
}

func GetSystemInfo() SystemInfo {
	hi, _ := host.Info()

	hostname := ""
	platform := runtime.GOOS
	version := ""
	kernel := ""
	if hi != nil {
		hostname = hi.Hostname
		platform = hi.Platform
		version = hi.PlatformVersion
		kernel = hi.KernelVersion
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
	}
}

type Metrics struct {
	CPUPercent  float64 `json:"cpuPercent"`
	RAMPercent  float64 `json:"ramPercent"`
	DiskPercent float64 `json:"diskPercent"`
	DiskIOErr   int     `json:"diskIoErrors"`
}

func CollectMetrics() (Metrics, error) {
	var m Metrics

	cpuPcts, err := cpu.Percent(0, false)
	if err == nil && len(cpuPcts) > 0 {
		m.CPUPercent = cpuPcts[0]
	}

	vmem, err := mem.VirtualMemory()
	if err == nil && vmem != nil {
		m.RAMPercent = vmem.UsedPercent
	}

	du, err := disk.Usage("/")
	if err == nil && du != nil {
		m.DiskPercent = du.UsedPercent
	}

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

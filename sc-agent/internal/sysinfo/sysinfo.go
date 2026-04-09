package sysinfo

import (
	"runtime"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

type SystemInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Platform string `json:"platform"`
	Version  string `json:"version"`
	Arch     string `json:"arch"`
}

func GetSystemInfo() SystemInfo {
	hi, _ := host.Info()

	hostname := ""
	platform := runtime.GOOS
	version := ""
	if hi != nil {
		hostname = hi.Hostname
		platform = hi.Platform
		version = hi.PlatformVersion
	}

	return SystemInfo{
		Hostname: hostname,
		OS:       runtime.GOOS,
		Platform: platform,
		Version:  version,
		Arch:     runtime.GOARCH,
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

	// CPU
	cpuPcts, err := cpu.Percent(0, false)
	if err == nil && len(cpuPcts) > 0 {
		m.CPUPercent = cpuPcts[0]
	}

	// Memory
	vmem, err := mem.VirtualMemory()
	if err == nil && vmem != nil {
		m.RAMPercent = vmem.UsedPercent
	}

	// Disk
	du, err := disk.Usage("/")
	if err == nil && du != nil {
		m.DiskPercent = du.UsedPercent
	}

	return m, nil
}

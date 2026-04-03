//go:build !linux

package sysinfo

// ResourceUsage contains real-time host resource utilization.
type ResourceUsage struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	DiskPercent   float64 `json:"diskPercent"`
	LoadAvg1      float64 `json:"loadAvg1"`
	LoadAvg5      float64 `json:"loadAvg5"`
	LoadAvg15     float64 `json:"loadAvg15"`
	MemUsedMB     int64   `json:"memUsedMb"`
	MemTotalMB    int64   `json:"memTotalMb"`
	DiskUsedGB    int64   `json:"diskUsedGb"`
	DiskTotalGB   int64   `json:"diskTotalGb"`
	UptimeSecs    int64   `json:"uptimeSecs"`
}

// MeasureResources is a no-op on non-Linux platforms.
func MeasureResources() ResourceUsage { return ResourceUsage{} }

// readMeminfoField is a no-op on non-Linux platforms.
func readMeminfoField(_ string) int64 { return 0 }

// diskTotalGB is a no-op on non-Linux platforms.
func diskTotalGB() int64 { return 0 }

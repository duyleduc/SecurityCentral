//go:build linux

package sysinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

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

// MeasureResources returns a snapshot of host resource utilization.
// CPU measurement requires two reads of /proc/stat separated by 500ms.
func MeasureResources() ResourceUsage {
	return ResourceUsage{
		CPUPercent:    measureCPU(),
		MemoryPercent: memoryPercent(),
		DiskPercent:   diskPercent(),
		LoadAvg1:      loadAvg(0),
		LoadAvg5:      loadAvg(1),
		LoadAvg15:     loadAvg(2),
		MemUsedMB:     memUsedMB(),
		MemTotalMB:    readMeminfoField("MemTotal") / 1024,
		DiskUsedGB:    diskUsedGB(),
		DiskTotalGB:   diskTotalGB(),
		UptimeSecs:    uptimeSeconds(),
	}
}

// measureCPU calculates system CPU usage by reading /proc/stat twice.
func measureCPU() float64 {
	idle1, total1 := readCPUStat()
	if total1 == 0 {
		return 0
	}
	time.Sleep(500 * time.Millisecond)
	idle2, total2 := readCPUStat()
	if total2 == total1 {
		return 0
	}

	idleDelta := float64(idle2 - idle1)
	totalDelta := float64(total2 - total1)
	return (1.0 - idleDelta/totalDelta) * 100
}

// readCPUStat reads the aggregate "cpu" line from /proc/stat.
// Returns (idle ticks, total ticks).
func readCPUStat() (idle, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return 0, 0
		}
		// fields: cpu user nice system idle iowait irq softirq steal ...
		for i := 1; i < len(fields); i++ {
			val, _ := strconv.ParseUint(fields[i], 10, 64)
			total += val
			if i == 4 { // idle is field index 4
				idle = val
			}
		}
		return
	}
	return 0, 0
}

// memoryPercent reads /proc/meminfo for real system memory usage.
func memoryPercent() float64 {
	total := readMeminfoField("MemTotal")
	available := readMeminfoField("MemAvailable")
	if total == 0 {
		return 0
	}
	used := total - available
	return float64(used) / float64(total) * 100
}

// memUsedMB returns used memory in MB.
func memUsedMB() int64 {
	total := readMeminfoField("MemTotal")
	available := readMeminfoField("MemAvailable")
	return (total - available) / 1024 // kB → MB
}

// readMeminfoField reads a named field from /proc/meminfo (value in kB).
func readMeminfoField(field string) int64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, field+":") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				val, _ := strconv.ParseInt(fields[1], 10, 64)
				return val
			}
		}
	}
	return 0
}

// diskPercent returns root filesystem usage percentage.
func diskPercent() float64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	if total == 0 {
		return 0
	}
	used := total - free
	return float64(used) / float64(total) * 100
}

// diskTotalGB returns total root filesystem size in GB.
func diskTotalGB() int64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	return int64(stat.Blocks) * int64(stat.Bsize) / (1024 * 1024 * 1024)
}

// diskUsedGB returns used root disk space in GB.
func diskUsedGB() int64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	return int64(total-free) / (1024 * 1024 * 1024)
}

// loadAvg reads /proc/loadavg and returns the value at the given index (0, 1, or 2).
func loadAvg(index int) float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if index >= len(fields) {
		return 0
	}
	val, _ := strconv.ParseFloat(fields[index], 64)
	return val
}

// uptimeSeconds reads /proc/uptime.
func uptimeSeconds() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	val, _ := strconv.ParseFloat(fields[0], 64)
	return int64(val)
}

// Package sysinfo collects hardware and OS information from Linux hosts
// using procfs and syscalls — no external dependencies.
package sysinfo

import (
	"bufio"
	"net"
	"os"
	"runtime"
	"strings"
)

// SystemInfo contains static hardware and OS information collected once at
// startup or install time.
type SystemInfo struct {
	Kernel      string   `json:"kernel"`
	CPUCores    int      `json:"cpuCores"`
	CPUModel    string   `json:"cpuModel,omitempty"`
	TotalRAMMB  int64    `json:"totalRamMb"`
	TotalDiskGB int64    `json:"totalDiskGb"`
	IPAddresses []string `json:"ipAddresses"`
}

// Collect gathers static system information from the host.
func Collect() SystemInfo {
	return SystemInfo{
		Kernel:      kernelVersion(),
		CPUCores:    runtime.NumCPU(),
		CPUModel:    cpuModel(),
		TotalRAMMB:  readMeminfoField("MemTotal") / 1024,
		TotalDiskGB: diskTotalGB(),
		IPAddresses: localIPs(),
	}
}

// kernelVersion reads /proc/sys/kernel/osrelease on Linux.
func kernelVersion() string {
	data, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(data))
}

// cpuModel reads the first "model name" from /proc/cpuinfo.
func cpuModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
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

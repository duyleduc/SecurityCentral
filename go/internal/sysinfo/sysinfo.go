// Package sysinfo collects hardware and OS information from Linux hosts
// using procfs and syscalls — no external dependencies.
package sysinfo

import (
	"bufio"
	"net"
	"os"
	"runtime"
	"strings"
	"syscall"
)

// SystemInfo contains static hardware and OS information collected once at
// startup or install time. These values rarely change during the agent's
// lifetime.
type SystemInfo struct {
	Kernel     string   `json:"kernel"`              // e.g. "5.15.0-91-generic"
	CPUCores   int      `json:"cpuCores"`            // logical cores
	CPUModel   string   `json:"cpuModel,omitempty"`  // e.g. "Intel(R) Xeon(R) CPU @ 2.20GHz"
	TotalRAMMB int64    `json:"totalRamMb"`          // total physical RAM in MB
	TotalDiskGB int64   `json:"totalDiskGb"`         // total root filesystem in GB
	IPAddresses []string `json:"ipAddresses"`        // non-loopback IPv4 addresses
}

// Collect gathers static system information from the host.
func Collect() SystemInfo {
	return SystemInfo{
		Kernel:      kernelVersion(),
		CPUCores:    runtime.NumCPU(),
		CPUModel:    cpuModel(),
		TotalRAMMB:  totalRAMMB(),
		TotalDiskGB: totalDiskGB(),
		IPAddresses: localIPs(),
	}
}

// kernelVersion reads the kernel release via uname syscall.
func kernelVersion() string {
	var uname syscall.Utsname
	if err := syscall.Uname(&uname); err != nil {
		return "unknown"
	}
	return charsToString(uname.Release[:])
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

// totalRAMMB reads MemTotal from /proc/meminfo.
func totalRAMMB() int64 {
	val := readMeminfoField("MemTotal")
	return val / 1024 // kB → MB
}

// totalDiskGB returns root filesystem size.
func totalDiskGB() int64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	return int64(stat.Blocks) * int64(stat.Bsize) / (1024 * 1024 * 1024)
}

// localIPs returns non-loopback IPv4 addresses.
func localIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			if ipNet.IP.To4() != nil {
				ips = append(ips, ipNet.IP.String())
			}
		}
	}
	return ips
}

// charsToString converts a syscall byte array to string.
func charsToString(ca []int8) string {
	s := make([]byte, 0, len(ca))
	for _, c := range ca {
		if c == 0 {
			break
		}
		s = append(s, byte(c))
	}
	return string(s)
}

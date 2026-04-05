package agent

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/security-central/security-central/internal/config"
	"github.com/security-central/security-central/internal/signing"
	"github.com/security-central/security-central/internal/sysinfo"
)

// StatusReport contains all diagnostic information for sc-agent status.
type StatusReport struct {
	Version        string
	SignedBuild    bool
	ConfigPath     string
	ConfigValid    bool
	ConfigError    string
	AgentID        string
	APIURL         string
	CertPath       string
	CertValid      bool
	CertExpiry     time.Time
	CertDaysLeft   int
	CertError      string
	ServiceActive  bool
	ServiceError   string
	HeartbeatOK    bool
	HeartbeatMs    int64
	HeartbeatError string
	Cloud          sysinfo.CloudInfo
	System         sysinfo.SystemInfo
	Metrics        *Metrics
	MetricsError   string
}

// CollectStatus gathers all diagnostic information.
func CollectStatus(version, configPath string) StatusReport {
	r := StatusReport{
		Version:    version,
		SignedBuild: signing.IsSignedBuild(),
		ConfigPath: configPath,
	}

	// Config
	cfg, err := config.LoadAgentConfig(configPath)
	if err != nil {
		r.ConfigError = err.Error()
	} else {
		r.ConfigValid = true
		r.AgentID = cfg.AgentID
		r.APIURL = cfg.APIURL
		r.CertPath = cfg.TLS.Cert
		checkCert(&r, cfg)
		checkHeartbeat(&r, cfg)
	}

	// Systemd service
	checkService(&r)

	// System info
	r.Cloud = sysinfo.DetectCloud()
	r.System = sysinfo.Collect()

	// Metrics
	m, err := LoadMetricsFromDisk()
	if err != nil {
		r.MetricsError = err.Error()
	} else {
		r.Metrics = m
	}

	return r
}

func checkCert(r *StatusReport, cfg *config.AgentConfig) {
	cert, err := tls.LoadX509KeyPair(cfg.TLS.Cert, cfg.TLS.Key)
	if err != nil {
		r.CertError = err.Error()
		return
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		r.CertError = err.Error()
		return
	}
	r.CertValid = time.Now().Before(leaf.NotAfter)
	r.CertExpiry = leaf.NotAfter
	r.CertDaysLeft = int(time.Until(leaf.NotAfter).Hours() / 24)
}

func checkService(r *StatusReport) {
	if runtime.GOOS != "linux" {
		r.ServiceError = "not linux"
		return
	}
	cmd := exec.Command("systemctl", "is-active", "securitycentral-agent.service")
	out, err := cmd.Output()
	if err != nil {
		r.ServiceError = "inactive or not found"
		return
	}
	r.ServiceActive = strings.TrimSpace(string(out)) == "active"
}

func checkHeartbeat(r *StatusReport, cfg *config.AgentConfig) {
	client := &http.Client{Timeout: 5 * time.Second}
	url := strings.TrimRight(cfg.APIURL, "/") + "/health"

	start := time.Now()
	resp, err := client.Get(url)
	latency := time.Since(start)

	if err != nil {
		// Try to distinguish DNS vs connection vs timeout
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			r.HeartbeatError = "timeout (5s)"
		} else {
			r.HeartbeatError = err.Error()
		}
		return
	}
	defer resp.Body.Close()

	r.HeartbeatOK = resp.StatusCode == http.StatusOK
	r.HeartbeatMs = latency.Milliseconds()
	if !r.HeartbeatOK {
		r.HeartbeatError = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
}

// PrintStatus outputs the status report in a human-readable format.
func PrintStatus(r StatusReport) {
	fmt.Println("=== SecurityCentral Agent Status ===")
	fmt.Println()

	printRow("Version", r.Version)
	printRow("Signed Build", boolStr(r.SignedBuild))
	fmt.Println()

	// Config
	fmt.Println("── Config ──")
	printRow("Config File", r.ConfigPath)
	if r.ConfigValid {
		printRow("Status", "OK")
		printRow("Agent ID", r.AgentID)
		printRow("API URL", r.APIURL)
	} else {
		printRow("Status", "ERROR: "+r.ConfigError)
	}
	fmt.Println()

	// Certificate
	fmt.Println("── Certificate ──")
	if !r.ConfigValid {
		printRow("Status", "skipped (config invalid)")
	} else if r.CertError != "" {
		printRow("Status", "ERROR: "+r.CertError)
	} else if r.CertValid {
		printRow("Status", "Valid")
		printRow("Expires", r.CertExpiry.Format("2006-01-02"))
		days := fmt.Sprintf("%d days", r.CertDaysLeft)
		if r.CertDaysLeft <= 30 {
			days += " (RENEWING SOON)"
		}
		printRow("Days Left", days)
	} else {
		printRow("Status", "EXPIRED")
		printRow("Expired", r.CertExpiry.Format("2006-01-02"))
	}
	fmt.Println()

	// Connectivity
	fmt.Println("── Connectivity ──")
	if r.HeartbeatOK {
		printRow("API Health", fmt.Sprintf("OK (%dms)", r.HeartbeatMs))
	} else if r.HeartbeatError != "" {
		printRow("API Health", "FAILED: "+r.HeartbeatError)
	} else {
		printRow("API Health", "not checked (config invalid)")
	}
	fmt.Println()

	// Service
	fmt.Println("── Service ──")
	if r.ServiceError != "" {
		printRow("systemd", r.ServiceError)
	} else if r.ServiceActive {
		printRow("systemd", "active (running)")
	} else {
		printRow("systemd", "inactive")
	}
	fmt.Println()

	// Cloud
	fmt.Println("── Cloud ──")
	if r.Cloud.Provider != "" {
		printRow("Provider", r.Cloud.Provider)
		printRow("Region", r.Cloud.Region)
		printRow("Instance", r.Cloud.InstanceID)
		printRow("Type", r.Cloud.InstanceType)
	} else {
		printRow("Provider", "none (on-prem or bare metal)")
	}
	fmt.Println()

	// System
	fmt.Println("── System ──")
	printRow("Kernel", r.System.Kernel)
	printRow("CPU", fmt.Sprintf("%d cores — %s", r.System.CPUCores, r.System.CPUModel))
	printRow("RAM", fmt.Sprintf("%d MB", r.System.TotalRAMMB))
	printRow("Disk", fmt.Sprintf("%d GB", r.System.TotalDiskGB))
	if len(r.System.IPAddresses) > 0 {
		printRow("IPs", strings.Join(r.System.IPAddresses, ", "))
	}
	fmt.Println()

	// Metrics
	fmt.Println("── Metrics ──")
	if r.MetricsError != "" {
		printRow("Status", "not available: "+r.MetricsError)
	} else if r.Metrics != nil {
		printRow("Started", r.Metrics.StartedAt)
		printRow("Heartbeats", fmt.Sprintf("%d total, %d failed", r.Metrics.HeartbeatsTotal, r.Metrics.HeartbeatsFailed))
		if r.Metrics.ConsecutiveFails > 0 {
			printRow("Consecutive Fails", fmt.Sprintf("%d", r.Metrics.ConsecutiveFails))
		}
		if r.Metrics.LastHeartbeat != "" {
			printRow("Last Heartbeat", r.Metrics.LastHeartbeat)
		}
		if r.Metrics.LastHeartbeatError != "" {
			printRow("Last HB Error", r.Metrics.LastHeartbeatError)
		}
		printRow("Scans", fmt.Sprintf("%d total, %d failed", r.Metrics.ScansTotal, r.Metrics.ScansFailed))
		if r.Metrics.LastScan != "" {
			printRow("Last Scan", r.Metrics.LastScan)
		}
	}
}

func printRow(label, value string) {
	fmt.Printf("  %-20s %s\n", label, value)
}

func boolStr(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

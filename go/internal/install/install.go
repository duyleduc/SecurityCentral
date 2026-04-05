// Package install handles one-time agent installation: key generation,
// enrollment with the platform API, certificate storage, config creation,
// and systemd service setup.
package install

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/security-central/security-central/internal/signing"
	"github.com/security-central/security-central/internal/sysinfo"
)

// Paths
const (
	configDir  = "/etc/securitycentral"
	certDir    = "/etc/securitycentral/certs"
	dataDir    = "/var/lib/securitycentral/queue"
	configFile = "/etc/securitycentral/agent.yml"
	unitFile   = "/etc/systemd/system/securitycentral-agent.service"
	binaryDst  = "/usr/local/bin/sc-agent"
)

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

type enrollRequest struct {
	Token           string `json:"token"`
	Hostname        string `json:"hostname"`
	OsFamily        string `json:"osFamily"`
	OsVersion       string `json:"osVersion"`
	Arch            string `json:"arch"`
	CloudProvider   string `json:"cloudProvider,omitempty"`
	CloudRegion     string `json:"cloudRegion,omitempty"`
	CloudInstanceId string `json:"cloudInstanceId,omitempty"`
	CSR             string `json:"csr"`
}

type scanConfig struct {
	Packages   bool   `json:"packages"`
	Compliance bool   `json:"compliance"`
	Interval   string `json:"interval"`
	OnStartup  bool   `json:"onStartup"`
}

type enrollConfig struct {
	Environment string            `json:"environment"`
	Labels      map[string]string `json:"labels,omitempty"`
	Scan        scanConfig        `json:"scan"`
}

type enrollData struct {
	AgentID    string       `json:"agentId"`
	SignedCert string       `json:"signedCert"`
	CACert     string       `json:"caCert"`
	Config     enrollConfig `json:"config"`
}

type enrollResponse struct {
	Data   *enrollData `json:"data"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// ---------------------------------------------------------------------------
// Run performs the full installation flow.
// ---------------------------------------------------------------------------

func Run(token, apiURL string) error {
	slog.Info("starting agent installation")

	// 0. Self-verification: check if this binary's signature is valid
	result := signing.VerifySelf(apiURL, runtime.GOARCH)
	switch {
	case result.Verified:
		slog.Info("binary signature verified")
	case result.Skipped:
		slog.Warn("binary verification skipped", "reason", result.Reason)
	default:
		slog.Error("WARNING: binary signature verification FAILED", "reason", result.Reason)
		fmt.Fprintf(os.Stderr, "\n  WARNING: This binary could not be verified. It may have been tampered with.\n")
		fmt.Fprintf(os.Stderr, "  Reason: %s\n\n", result.Reason)
	}

	// 1. Detect platform
	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("failed to detect hostname: %w", err)
	}
	osFamily, osVersion := detectOS()
	arch := runtime.GOARCH
	slog.Info("detected platform", "hostname", hostname, "os", osFamily, "version", osVersion, "arch", arch)

	// 1b. Detect cloud provider
	slog.Info("detecting cloud provider...")
	cloud := sysinfo.DetectCloud()
	if cloud.Provider != "" {
		slog.Info("cloud detected", "provider", cloud.Provider, "region", cloud.Region, "instance_id", cloud.InstanceID, "instance_type", cloud.InstanceType)
	} else {
		slog.Info("no cloud provider detected (on-prem or bare metal)")
	}

	// 1c. Collect system info
	sys := sysinfo.Collect()
	slog.Info("system info", "kernel", sys.Kernel, "cpu_cores", sys.CPUCores, "cpu_model", sys.CPUModel, "ram_mb", sys.TotalRAMMB, "disk_gb", sys.TotalDiskGB, "ips", sys.IPAddresses)

	// 2. Generate ECDSA P-256 key pair
	slog.Info("generating ECDSA P-256 key pair")
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate key pair: %w", err)
	}

	// 3. Create CSR
	csrTemplate := &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: hostname},
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, csrTemplate, privateKey)
	if err != nil {
		return fmt.Errorf("failed to create CSR: %w", err)
	}
	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})

	// 4. Enroll with platform
	slog.Info("enrolling with platform", "api_url", apiURL)
	enrollment, err := enroll(apiURL, token, hostname, osFamily, osVersion, arch, cloud, string(csrPEM))
	if err != nil {
		return fmt.Errorf("enrollment failed: %w", err)
	}
	slog.Info("enrolled successfully", "agent_id", enrollment.AgentID)

	// 5. Write files
	if err := writeFiles(privateKey, enrollment, apiURL); err != nil {
		return fmt.Errorf("failed to write files: %w", err)
	}

	// 6. Install binary
	if err := installBinary(); err != nil {
		return fmt.Errorf("failed to install binary: %w", err)
	}

	// 7. Create and start systemd service
	if err := setupSystemd(); err != nil {
		return fmt.Errorf("failed to setup systemd: %w", err)
	}

	slog.Info("installation complete",
		"agent_id", enrollment.AgentID,
		"config", configFile,
		"service", "securitycentral-agent",
	)
	fmt.Println()
	fmt.Println("==> SecurityCentral Agent installed successfully!")
	fmt.Printf("    Agent ID: %s\n", enrollment.AgentID)
	fmt.Printf("    Config:   %s\n", configFile)
	fmt.Println("    Service:  securitycentral-agent.service")
	fmt.Println()
	fmt.Println("    Check status: sudo systemctl status securitycentral-agent")
	fmt.Println("    View logs:    sudo journalctl -u securitycentral-agent -f")

	return nil
}

// ---------------------------------------------------------------------------
// Enrollment API call
// ---------------------------------------------------------------------------

func enroll(apiURL, token, hostname, osFamily, osVersion, arch string, cloud sysinfo.CloudInfo, csr string) (*enrollData, error) {
	body := enrollRequest{
		Token:           token,
		Hostname:        hostname,
		OsFamily:        osFamily,
		OsVersion:       osVersion,
		Arch:            arch,
		CloudProvider:   cloud.Provider,
		CloudRegion:     cloud.Region,
		CloudInstanceId: cloud.InstanceID,
		CSR:             csr,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := strings.TrimRight(apiURL, "/") + "/v1/agents/enroll"
	resp, err := http.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to reach API at %s: %w", url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result enrollResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("API error: [%s] %s", result.Errors[0].Code, result.Errors[0].Message)
	}

	if result.Data == nil {
		return nil, fmt.Errorf("unexpected response: no data")
	}

	return result.Data, nil
}

// ---------------------------------------------------------------------------
// File writes
// ---------------------------------------------------------------------------

func writeFiles(key *ecdsa.PrivateKey, enrollment *enrollData, apiURL string) error {
	// Create directories
	for _, dir := range []string{configDir, certDir, dataDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create %s: %w", dir, err)
		}
	}

	// Write private key
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return fmt.Errorf("failed to marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(filepath.Join(certDir, "agent.key"), keyPEM, 0600); err != nil {
		return fmt.Errorf("failed to write agent key: %w", err)
	}

	// Write signed certificate
	if err := os.WriteFile(filepath.Join(certDir, "agent.crt"), []byte(enrollment.SignedCert), 0644); err != nil {
		return fmt.Errorf("failed to write agent cert: %w", err)
	}

	// Write CA certificate
	if err := os.WriteFile(filepath.Join(certDir, "ca.crt"), []byte(enrollment.CACert), 0644); err != nil {
		return fmt.Errorf("failed to write CA cert: %w", err)
	}

	// Write config
	cfg := enrollment.Config
	scanInterval := cfg.Scan.Interval
	if scanInterval == "" {
		scanInterval = "6h"
	}

	yamlContent := fmt.Sprintf(`# SecurityCentral Agent Configuration (auto-generated)
agent_id: "%s"
api_url: "%s"

tls:
  cert: "%s/agent.crt"
  key: "%s/agent.key"
  ca: "%s/ca.crt"

scan:
  on_startup: %t
  interval: "%s"
  packages: %t
  compliance: %t

heartbeat:
  interval: "60s"

environment: "%s"
`,
		enrollment.AgentID,
		strings.TrimRight(apiURL, "/"),
		certDir, certDir, certDir,
		cfg.Scan.OnStartup,
		scanInterval,
		cfg.Scan.Packages,
		cfg.Scan.Compliance,
		cfg.Environment,
	)

	if err := os.WriteFile(configFile, []byte(yamlContent), 0644); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// ---------------------------------------------------------------------------
// Binary installation
// ---------------------------------------------------------------------------

func installBinary() error {
	// Copy the currently running binary to /usr/local/bin/sc-agent
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to find current executable: %w", err)
	}

	// If already at the target, skip
	if self == binaryDst {
		return nil
	}

	input, err := os.ReadFile(self)
	if err != nil {
		return fmt.Errorf("failed to read current binary: %w", err)
	}

	if err := os.WriteFile(binaryDst, input, 0755); err != nil {
		return fmt.Errorf("failed to write binary to %s: %w", binaryDst, err)
	}

	slog.Info("installed binary", "path", binaryDst)
	return nil
}

// ---------------------------------------------------------------------------
// Systemd setup
// ---------------------------------------------------------------------------

const systemdUnit = `[Unit]
Description=SecurityCentral Infrastructure Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sc-agent run --config /etc/securitycentral/agent.yml
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sc-agent
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/securitycentral /etc/securitycentral

[Install]
WantedBy=multi-user.target
`

func setupSystemd() error {
	if err := os.WriteFile(unitFile, []byte(systemdUnit), 0644); err != nil {
		return fmt.Errorf("failed to write unit file: %w", err)
	}

	commands := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", "securitycentral-agent.service"},
		{"systemctl", "start", "securitycentral-agent.service"},
	}

	for _, args := range commands {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to run %s: %w", strings.Join(args, " "), err)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

func detectOS() (family, version string) {
	family = "unknown"
	version = "unknown"

	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return
	}

	fields := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			fields[parts[0]] = strings.Trim(parts[1], "\"")
		}
	}

	if id, ok := fields["ID"]; ok {
		switch id {
		case "ubuntu", "debian", "alpine":
			family = id
		case "centos", "rhel", "rocky", "almalinux":
			family = "centos"
		default:
			family = id
		}
	}

	if v, ok := fields["VERSION_ID"]; ok {
		version = v
	}

	return
}

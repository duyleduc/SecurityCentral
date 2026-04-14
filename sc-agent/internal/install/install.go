// Package install handles one-time agent installation: registration with the
// platform API, config creation, binary installation, and systemd service setup.
package install

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/securitycentral/sc-agent/internal/config"
	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

const (
	configDir  = "/etc/securitycentral"
	configFile = "/etc/securitycentral/agent.json"
	binaryDst  = "/usr/local/bin/sc-agent"
	unitFile   = "/etc/systemd/system/sc-agent.service"
)

// Run performs the full installation flow.
func Run(token, apiURL string) error {
	log := slog.With("component", "install")
	log.Info("starting agent installation")

	// 1. Detect platform
	sys := sysinfo.GetSystemInfo()
	osFamily, osVersion := detectOS()
	log.Info("detected platform",
		"hostname", sys.Hostname,
		"os", osFamily,
		"version", osVersion,
		"arch", runtime.GOARCH,
	)

	// 2. Register with platform
	log.Info("registering with platform", "api_url", apiURL)
	client := platform.NewClient(apiURL, "")
	resp, err := client.Register(platform.RegisterRequest{
		Token:        token,
		Hostname:     sys.Hostname,
		OSFamily:     osFamily,
		OSVersion:    osVersion,
		AgentVersion: "0.1.0",
	})
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}
	log.Info("registered successfully", "agent_id", resp.AgentID, "server_id", resp.ServerID)

	// 3. Write config
	if err := writeConfig(resp, apiURL); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	// 4. Install binary to /usr/local/bin
	if err := installBinary(); err != nil {
		log.Warn("failed to install binary (non-fatal)", "error", err)
	}

	// 5. Setup systemd service
	if err := setupSystemd(); err != nil {
		log.Warn("failed to setup systemd (non-fatal, start manually with: sc-agent run)", "error", err)
	}

	log.Info("installation complete",
		"agent_id", resp.AgentID,
		"config", configFile,
	)

	fmt.Println()
	fmt.Println("==> SecurityCentral Agent installed successfully!")
	fmt.Printf("    Server ID: %s\n", resp.ServerID)
	fmt.Printf("    Agent ID:  %s\n", resp.AgentID)
	fmt.Printf("    Config:    %s\n", configFile)
	fmt.Println()
	fmt.Println("    Check status: sudo systemctl status sc-agent")
	fmt.Println("    View logs:    sudo journalctl -u sc-agent -f")
	fmt.Println("    Manual start: sudo sc-agent run")

	return nil
}

func writeConfig(resp *platform.RegisterResponse, apiURL string) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	cfg := config.DefaultConfig()
	cfg.APIBaseURL = strings.TrimRight(apiURL, "/")
	cfg.AgentID = resp.AgentID
	cfg.APIKey = resp.APIKey

	return cfg.SaveToFile(configFile)
}

func installBinary() error {
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find current executable: %w", err)
	}

	// Already at target
	if self == binaryDst {
		return nil
	}

	input, err := os.ReadFile(self)
	if err != nil {
		return fmt.Errorf("read current binary: %w", err)
	}

	if err := os.WriteFile(binaryDst, input, 0755); err != nil {
		return fmt.Errorf("write binary to %s: %w", binaryDst, err)
	}

	slog.Info("installed binary", "path", binaryDst)
	return nil
}

const systemdUnit = `[Unit]
Description=SecurityCentral Infrastructure Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sc-agent run --config /etc/securitycentral/agent.json
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sc-agent

[Install]
WantedBy=multi-user.target
`

func setupSystemd() error {
	if err := os.WriteFile(unitFile, []byte(systemdUnit), 0644); err != nil {
		return fmt.Errorf("write unit file: %w", err)
	}

	commands := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", "sc-agent.service"},
		{"systemctl", "start", "sc-agent.service"},
	}

	for _, args := range commands {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("run %s: %w", strings.Join(args, " "), err)
		}
	}

	return nil
}

func detectOS() (family, version string) {
	family = runtime.GOOS
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
		family = id
	}
	if v, ok := fields["VERSION_ID"]; ok {
		version = v
	}

	return
}

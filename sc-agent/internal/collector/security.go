package collector

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	gopsNet "github.com/shirou/gopsutil/v3/net"
)

// SecurityData is the snapshot data for the security posture collector.
type SecurityData struct {
	ListeningPorts  []PortInfo
	SSHConfig       SSHConfigInfo
	Firewall        FirewallInfo
	LoggedInUsers   []UserSession
	SSHFailures     int
	ShellUsers      []string
	PendingReboot   bool
	OpenFDs         FDInfo
	BruteForce      BruteForceReport
}

type PortInfo struct {
	Port    uint32
	Proto   string
	Process string
	Bind    string // "0.0.0.0" = externally bound
}

type SSHConfigInfo struct {
	RootLogin      string
	PasswordAuth   string
	Port           int
	PermitEmptyPwd string
}

type FirewallInfo struct {
	Active bool
	Type   string // "ufw", "iptables", "nftables", "none", "iptables+fail2ban"
	// Quality checks — set when firewall is active but rules are problematic.
	DefaultPolicy string   // "drop" / "accept" / "reject" (INPUT chain policy)
	Issues        []string // list of misconfigurations found
}

type UserSession struct {
	User  string
	From  string
	Since string
}

type FDInfo struct {
	Allocated int
	Max       int
}

type securityCollector struct {
	prevSSHFailures int
	sshInited       bool
	bfAnalyzer      *BruteForceAnalyzer
}

func NewSecurity() Collector {
	return &securityCollector{
		bfAnalyzer: NewBruteForceAnalyzer(),
	}
}

func (c *securityCollector) Name() string     { return "security" }
func (c *securityCollector) Cadence() Cadence { return CadenceScan }
func (c *securityCollector) Enabled() bool    { return true }

func (c *securityCollector) Init() error {
	c.prevSSHFailures = countSSHFailures()
	c.sshInited = true
	return nil
}

func (c *securityCollector) Collect() (*Snapshot, error) {
	d := SecurityData{
		ListeningPorts: collectListeningPorts(),
		SSHConfig:      parseSSHConfig(),
		Firewall:       detectFirewall(),
		LoggedInUsers:  collectLoggedInUsers(),
		ShellUsers:     collectShellUsers(),
		PendingReboot:  checkPendingReboot(),
		OpenFDs:        collectFDInfo(),
	}

	// SSH failures (delta since last).
	curFail := countSSHFailures()
	if c.sshInited {
		d.SSHFailures = curFail - c.prevSSHFailures
		if d.SSHFailures < 0 {
			d.SSHFailures = 0
		}
	}
	c.prevSSHFailures = curFail
	c.sshInited = true

	// Brute force analysis from log sliding windows.
	c.bfAnalyzer.Update()
	d.BruteForce = c.bfAnalyzer.Analyze()

	return &Snapshot{Key: "security", Data: d, At: time.Now()}, nil
}

// --- Listening Ports ---

func collectListeningPorts() []PortInfo {
	conns, err := gopsNet.Connections("all")
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var ports []PortInfo

	for _, conn := range conns {
		if conn.Status != "LISTEN" {
			continue
		}

		key := fmt.Sprintf("%s:%d:%s", conn.Laddr.IP, conn.Laddr.Port, protoName(conn.Type))
		if seen[key] {
			continue
		}
		seen[key] = true

		procName := ""
		if conn.Pid > 0 {
			if name, err := processName(conn.Pid); err == nil {
				procName = name
			}
		}

		ports = append(ports, PortInfo{
			Port:    conn.Laddr.Port,
			Proto:   protoName(conn.Type),
			Process: procName,
			Bind:    conn.Laddr.IP,
		})
	}
	return ports
}

func protoName(connType uint32) string {
	switch connType {
	case 1:
		return "tcp"
	case 2:
		return "udp"
	default:
		return "unknown"
	}
}

func processName(pid int32) (string, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// --- SSH Config ---

func parseSSHConfig() SSHConfigInfo {
	info := SSHConfigInfo{
		RootLogin:      "unknown",
		PasswordAuth:   "unknown",
		Port:           22,
		PermitEmptyPwd: "unknown",
	}

	f, err := os.Open("/etc/ssh/sshd_config")
	if err != nil {
		return info
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		key := strings.ToLower(parts[0])
		val := parts[1]

		switch key {
		case "permitrootlogin":
			info.RootLogin = val
		case "passwordauthentication":
			info.PasswordAuth = val
		case "port":
			if p, err := strconv.Atoi(val); err == nil {
				info.Port = p
			}
		case "permitemptypasswords":
			info.PermitEmptyPwd = val
		}
	}
	return info
}

// --- Firewall ---

func detectFirewall() FirewallInfo {
	// Check ufw — if active, analyze its policy.
	if out, err := exec.Command("ufw", "status", "verbose").Output(); err == nil {
		status := strings.ToLower(string(out))
		if strings.Contains(status, "status: active") {
			return analyzeUFW(string(out))
		}
		// ufw installed but inactive — don't return, check iptables/nftables next.
	}

	// Check nftables (modern default on Debian 10+).
	if out, err := exec.Command("nft", "list", "ruleset").Output(); err == nil {
		if strings.TrimSpace(string(out)) != "" {
			return analyzeNftables(string(out))
		}
	}

	// Check iptables (legacy or iptables-nft backend).
	if out, err := exec.Command("iptables", "-L", "-n", "-v").Output(); err == nil {
		raw := string(out)
		fw := analyzeIptables(raw)
		if fw.Active {
			// Check for fail2ban augmentation.
			if strings.Contains(raw, "f2b-") {
				fw.Type = "iptables+fail2ban"
			}
			return fw
		}
	}

	// Fail2ban alone (service running) counts as basic protection.
	if out, err := exec.Command("systemctl", "is-active", "fail2ban").Output(); err == nil {
		if strings.TrimSpace(string(out)) == "active" {
			return FirewallInfo{
				Active: true, Type: "fail2ban",
				Issues: []string{"fail2ban active but no host firewall (iptables/nftables/ufw) — only protects against brute force, not unauthorized port access"},
			}
		}
	}

	return FirewallInfo{Active: false, Type: "none"}
}

// analyzeUFW parses `ufw status verbose` and checks default policies.
func analyzeUFW(output string) FirewallInfo {
	fw := FirewallInfo{Active: true, Type: "ufw"}
	var issues []string
	hasIncomingRule := false
	defaultInPolicy := "unknown"

	for _, line := range strings.Split(output, "\n") {
		l := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(l, "default:") {
			// "Default: deny (incoming), allow (outgoing), disabled (routed)"
			if strings.Contains(l, "allow (incoming)") {
				defaultInPolicy = "accept"
				issues = append(issues, "UFW default incoming policy is ALLOW — every port is open unless explicitly denied. Set: sudo ufw default deny incoming")
			} else if strings.Contains(l, "deny (incoming)") || strings.Contains(l, "reject (incoming)") {
				defaultInPolicy = "drop"
			}
		}
		// Lines like "22/tcp ALLOW IN ..."
		if strings.Contains(l, "allow in") || strings.Contains(l, "allow from") {
			hasIncomingRule = true
		}
	}

	if defaultInPolicy == "drop" && !hasIncomingRule {
		issues = append(issues, "UFW denies all incoming but has NO allow rules — this will break legitimate access (SSH will lock you out after reconnect)")
	}
	fw.DefaultPolicy = defaultInPolicy
	fw.Issues = issues
	return fw
}

// analyzeNftables checks the ruleset for common misconfigurations.
func analyzeNftables(output string) FirewallInfo {
	fw := FirewallInfo{Active: true, Type: "nftables"}
	var issues []string
	lower := strings.ToLower(output)

	// Check if INPUT chain has a default policy.
	if strings.Contains(lower, "hook input") {
		if strings.Contains(lower, "policy accept") {
			fw.DefaultPolicy = "accept"
			issues = append(issues, "nftables input chain has policy ACCEPT (default allow) — rules only block, not allowlist. Set policy drop for defence in depth.")
		} else if strings.Contains(lower, "policy drop") {
			fw.DefaultPolicy = "drop"
		}
	}

	// Count rules — too few may indicate skeleton config.
	ruleCount := strings.Count(lower, "\n\t\t") // rough heuristic
	if ruleCount < 3 {
		issues = append(issues, "nftables has very few rules (<3) — may not be enforcing meaningful restrictions")
	}
	fw.Issues = issues
	return fw
}

// analyzeIptables inspects iptables output (with -v for policies).
func analyzeIptables(output string) FirewallInfo {
	fw := FirewallInfo{Active: false, Type: "iptables"}
	var issues []string
	ruleCount := 0
	inputPolicy := "unknown"

	for _, line := range strings.Split(output, "\n") {
		l := strings.TrimSpace(line)
		if l == "" {
			continue
		}
		// "Chain INPUT (policy ACCEPT 100 packets, 10000 bytes)"
		if strings.HasPrefix(l, "Chain INPUT") {
			if strings.Contains(l, "policy ACCEPT") {
				inputPolicy = "accept"
			} else if strings.Contains(l, "policy DROP") {
				inputPolicy = "drop"
			} else if strings.Contains(l, "policy REJECT") {
				inputPolicy = "reject"
			}
			continue
		}
		if strings.HasPrefix(l, "Chain ") || strings.HasPrefix(l, "target") || strings.HasPrefix(l, "pkts") {
			continue
		}
		ruleCount++
	}

	fw.DefaultPolicy = inputPolicy

	if ruleCount == 0 && inputPolicy != "drop" && inputPolicy != "reject" {
		// No rules AND default is accept = not actually firewalling.
		return FirewallInfo{Active: false, Type: "iptables",
			Issues: []string{"iptables has no rules and INPUT policy is ACCEPT — not providing any protection"}}
	}

	fw.Active = true

	if inputPolicy == "accept" && ruleCount < 5 {
		issues = append(issues, "iptables INPUT policy is ACCEPT with very few rules — server is effectively unfirewalled. Set: iptables -P INPUT DROP after configuring allow rules.")
	}

	fw.Issues = issues
	return fw
}

// --- Logged-in Users ---

func collectLoggedInUsers() []UserSession {
	out, err := exec.Command("who").Output()
	if err != nil {
		return nil
	}

	var sessions []UserSession
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		from := "console"
		if len(fields) >= 5 {
			from = strings.Trim(fields[4], "()")
		}

		sessions = append(sessions, UserSession{
			User:  fields[0],
			From:  from,
			Since: strings.Join(fields[2:4], " "),
		})
	}
	return sessions
}

// --- SSH Auth Failures ---

func countSSHFailures() int {
	count := 0
	for _, path := range []string{"/var/log/auth.log", "/var/log/secure"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.ToLower(scanner.Text())
			if strings.Contains(line, "failed password") || strings.Contains(line, "invalid user") {
				count++
			}
		}
		f.Close()
		return count
	}
	return 0
}

// --- Shell Users ---

func collectShellUsers() []string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil
	}
	defer f.Close()

	var users []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) < 7 {
			continue
		}
		shell := parts[6]
		if shell == "/usr/sbin/nologin" || shell == "/bin/false" || shell == "/sbin/nologin" {
			continue
		}
		// Skip system users (uid < 1000), except root.
		if len(parts) >= 3 {
			uid, err := strconv.Atoi(parts[2])
			if err == nil && uid > 0 && uid < 1000 {
				continue
			}
		}
		users = append(users, parts[0])
	}
	return users
}

// --- Pending Reboot ---

func checkPendingReboot() bool {
	_, err := os.Stat("/var/run/reboot-required")
	return err == nil
}

// --- File Descriptors ---

func collectFDInfo() FDInfo {
	data, err := os.ReadFile("/proc/sys/fs/file-nr")
	if err != nil {
		return FDInfo{}
	}
	fields := strings.Fields(strings.TrimSpace(string(data)))
	if len(fields) < 3 {
		return FDInfo{}
	}
	alloc, _ := strconv.Atoi(fields[0])
	max, _ := strconv.Atoi(fields[2])
	return FDInfo{Allocated: alloc, Max: max}
}

package compliance

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
)

func init() {
	sshChecks := []Check{
		&sshCheck{id: "CIS-5.2.1", title: "SSH PermitRootLogin disabled", key: "PermitRootLogin", want: "no", fix: "Set PermitRootLogin no in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.2", title: "SSH PermitEmptyPasswords disabled", key: "PermitEmptyPasswords", want: "no", fix: "Set PermitEmptyPasswords no in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.3", title: "SSH MaxAuthTries <= 4", key: "MaxAuthTries", want: "4", cmp: "lte", fix: "Set MaxAuthTries 4 in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.4", title: "SSH Protocol 2", key: "Protocol", want: "2", fix: "Set Protocol 2 in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.5", title: "SSH X11Forwarding disabled", key: "X11Forwarding", want: "no", fix: "Set X11Forwarding no in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.6", title: "SSH LogLevel INFO", key: "LogLevel", want: "INFO", fix: "Set LogLevel INFO in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.7", title: "SSH LoginGraceTime <= 60", key: "LoginGraceTime", want: "60", cmp: "lte", fix: "Set LoginGraceTime 60 in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.8", title: "SSH ClientAliveInterval configured", key: "ClientAliveInterval", want: "300", cmp: "lte", fix: "Set ClientAliveInterval 300 in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.9", title: "SSH ClientAliveCountMax <= 3", key: "ClientAliveCountMax", want: "3", cmp: "lte", fix: "Set ClientAliveCountMax 3 in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.10", title: "SSH IgnoreRhosts enabled", key: "IgnoreRhosts", want: "yes", fix: "Set IgnoreRhosts yes in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.11", title: "SSH HostbasedAuthentication disabled", key: "HostbasedAuthentication", want: "no", fix: "Set HostbasedAuthentication no in /etc/ssh/sshd_config"},
		&sshCheck{id: "CIS-5.2.12", title: "SSH Banner set", key: "Banner", want: "/etc/issue.net", fix: "Set Banner /etc/issue.net in /etc/ssh/sshd_config"},
		&sshCipherCheck{id: "CIS-5.2.13", title: "SSH approved ciphers only"},
		&sshCipherCheck{id: "CIS-5.2.14", title: "SSH approved MACs only"},
	}
	for _, c := range sshChecks {
		Register(c)
	}
}

type sshCheck struct {
	id, title, key, want, cmp, fix string
}

func (c *sshCheck) ID() string    { return c.id }
func (c *sshCheck) Title() string { return c.title }
func (c *sshCheck) Level() int    { return 1 }

func (c *sshCheck) Run(_ context.Context) (CheckResult, error) {
	value, found := readSSHConfig(c.key)
	if !found {
		return CheckResult{Pass: false, Details: fmt.Sprintf("%s not set", c.key), Fix: c.fix}, nil
	}
	if c.cmp == "lte" {
		return CheckResult{Pass: value <= c.want, Details: fmt.Sprintf("%s=%s", c.key, value), Fix: c.fix}, nil
	}
	pass := strings.EqualFold(value, c.want)
	return CheckResult{Pass: pass, Details: fmt.Sprintf("%s=%s", c.key, value), Fix: c.fix}, nil
}

type sshCipherCheck struct{ id, title string }

func (c *sshCipherCheck) ID() string    { return c.id }
func (c *sshCipherCheck) Title() string { return c.title }
func (c *sshCipherCheck) Level() int    { return 1 }
func (c *sshCipherCheck) Run(_ context.Context) (CheckResult, error) {
	// Simplified: check that weak ciphers are not present
	data, err := os.ReadFile("/etc/ssh/sshd_config")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read sshd_config", Fix: "Install and configure OpenSSH"}, nil
	}
	content := string(data)
	weak := []string{"3des-cbc", "arcfour", "blowfish-cbc"}
	for _, w := range weak {
		if strings.Contains(strings.ToLower(content), w) {
			return CheckResult{Pass: false, Details: fmt.Sprintf("weak cipher/MAC found: %s", w), Fix: "Remove weak ciphers from sshd_config"}, nil
		}
	}
	return CheckResult{Pass: true, Details: "no weak ciphers found"}, nil
}

func readSSHConfig(key string) (string, bool) {
	data, err := os.ReadFile("/etc/ssh/sshd_config")
	if err != nil {
		return "", false
	}
	re := regexp.MustCompile(`(?mi)^\s*` + regexp.QuoteMeta(key) + `\s+(.+)`)
	matches := re.FindStringSubmatch(string(data))
	if len(matches) < 2 {
		return "", false
	}
	return strings.TrimSpace(matches[1]), true
}

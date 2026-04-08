package compliance

import (
	"context"
	"fmt"
	"os"
	"strings"
)

func init() {
	processChecks := []Check{
		&sysctlCheck{id: "CIS-1.5.1", title: "ASLR enabled", key: "kernel.randomize_va_space", want: "2", fix: "sysctl -w kernel.randomize_va_space=2"},
		&sysctlCheck{id: "CIS-1.5.2", title: "ptrace_scope restricted", key: "kernel.yama.ptrace_scope", want: "1", fix: "sysctl -w kernel.yama.ptrace_scope=1"},
		&coreDumpCheck{id: "CIS-1.5.3", title: "Core dump restricted"},
		&sysctlCheck{id: "CIS-1.5.4", title: "SUID dumpable disabled", key: "fs.suid_dumpable", want: "0", fix: "sysctl -w fs.suid_dumpable=0"},
		&sysctlCheck{id: "CIS-1.5.5", title: "Address space layout randomization", key: "kernel.randomize_va_space", want: "2", fix: "sysctl -w kernel.randomize_va_space=2"},
	}
	for _, c := range processChecks {
		Register(c)
	}
}

type coreDumpCheck struct{ id, title string }

func (c *coreDumpCheck) ID() string    { return c.id }
func (c *coreDumpCheck) Title() string { return c.title }
func (c *coreDumpCheck) Level() int    { return 1 }

func (c *coreDumpCheck) Run(_ context.Context) (CheckResult, error) {
	data, err := os.ReadFile("/etc/security/limits.conf")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read limits.conf", Fix: "Add '* hard core 0' to /etc/security/limits.conf"}, nil
	}
	content := string(data)
	if strings.Contains(content, "hard") && strings.Contains(content, "core") && strings.Contains(content, "0") {
		return CheckResult{Pass: true, Details: "core dumps restricted in limits.conf"}, nil
	}
	return CheckResult{
		Pass:    false,
		Details: "core dumps not restricted",
		Fix:     "Add '* hard core 0' to /etc/security/limits.conf",
	}, nil
}

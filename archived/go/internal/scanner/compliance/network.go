package compliance

import (
	"context"
	"fmt"
	"os"
	"strings"
)

func init() {
	netChecks := []Check{
		&sysctlCheck{id: "CIS-3.1.1", title: "IP forwarding disabled", key: "net.ipv4.ip_forward", want: "0", fix: "sysctl -w net.ipv4.ip_forward=0"},
		&sysctlCheck{id: "CIS-3.2.1", title: "ICMP redirects not accepted", key: "net.ipv4.conf.all.accept_redirects", want: "0", fix: "sysctl -w net.ipv4.conf.all.accept_redirects=0"},
		&sysctlCheck{id: "CIS-3.2.2", title: "Secure ICMP redirects not accepted", key: "net.ipv4.conf.all.secure_redirects", want: "0", fix: "sysctl -w net.ipv4.conf.all.secure_redirects=0"},
		&sysctlCheck{id: "CIS-3.2.3", title: "Source routed packets rejected", key: "net.ipv4.conf.all.accept_source_route", want: "0", fix: "sysctl -w net.ipv4.conf.all.accept_source_route=0"},
		&sysctlCheck{id: "CIS-3.3.1", title: "TCP SYN cookies enabled", key: "net.ipv4.tcp_syncookies", want: "1", fix: "sysctl -w net.ipv4.tcp_syncookies=1"},
		&sysctlCheck{id: "CIS-3.3.2", title: "IPv6 router advertisements disabled", key: "net.ipv6.conf.all.accept_ra", want: "0", fix: "sysctl -w net.ipv6.conf.all.accept_ra=0"},
	}
	for _, c := range netChecks {
		Register(c)
	}
}

type sysctlCheck struct{ id, title, key, want, fix string }

func (c *sysctlCheck) ID() string    { return c.id }
func (c *sysctlCheck) Title() string { return c.title }
func (c *sysctlCheck) Level() int    { return 1 }

func (c *sysctlCheck) Run(_ context.Context) (CheckResult, error) {
	path := "/proc/sys/" + strings.ReplaceAll(c.key, ".", "/")
	data, err := os.ReadFile(path)
	if err != nil {
		return CheckResult{Pass: false, Details: fmt.Sprintf("cannot read %s", c.key), Fix: c.fix}, nil
	}
	value := strings.TrimSpace(string(data))
	pass := value == c.want
	return CheckResult{Pass: pass, Details: fmt.Sprintf("%s=%s", c.key, value), Fix: c.fix}, nil
}

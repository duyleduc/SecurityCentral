package compliance

import (
	"context"
	"fmt"
	"os"
	"strings"
)

func init() {
	userChecks := []Check{
		&loginDefsCheck{id: "CIS-5.4.1.1", title: "Password max days <= 365", key: "PASS_MAX_DAYS", want: "365", fix: "Set PASS_MAX_DAYS 365 in /etc/login.defs"},
		&loginDefsCheck{id: "CIS-5.4.1.2", title: "Password min days >= 1", key: "PASS_MIN_DAYS", want: "1", fix: "Set PASS_MIN_DAYS 1 in /etc/login.defs"},
		&loginDefsCheck{id: "CIS-5.4.1.3", title: "Password warn age >= 7", key: "PASS_WARN_AGE", want: "7", fix: "Set PASS_WARN_AGE 7 in /etc/login.defs"},
		&loginDefsCheck{id: "CIS-5.4.1.4", title: "Inactive account lock <= 30 days", key: "INACTIVE", want: "30", fix: "Set INACTIVE 30 via useradd -D"},
		&umaskCheck{id: "CIS-5.4.4", title: "Default umask is 027 or more restrictive"},
		&rootUIDCheck{id: "CIS-6.2.5", title: "Root is only UID 0 account"},
		&duplicateUIDCheck{id: "CIS-6.2.15", title: "No duplicate UIDs"},
		&duplicateGIDCheck{id: "CIS-6.2.16", title: "No duplicate GIDs"},
	}
	for _, c := range userChecks {
		Register(c)
	}
}

type loginDefsCheck struct{ id, title, key, want, fix string }

func (c *loginDefsCheck) ID() string    { return c.id }
func (c *loginDefsCheck) Title() string { return c.title }
func (c *loginDefsCheck) Level() int    { return 1 }

func (c *loginDefsCheck) Run(_ context.Context) (CheckResult, error) {
	data, err := os.ReadFile("/etc/login.defs")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read /etc/login.defs", Fix: c.fix}, nil
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == c.key {
			return CheckResult{Pass: fields[1] <= c.want, Details: fmt.Sprintf("%s=%s", c.key, fields[1]), Fix: c.fix}, nil
		}
	}
	return CheckResult{Pass: false, Details: fmt.Sprintf("%s not set", c.key), Fix: c.fix}, nil
}

type umaskCheck struct{ id, title string }

func (c *umaskCheck) ID() string    { return c.id }
func (c *umaskCheck) Title() string { return c.title }
func (c *umaskCheck) Level() int    { return 1 }

func (c *umaskCheck) Run(_ context.Context) (CheckResult, error) {
	for _, path := range []string{"/etc/bash.bashrc", "/etc/profile", "/etc/login.defs"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "umask") || strings.HasPrefix(line, "UMASK") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					val := fields[1]
					if val == "027" || val == "077" {
						return CheckResult{Pass: true, Details: fmt.Sprintf("umask=%s in %s", val, path)}, nil
					}
					return CheckResult{Pass: false, Details: fmt.Sprintf("umask=%s in %s (should be 027 or more)", val, path), Fix: "Set umask 027 in /etc/profile and /etc/bash.bashrc"}, nil
				}
			}
		}
	}
	return CheckResult{Pass: false, Details: "umask not explicitly set", Fix: "Set umask 027 in /etc/profile"}, nil
}

type rootUIDCheck struct{ id, title string }

func (c *rootUIDCheck) ID() string    { return c.id }
func (c *rootUIDCheck) Title() string { return c.title }
func (c *rootUIDCheck) Level() int    { return 1 }

func (c *rootUIDCheck) Run(_ context.Context) (CheckResult, error) {
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read /etc/passwd"}, nil
	}
	var uid0Users []string
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) >= 4 && fields[2] == "0" {
			uid0Users = append(uid0Users, fields[0])
		}
	}
	if len(uid0Users) == 1 && uid0Users[0] == "root" {
		return CheckResult{Pass: true, Details: "only root has UID 0"}, nil
	}
	return CheckResult{Pass: false, Details: fmt.Sprintf("UID 0 users: %s", strings.Join(uid0Users, ", ")), Fix: "Remove UID 0 from non-root accounts"}, nil
}

type duplicateUIDCheck struct{ id, title string }

func (c *duplicateUIDCheck) ID() string    { return c.id }
func (c *duplicateUIDCheck) Title() string { return c.title }
func (c *duplicateUIDCheck) Level() int    { return 1 }

func (c *duplicateUIDCheck) Run(_ context.Context) (CheckResult, error) {
	return checkDuplicateField("/etc/passwd", 2, "UID")
}

type duplicateGIDCheck struct{ id, title string }

func (c *duplicateGIDCheck) ID() string    { return c.id }
func (c *duplicateGIDCheck) Title() string { return c.title }
func (c *duplicateGIDCheck) Level() int    { return 1 }

func (c *duplicateGIDCheck) Run(_ context.Context) (CheckResult, error) {
	return checkDuplicateField("/etc/group", 2, "GID")
}

func checkDuplicateField(path string, fieldIdx int, label string) (CheckResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return CheckResult{Pass: false, Details: fmt.Sprintf("cannot read %s", path)}, nil
	}
	seen := make(map[string][]string)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) > fieldIdx {
			seen[fields[fieldIdx]] = append(seen[fields[fieldIdx]], fields[0])
		}
	}
	var dupes []string
	for id, users := range seen {
		if len(users) > 1 {
			dupes = append(dupes, fmt.Sprintf("%s=%s(%s)", label, id, strings.Join(users, ",")))
		}
	}
	if len(dupes) == 0 {
		return CheckResult{Pass: true, Details: fmt.Sprintf("no duplicate %ss", label)}, nil
	}
	return CheckResult{Pass: false, Details: strings.Join(dupes, "; "), Fix: fmt.Sprintf("Resolve duplicate %ss", label)}, nil
}

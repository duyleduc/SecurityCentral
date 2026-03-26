package compliance

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func init() {
	fsChecks := []Check{
		&moduleDisabledCheck{id: "CIS-1.1.1.1", title: "cramfs module disabled", module: "cramfs"},
		&moduleDisabledCheck{id: "CIS-1.1.1.2", title: "squashfs module disabled", module: "squashfs"},
		&moduleDisabledCheck{id: "CIS-1.1.1.3", title: "udf module disabled", module: "udf"},
		&mountOptionCheck{id: "CIS-1.1.3", title: "/tmp mounted with nodev", mount: "/tmp", option: "nodev"},
		&mountOptionCheck{id: "CIS-1.1.4", title: "/tmp mounted with nosuid", mount: "/tmp", option: "nosuid"},
		&mountOptionCheck{id: "CIS-1.1.5", title: "/tmp mounted with noexec", mount: "/tmp", option: "noexec"},
		&separatePartitionCheck{id: "CIS-1.1.2", title: "/tmp on separate partition", mount: "/tmp"},
		&stickyBitCheck{id: "CIS-1.1.21", title: "Sticky bit on world-writable dirs"},
	}
	for _, c := range fsChecks {
		Register(c)
	}
}

type moduleDisabledCheck struct{ id, title, module string }

func (c *moduleDisabledCheck) ID() string    { return c.id }
func (c *moduleDisabledCheck) Title() string { return c.title }
func (c *moduleDisabledCheck) Level() int    { return 1 }

func (c *moduleDisabledCheck) Run(_ context.Context) (CheckResult, error) {
	out, err := exec.Command("modprobe", "-n", "-v", c.module).Output()
	if err != nil {
		return CheckResult{Pass: true, Details: fmt.Sprintf("module %s not loadable", c.module)}, nil
	}
	content := string(out)
	if strings.Contains(content, "install /bin/true") || strings.Contains(content, "install /bin/false") {
		return CheckResult{Pass: true, Details: fmt.Sprintf("module %s disabled", c.module)}, nil
	}
	return CheckResult{
		Pass:    false,
		Details: fmt.Sprintf("module %s is loadable", c.module),
		Fix:     fmt.Sprintf("echo 'install %s /bin/true' >> /etc/modprobe.d/%s.conf", c.module, c.module),
	}, nil
}

type mountOptionCheck struct{ id, title, mount, option string }

func (c *mountOptionCheck) ID() string    { return c.id }
func (c *mountOptionCheck) Title() string { return c.title }
func (c *mountOptionCheck) Level() int    { return 1 }

func (c *mountOptionCheck) Run(_ context.Context) (CheckResult, error) {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read /proc/mounts"}, nil
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 4 && fields[1] == c.mount {
			if strings.Contains(fields[3], c.option) {
				return CheckResult{Pass: true, Details: fmt.Sprintf("%s has %s", c.mount, c.option)}, nil
			}
			return CheckResult{
				Pass:    false,
				Details: fmt.Sprintf("%s missing %s option", c.mount, c.option),
				Fix:     fmt.Sprintf("Add %s to %s mount options in /etc/fstab", c.option, c.mount),
			}, nil
		}
	}
	return CheckResult{Pass: false, Details: fmt.Sprintf("%s not mounted", c.mount)}, nil
}

type separatePartitionCheck struct{ id, title, mount string }

func (c *separatePartitionCheck) ID() string    { return c.id }
func (c *separatePartitionCheck) Title() string { return c.title }
func (c *separatePartitionCheck) Level() int    { return 1 }

func (c *separatePartitionCheck) Run(_ context.Context) (CheckResult, error) {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return CheckResult{Pass: false, Details: "cannot read /proc/mounts"}, nil
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[1] == c.mount {
			return CheckResult{Pass: true, Details: fmt.Sprintf("%s is a separate partition", c.mount)}, nil
		}
	}
	return CheckResult{
		Pass:    false,
		Details: fmt.Sprintf("%s is not a separate partition", c.mount),
		Fix:     fmt.Sprintf("Create a separate partition for %s", c.mount),
	}, nil
}

type stickyBitCheck struct{ id, title string }

func (c *stickyBitCheck) ID() string    { return c.id }
func (c *stickyBitCheck) Title() string { return c.title }
func (c *stickyBitCheck) Level() int    { return 1 }

func (c *stickyBitCheck) Run(_ context.Context) (CheckResult, error) {
	out, err := exec.Command("find", "/", "-maxdepth", "3", "-type", "d", "-perm", "-0002", "!", "-perm", "-1000", "-print").Output()
	if err != nil {
		return CheckResult{Pass: true, Details: "no world-writable dirs without sticky bit found"}, nil
	}
	dirs := strings.TrimSpace(string(out))
	if dirs == "" {
		return CheckResult{Pass: true, Details: "all world-writable dirs have sticky bit"}, nil
	}
	return CheckResult{
		Pass:    false,
		Details: fmt.Sprintf("world-writable dirs without sticky bit: %s", dirs),
		Fix:     "Run: find / -type d -perm -0002 ! -perm -1000 -exec chmod a+t {} +",
	}, nil
}

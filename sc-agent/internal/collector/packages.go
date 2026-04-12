package collector

import (
	"bufio"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// PackageData is the snapshot data for the package inventory collector.
type PackageData struct {
	OSFamily               string
	Packages               []PkgInfo
	BinaryVersions         []BinaryVersion
	PendingSecurityUpdates int
	HeldPackages           []string
	KernelRunning          string
	KernelInstalled        string
	UnattendedUpgrades     bool
	// Hash of the package list — skip sending if unchanged.
	PackageHash string
}

// PkgInfo holds a single OS package.
type PkgInfo struct {
	Name    string
	Version string
	Arch    string
}

// BinaryVersion holds a system binary name and its running version.
type BinaryVersion struct {
	Name    string
	Version string
}

type packageCollector struct {
	prevHash string
}

func NewPackageInventory() Collector {
	return &packageCollector{}
}

func (c *packageCollector) Name() string     { return "packages" }
func (c *packageCollector) Cadence() Cadence { return CadenceDaily }
func (c *packageCollector) Enabled() bool    { return runtime.GOOS == "linux" }
func (c *packageCollector) Init() error      { return nil }

func (c *packageCollector) Collect() (*Snapshot, error) {
	d := PackageData{
		OSFamily:           detectOSFamily(),
		KernelRunning:      kernelRunning(),
		UnattendedUpgrades: checkUnattendedUpgrades(),
	}

	// Collect packages based on distro.
	switch d.OSFamily {
	case "debian", "ubuntu":
		d.Packages = collectDpkgPackages()
		d.PendingSecurityUpdates = countPendingSecurityApt()
		d.HeldPackages = collectHeldApt()
		d.KernelInstalled = latestKernelDpkg()
	case "rhel", "centos", "rocky", "alma", "fedora":
		d.Packages = collectRpmPackages()
	}

	// Hash the package list to detect changes.
	d.PackageHash = hashPackages(d.Packages)

	// Collect system binary versions (only binaries that exist).
	d.BinaryVersions = collectBinaryVersions()

	return &Snapshot{Key: "packages", Data: d, At: time.Now()}, nil
}

// --- OS detection ---

func detectOSFamily() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "unknown"
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "ID=") {
			val := strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
			return strings.ToLower(val)
		}
	}
	return "unknown"
}

// --- Package collection ---

func collectDpkgPackages() []PkgInfo {
	out, err := exec.Command("dpkg-query", "-W", "-f", "${Package}\t${Version}\t${Architecture}\n").Output()
	if err != nil {
		return nil
	}
	return parseTSVPackages(string(out))
}

func collectRpmPackages() []PkgInfo {
	out, err := exec.Command("rpm", "-qa", "--queryformat", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n").Output()
	if err != nil {
		return nil
	}
	return parseTSVPackages(string(out))
}

func parseTSVPackages(data string) []PkgInfo {
	var pkgs []PkgInfo
	for _, line := range strings.Split(strings.TrimSpace(data), "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 2 || parts[0] == "" {
			continue
		}
		p := PkgInfo{Name: parts[0], Version: parts[1]}
		if len(parts) >= 3 {
			p.Arch = parts[2]
		}
		pkgs = append(pkgs, p)
	}
	return pkgs
}

// --- Pending security updates (apt) ---

func countPendingSecurityApt() int {
	out, err := exec.Command("apt", "list", "--upgradable").Output()
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "security") || strings.Contains(lower, "-security") {
			count++
		}
	}
	return count
}

// --- Held packages ---

func collectHeldApt() []string {
	out, err := exec.Command("apt-mark", "showhold").Output()
	if err != nil {
		return nil
	}
	var held []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			held = append(held, line)
		}
	}
	return held
}

// --- Kernel ---

func kernelRunning() string {
	out, err := exec.Command("uname", "-r").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func latestKernelDpkg() string {
	out, err := exec.Command("dpkg", "-l").Output()
	if err != nil {
		return ""
	}
	latest := ""
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "linux-image-") && strings.HasPrefix(line, "ii") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				latest = fields[2] // version column
			}
		}
	}
	return latest
}

// --- Unattended upgrades ---

func checkUnattendedUpgrades() bool {
	out, err := exec.Command("systemctl", "is-active", "unattended-upgrades").Output()
	return err == nil && strings.TrimSpace(string(out)) == "active"
}

// --- System binary versions ---

type binaryProbe struct {
	name string
	args []string
}

func collectBinaryVersions() []BinaryVersion {
	probes := []binaryProbe{
		{"openssl", []string{"version"}},
		{"sshd", []string{"-V"}},
		{"curl", []string{"--version"}},
		{"nginx", []string{"-v"}},
		{"docker", []string{"version", "--format", "{{.Server.Version}}"}},
		{"containerd", []string{"--version"}},
		{"runc", []string{"--version"}},
	}

	// Also detect glibc
	var versions []BinaryVersion
	if out, err := exec.Command("ldd", "--version").Output(); err == nil {
		first := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
		versions = append(versions, BinaryVersion{Name: "glibc", Version: first})
	}

	for _, p := range probes {
		path, err := exec.LookPath(p.name)
		if err != nil {
			continue
		}
		// sshd -V writes to stderr
		cmd := exec.Command(path, p.args...)
		out, err := cmd.CombinedOutput()
		if err != nil && len(out) == 0 {
			continue
		}
		ver := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
		if ver != "" {
			versions = append(versions, BinaryVersion{Name: p.name, Version: ver})
		}
	}

	return versions
}

// --- Hash ---

func hashPackages(pkgs []PkgInfo) string {
	h := sha256.New()
	for _, p := range pkgs {
		fmt.Fprintf(h, "%s\t%s\t%s\n", p.Name, p.Version, p.Arch)
	}
	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}

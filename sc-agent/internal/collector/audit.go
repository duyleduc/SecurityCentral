package collector

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// AuditData is the snapshot data for the hardening audit collector.
type AuditData struct {
	Results []AuditResult
}

// AuditResult is a single pass/fail/warn check.
type AuditResult struct {
	ID       string // e.g., "kernel.aslr"
	Category string // Users, Kernel, Filesystem, Container
	Title    string
	Status   string // "pass", "fail", "warn"
	Severity string // "critical", "high", "medium", "low"
	Detail   string // human-readable explanation
}

type auditCollector struct{}

func NewAudit() Collector {
	return &auditCollector{}
}

func (c *auditCollector) Name() string     { return "audit" }
func (c *auditCollector) Cadence() Cadence { return CadenceDaily }
func (c *auditCollector) Enabled() bool    { return true }
func (c *auditCollector) Init() error      { return nil }

func (c *auditCollector) Collect() (*Snapshot, error) {
	var results []AuditResult

	results = append(results, auditKernel()...)
	results = append(results, auditUsers()...)
	results = append(results, auditFilesystem()...)
	results = append(results, auditContainerRuntime()...)
	results = append(results, auditSSHDeep()...)
	results = append(results, auditServices()...)

	return &Snapshot{Key: "audit", Data: AuditData{Results: results}, At: time.Now()}, nil
}

// ---------------------------------------------------------------------------
// Kernel hardening
// ---------------------------------------------------------------------------

func auditKernel() []AuditResult {
	var r []AuditResult

	// ASLR
	r = append(r, checkSysctl("kernel.aslr", "Kernel", "ASLR enabled",
		"/proc/sys/kernel/randomize_va_space", "2", "critical",
		"ASLR must be set to 2 (full randomization)"))

	// kptr_restrict
	r = append(r, checkSysctl("kernel.kptr_restrict", "Kernel", "Kernel pointer restriction",
		"/proc/sys/kernel/kptr_restrict", "1", "medium",
		"kptr_restrict should be >= 1 to hide kernel pointers"))

	// dmesg_restrict
	r = append(r, checkSysctl("kernel.dmesg_restrict", "Kernel", "dmesg access restricted",
		"/proc/sys/kernel/dmesg_restrict", "1", "medium",
		"dmesg_restrict should be 1 to prevent unprivileged access"))

	// Core dump restriction
	r = append(r, checkSysctl("kernel.core_dump", "Kernel", "Core dump restriction",
		"/proc/sys/fs/suid_dumpable", "0", "medium",
		"suid_dumpable should be 0 to prevent core dumps from setuid programs"))

	// ptrace_scope
	r = append(r, checkSysctl("kernel.ptrace_scope", "Kernel", "PTRACE scope restricted",
		"/proc/sys/kernel/yama/ptrace_scope", "1", "medium",
		"ptrace_scope should be >= 1 to restrict process tracing"))

	// CPU vulnerability mitigations
	vulnDir := "/sys/devices/system/cpu/vulnerabilities"
	entries, err := os.ReadDir(vulnDir)
	if err == nil {
		for _, e := range entries {
			data, err := os.ReadFile(filepath.Join(vulnDir, e.Name()))
			if err != nil {
				continue
			}
			val := strings.TrimSpace(string(data))
			status := "pass"
			sev := "low"
			if strings.Contains(strings.ToLower(val), "vulnerable") {
				status = "fail"
				sev = "critical"
			}
			r = append(r, AuditResult{
				ID:       fmt.Sprintf("kernel.cpu_vuln.%s", e.Name()),
				Category: "Kernel",
				Title:    fmt.Sprintf("CPU vulnerability: %s", e.Name()),
				Status:   status,
				Severity: sev,
				Detail:   val,
			})
		}
	}

	return r
}

func checkSysctl(id, category, title, path, expected, severity, detail string) AuditResult {
	data, err := os.ReadFile(path)
	if err != nil {
		return AuditResult{ID: id, Category: category, Title: title, Status: "warn", Severity: "low", Detail: "Could not read " + path}
	}
	val := strings.TrimSpace(string(data))
	num, _ := strconv.Atoi(val)
	expNum, _ := strconv.Atoi(expected)

	status := "pass"
	if num < expNum {
		status = "fail"
	}
	return AuditResult{ID: id, Category: category, Title: title, Status: status, Severity: severity, Detail: fmt.Sprintf("Value: %s (expected >= %s). %s", val, expected, detail)}
}

// ---------------------------------------------------------------------------
// User audit
// ---------------------------------------------------------------------------

func auditUsers() []AuditResult {
	var r []AuditResult

	// UID 0 accounts other than root
	uid0 := findUID0Accounts()
	if len(uid0) > 0 {
		r = append(r, AuditResult{ID: "users.uid0", Category: "Users", Title: "UID 0 accounts (non-root)",
			Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Found UID 0 accounts: %s", strings.Join(uid0, ", "))})
	} else {
		r = append(r, AuditResult{ID: "users.uid0", Category: "Users", Title: "UID 0 accounts (non-root)",
			Status: "pass", Severity: "critical", Detail: "Only root has UID 0"})
	}

	// Empty passwords
	emptyPw := findEmptyPasswords()
	if len(emptyPw) > 0 {
		r = append(r, AuditResult{ID: "users.empty_password", Category: "Users", Title: "Users with empty password",
			Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Users with no password: %s", strings.Join(emptyPw, ", "))})
	} else {
		r = append(r, AuditResult{ID: "users.empty_password", Category: "Users", Title: "Users with empty password",
			Status: "pass", Severity: "critical", Detail: "No users have empty passwords"})
	}

	// Password hash algorithm
	weakHash := findWeakPasswordHashes()
	if len(weakHash) > 0 {
		r = append(r, AuditResult{ID: "users.weak_hash", Category: "Users", Title: "Weak password hashing (MD5)",
			Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Users with MD5 password hash: %s", strings.Join(weakHash, ", "))})
	} else {
		r = append(r, AuditResult{ID: "users.weak_hash", Category: "Users", Title: "Password hashing algorithm",
			Status: "pass", Severity: "critical", Detail: "All passwords use strong hashing (SHA-512 or yescrypt)"})
	}

	// NOPASSWD sudoers
	nopasswd := findNopasswdSudoers()
	if len(nopasswd) > 0 {
		r = append(r, AuditResult{ID: "users.nopasswd_sudo", Category: "Users", Title: "NOPASSWD sudoers rules",
			Status: "fail", Severity: "high", Detail: fmt.Sprintf("NOPASSWD rules found: %s", strings.Join(nopasswd, "; "))})
	} else {
		r = append(r, AuditResult{ID: "users.nopasswd_sudo", Category: "Users", Title: "NOPASSWD sudoers rules",
			Status: "pass", Severity: "high", Detail: "No NOPASSWD ALL rules found"})
	}

	// Home directory permissions
	badHomes := findBadHomePerms()
	if len(badHomes) > 0 {
		r = append(r, AuditResult{ID: "users.home_perms", Category: "Users", Title: "Home directory permissions",
			Status: "fail", Severity: "medium", Detail: fmt.Sprintf("World-readable home directories: %s", strings.Join(badHomes, ", "))})
	} else {
		r = append(r, AuditResult{ID: "users.home_perms", Category: "Users", Title: "Home directory permissions",
			Status: "pass", Severity: "medium", Detail: "All home directories are 750 or stricter"})
	}

	return r
}

func findUID0Accounts() []string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil
	}
	defer f.Close()
	var accounts []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		parts := strings.Split(scanner.Text(), ":")
		if len(parts) >= 4 && parts[2] == "0" && parts[0] != "root" {
			accounts = append(accounts, parts[0])
		}
	}
	return accounts
}

func findEmptyPasswords() []string {
	f, err := os.Open("/etc/shadow")
	if err != nil {
		return nil
	}
	defer f.Close()
	var users []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		parts := strings.Split(scanner.Text(), ":")
		if len(parts) >= 2 && parts[1] == "" {
			users = append(users, parts[0])
		}
	}
	return users
}

func findWeakPasswordHashes() []string {
	f, err := os.Open("/etc/shadow")
	if err != nil {
		return nil
	}
	defer f.Close()
	var users []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		parts := strings.Split(scanner.Text(), ":")
		if len(parts) < 2 || len(parts[1]) < 3 {
			continue
		}
		// $1$ = MD5
		if strings.HasPrefix(parts[1], "$1$") {
			users = append(users, parts[0])
		}
	}
	return users
}

func findNopasswdSudoers() []string {
	var results []string
	files := []string{"/etc/sudoers"}
	// Also check /etc/sudoers.d/
	entries, err := os.ReadDir("/etc/sudoers.d")
	if err == nil {
		for _, e := range entries {
			files = append(files, filepath.Join("/etc/sudoers.d", e.Name()))
		}
	}
	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") || line == "" {
				continue
			}
			if strings.Contains(strings.ToUpper(line), "NOPASSWD") && strings.Contains(strings.ToUpper(line), "ALL") {
				results = append(results, line)
			}
		}
	}
	return results
}

func findBadHomePerms() []string {
	entries, err := os.ReadDir("/home")
	if err != nil {
		return nil
	}
	var bad []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := os.Stat(filepath.Join("/home", e.Name()))
		if err != nil {
			continue
		}
		perm := info.Mode().Perm()
		// 0755 or more permissive = bad (should be 0750 or stricter)
		if perm&0o005 != 0 { // world-readable or world-executable
			bad = append(bad, fmt.Sprintf("%s (%o)", e.Name(), perm))
		}
	}
	return bad
}

// ---------------------------------------------------------------------------
// Filesystem audit
// ---------------------------------------------------------------------------

func auditFilesystem() []AuditResult {
	var r []AuditResult

	// SUID binaries
	suidBins := findSUIDBinaries()
	r = append(r, AuditResult{ID: "fs.suid_binaries", Category: "Filesystem", Title: "SUID binaries",
		Status: "pass", Severity: "high", Detail: fmt.Sprintf("Found %d SUID binaries", len(suidBins))})
	if len(suidBins) > 20 {
		r[len(r)-1].Status = "warn"
		r[len(r)-1].Detail = fmt.Sprintf("Found %d SUID binaries (elevated count). Review: %s", len(suidBins), strings.Join(suidBins[:5], ", ")+"...")
	}

	// World-writable files in /etc
	wwFiles := findWorldWritable("/etc", 3)
	if len(wwFiles) > 0 {
		r = append(r, AuditResult{ID: "fs.world_writable_etc", Category: "Filesystem", Title: "World-writable files in /etc",
			Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Found %d world-writable files: %s", len(wwFiles), strings.Join(wwFiles, ", "))})
	} else {
		r = append(r, AuditResult{ID: "fs.world_writable_etc", Category: "Filesystem", Title: "World-writable files in /etc",
			Status: "pass", Severity: "critical", Detail: "No world-writable files in /etc"})
	}

	// Executables in /tmp
	tmpExecs := findExecutablesInTmp()
	if len(tmpExecs) > 0 {
		r = append(r, AuditResult{ID: "fs.tmp_executables", Category: "Filesystem", Title: "Executables in /tmp",
			Status: "fail", Severity: "high", Detail: fmt.Sprintf("Found %d executable files in /tmp: %s", len(tmpExecs), strings.Join(tmpExecs, ", "))})
	} else {
		r = append(r, AuditResult{ID: "fs.tmp_executables", Category: "Filesystem", Title: "Executables in /tmp",
			Status: "pass", Severity: "high", Detail: "No executable files in /tmp or /var/tmp"})
	}

	// /etc/passwd and /etc/shadow permissions
	r = append(r, checkFilePerms("fs.passwd_perms", "/etc/passwd", 0o644, "medium"))
	r = append(r, checkFilePerms("fs.shadow_perms", "/etc/shadow", 0o640, "critical"))

	return r
}

func findSUIDBinaries() []string {
	out, err := exec.Command("find", "/usr", "/bin", "/sbin", "-xdev", "-perm", "-4000", "-type", "f").Output()
	if err != nil {
		return nil
	}
	var bins []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			bins = append(bins, line)
		}
	}
	return bins
}

func findWorldWritable(dir string, maxDepth int) []string {
	out, err := exec.Command("find", dir, "-maxdepth", strconv.Itoa(maxDepth), "-perm", "-0002", "-type", "f").Output()
	if err != nil {
		return nil
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			files = append(files, line)
		}
	}
	return files
}

func findExecutablesInTmp() []string {
	var all []string
	for _, dir := range []string{"/tmp", "/var/tmp"} {
		out, err := exec.Command("find", dir, "-maxdepth", "3", "-type", "f", "-executable").Output()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				all = append(all, line)
			}
		}
	}
	return all
}

func checkFilePerms(id, path string, maxPerm os.FileMode, severity string) AuditResult {
	info, err := os.Stat(path)
	if err != nil {
		return AuditResult{ID: id, Category: "Filesystem", Title: fmt.Sprintf("%s permissions", path),
			Status: "warn", Severity: "low", Detail: "File not found: " + path}
	}
	perm := info.Mode().Perm()
	stat, ok := info.Sys().(*syscall.Stat_t)

	ownerOk := true
	if ok && stat.Uid != 0 {
		ownerOk = false
	}

	if perm <= maxPerm && ownerOk {
		return AuditResult{ID: id, Category: "Filesystem", Title: fmt.Sprintf("%s permissions", path),
			Status: "pass", Severity: severity, Detail: fmt.Sprintf("Permissions: %04o (OK)", perm)}
	}

	detail := fmt.Sprintf("Permissions: %04o (expected <= %04o)", perm, maxPerm)
	if !ownerOk {
		detail += fmt.Sprintf(". Owner UID: %d (expected 0)", stat.Uid)
	}
	return AuditResult{ID: id, Category: "Filesystem", Title: fmt.Sprintf("%s permissions", path),
		Status: "fail", Severity: severity, Detail: detail}
}

// ---------------------------------------------------------------------------
// Container runtime audit
// ---------------------------------------------------------------------------

func auditContainerRuntime() []AuditResult {
	var r []AuditResult

	// Docker socket permissions
	if info, err := os.Stat("/var/run/docker.sock"); err == nil {
		perm := info.Mode().Perm()
		if perm&0o006 != 0 { // world-readable or world-writable
			r = append(r, AuditResult{ID: "container.docker_sock", Category: "Container", Title: "Docker socket permissions",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Docker socket is world-accessible (%04o). Non-root access = full root escalation.", perm)})
		} else {
			r = append(r, AuditResult{ID: "container.docker_sock", Category: "Container", Title: "Docker socket permissions",
				Status: "pass", Severity: "critical", Detail: fmt.Sprintf("Docker socket permissions: %04o", perm)})
		}
	}

	// Privileged containers
	if _, err := exec.LookPath("docker"); err == nil {
		out, err := exec.Command("docker", "ps", "-q").Output()
		if err == nil && strings.TrimSpace(string(out)) != "" {
			ids := strings.Fields(strings.TrimSpace(string(out)))
			var privileged []string
			var sockMount []string

			for _, id := range ids {
				// Check privileged
				pOut, _ := exec.Command("docker", "inspect", "--format", "{{.Name}} {{.HostConfig.Privileged}}", id).Output()
				if strings.Contains(string(pOut), "true") {
					privileged = append(privileged, strings.Fields(strings.TrimSpace(string(pOut)))[0])
				}
				// Check docker.sock mount
				mOut, _ := exec.Command("docker", "inspect", "--format", "{{.Name}} {{.Mounts}}", id).Output()
				if strings.Contains(string(mOut), "docker.sock") {
					sockMount = append(sockMount, strings.Fields(strings.TrimSpace(string(mOut)))[0])
				}
			}

			if len(privileged) > 0 {
				r = append(r, AuditResult{ID: "container.privileged", Category: "Container", Title: "Privileged containers",
					Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Privileged containers: %s", strings.Join(privileged, ", "))})
			} else {
				r = append(r, AuditResult{ID: "container.privileged", Category: "Container", Title: "Privileged containers",
					Status: "pass", Severity: "critical", Detail: "No privileged containers running"})
			}

			if len(sockMount) > 0 {
				r = append(r, AuditResult{ID: "container.sock_mount", Category: "Container", Title: "Containers mounting Docker socket",
					Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Containers with docker.sock mount: %s", strings.Join(sockMount, ", "))})
			} else {
				r = append(r, AuditResult{ID: "container.sock_mount", Category: "Container", Title: "Containers mounting Docker socket",
					Status: "pass", Severity: "critical", Detail: "No containers mount the Docker socket"})
			}
		}
	}

	return r
}

// ---------------------------------------------------------------------------
// SSH deep config audit (ciphers, MACs, KEX, host keys)
// ---------------------------------------------------------------------------

// Weak algorithms that should be rejected.
var (
	weakCiphers = map[string]bool{
		"arcfour": true, "arcfour128": true, "arcfour256": true,
		"3des-cbc": true, "blowfish-cbc": true, "cast128-cbc": true,
		"aes128-cbc": true, "aes192-cbc": true, "aes256-cbc": true,
	}
	weakMACs = map[string]bool{
		"hmac-md5": true, "hmac-md5-96": true,
		"hmac-sha1": true, "hmac-sha1-96": true,
		"hmac-ripemd160": true,
	}
	weakKEX = map[string]bool{
		"diffie-hellman-group1-sha1":         true,
		"diffie-hellman-group14-sha1":        true,
		"diffie-hellman-group-exchange-sha1": true,
	}
	weakHostKeys = map[string]bool{
		"ssh-dss": true,
	}
)

func auditSSHDeep() []AuditResult {
	var r []AuditResult

	out, err := exec.Command("sshd", "-T").CombinedOutput()
	if err != nil {
		r = append(r, AuditResult{ID: "ssh.deep_config", Category: "SSH", Title: "SSH effective config",
			Status: "warn", Severity: "low", Detail: "Could not read sshd -T: " + err.Error()})
		return r
	}

	config := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), " ", 2)
		if len(parts) == 2 {
			config[strings.ToLower(parts[0])] = parts[1]
		}
	}

	// Ciphers
	if ciphers, ok := config["ciphers"]; ok {
		found := findWeakItems(ciphers, weakCiphers)
		if len(found) > 0 {
			r = append(r, AuditResult{ID: "ssh.weak_ciphers", Category: "SSH", Title: "SSH weak ciphers",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Weak ciphers enabled: %s", strings.Join(found, ", "))})
		} else {
			r = append(r, AuditResult{ID: "ssh.weak_ciphers", Category: "SSH", Title: "SSH ciphers",
				Status: "pass", Severity: "critical", Detail: "No weak ciphers enabled"})
		}
	}

	// MACs
	if macs, ok := config["macs"]; ok {
		found := findWeakItems(macs, weakMACs)
		if len(found) > 0 {
			r = append(r, AuditResult{ID: "ssh.weak_macs", Category: "SSH", Title: "SSH weak MACs",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Weak MACs enabled: %s", strings.Join(found, ", "))})
		} else {
			r = append(r, AuditResult{ID: "ssh.weak_macs", Category: "SSH", Title: "SSH MACs",
				Status: "pass", Severity: "critical", Detail: "No weak MACs enabled"})
		}
	}

	// KEX algorithms
	if kex, ok := config["kexalgorithms"]; ok {
		found := findWeakItems(kex, weakKEX)
		if len(found) > 0 {
			r = append(r, AuditResult{ID: "ssh.weak_kex", Category: "SSH", Title: "SSH weak KEX algorithms",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Weak KEX algorithms: %s", strings.Join(found, ", "))})
		} else {
			r = append(r, AuditResult{ID: "ssh.weak_kex", Category: "SSH", Title: "SSH KEX algorithms",
				Status: "pass", Severity: "critical", Detail: "No weak KEX algorithms enabled"})
		}
	}

	// Host key algorithms
	if hka, ok := config["hostkeyalgorithms"]; ok {
		found := findWeakItems(hka, weakHostKeys)
		if len(found) > 0 {
			r = append(r, AuditResult{ID: "ssh.weak_hostkey", Category: "SSH", Title: "SSH weak host key algorithms",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Weak host key algorithms: %s (DSA is broken)", strings.Join(found, ", "))})
		} else {
			r = append(r, AuditResult{ID: "ssh.weak_hostkey", Category: "SSH", Title: "SSH host key algorithms",
				Status: "pass", Severity: "critical", Detail: "No weak host key algorithms (no DSA)"})
		}
	}

	// MaxAuthTries
	if val, ok := config["maxauthtries"]; ok {
		n, _ := strconv.Atoi(val)
		if n > 4 {
			r = append(r, AuditResult{ID: "ssh.max_auth_tries", Category: "SSH", Title: "SSH MaxAuthTries",
				Status: "fail", Severity: "medium", Detail: fmt.Sprintf("MaxAuthTries=%d (should be <= 4)", n)})
		} else {
			r = append(r, AuditResult{ID: "ssh.max_auth_tries", Category: "SSH", Title: "SSH MaxAuthTries",
				Status: "pass", Severity: "medium", Detail: fmt.Sprintf("MaxAuthTries=%d", n)})
		}
	}

	// X11Forwarding
	if val, ok := config["x11forwarding"]; ok && val == "yes" {
		r = append(r, AuditResult{ID: "ssh.x11forwarding", Category: "SSH", Title: "SSH X11 forwarding",
			Status: "fail", Severity: "medium", Detail: "X11Forwarding is enabled (should be no unless needed)"})
	} else {
		r = append(r, AuditResult{ID: "ssh.x11forwarding", Category: "SSH", Title: "SSH X11 forwarding",
			Status: "pass", Severity: "medium", Detail: "X11Forwarding is disabled"})
	}

	// AllowTcpForwarding
	if val, ok := config["allowtcpforwarding"]; ok && val == "yes" {
		r = append(r, AuditResult{ID: "ssh.tcp_forwarding", Category: "SSH", Title: "SSH TCP forwarding",
			Status: "warn", Severity: "low", Detail: "AllowTcpForwarding is enabled (consider disabling if not needed)"})
	} else {
		r = append(r, AuditResult{ID: "ssh.tcp_forwarding", Category: "SSH", Title: "SSH TCP forwarding",
			Status: "pass", Severity: "low", Detail: "AllowTcpForwarding is disabled"})
	}

	return r
}

func findWeakItems(commaSep string, weakSet map[string]bool) []string {
	var found []string
	for _, item := range strings.Split(commaSep, ",") {
		item = strings.TrimSpace(item)
		if weakSet[item] {
			found = append(found, item)
		}
	}
	return found
}

// ---------------------------------------------------------------------------
// Service hardening audit (Redis, DB, NFS, legacy protocols)
// ---------------------------------------------------------------------------

func auditServices() []AuditResult {
	var r []AuditResult

	listeners := collectListeningPorts()
	portSet := make(map[uint32]PortInfo)
	for _, p := range listeners {
		portSet[p.Port] = p
	}

	// Legacy protocols
	legacyPorts := []struct {
		port uint32
		name string
	}{
		{23, "Telnet"},
		{21, "FTP"},
		{111, "rpcbind/portmapper"},
	}
	for _, lp := range legacyPorts {
		if _, found := portSet[lp.port]; found {
			r = append(r, AuditResult{
				ID: fmt.Sprintf("svc.legacy_%d", lp.port), Category: "Services",
				Title:    fmt.Sprintf("Legacy protocol: %s (port %d)", lp.name, lp.port),
				Status:   "fail", Severity: "critical",
				Detail:   fmt.Sprintf("%s is running on port %d. Replace with secure alternative.", lp.name, lp.port),
			})
		}
	}

	// Redis
	if _, found := portSet[6379]; found {
		r = append(r, auditRedis()...)
	}

	// MySQL/MariaDB
	if _, found := portSet[3306]; found {
		r = append(r, auditMySQLBind()...)
	}

	// PostgreSQL
	if _, found := portSet[5432]; found {
		r = append(r, auditPostgresTrust()...)
	}

	// NFS
	r = append(r, auditNFSExports()...)

	// SNMP
	if _, found := portSet[161]; found {
		r = append(r, auditSNMP()...)
	}

	return r
}

func auditRedis() []AuditResult {
	var r []AuditResult

	out, err := exec.Command("redis-cli", "CONFIG", "GET", "requirepass").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		passVal := ""
		if len(lines) >= 2 {
			passVal = strings.TrimSpace(lines[1])
		}
		if passVal == "" || passVal == "(empty array)" || passVal == "(empty list or set)" {
			r = append(r, AuditResult{ID: "svc.redis_auth", Category: "Services", Title: "Redis authentication",
				Status: "fail", Severity: "critical", Detail: "Redis has no requirepass set. Anyone who can reach port 6379 has full access."})
		} else {
			r = append(r, AuditResult{ID: "svc.redis_auth", Category: "Services", Title: "Redis authentication",
				Status: "pass", Severity: "critical", Detail: "Redis requirepass is set"})
		}
	}

	out, err = exec.Command("redis-cli", "CONFIG", "GET", "bind").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		bindVal := ""
		if len(lines) >= 2 {
			bindVal = strings.TrimSpace(lines[1])
		}
		if bindVal == "" || bindVal == "0.0.0.0" {
			r = append(r, AuditResult{ID: "svc.redis_bind", Category: "Services", Title: "Redis bind address",
				Status: "fail", Severity: "high", Detail: fmt.Sprintf("Redis bind: %q (should be 127.0.0.1)", bindVal)})
		} else {
			r = append(r, AuditResult{ID: "svc.redis_bind", Category: "Services", Title: "Redis bind address",
				Status: "pass", Severity: "high", Detail: fmt.Sprintf("Redis bind: %s", bindVal)})
		}
	}

	return r
}

func auditMySQLBind() []AuditResult {
	var r []AuditResult
	for _, path := range []string{"/etc/mysql/mysql.conf.d/mysqld.cnf", "/etc/mysql/my.cnf", "/etc/my.cnf"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "bind-address") || strings.HasPrefix(line, "bind_address") {
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					addr := strings.TrimSpace(parts[1])
					if addr == "0.0.0.0" || addr == "*" || addr == "::" {
						r = append(r, AuditResult{ID: "svc.mysql_bind", Category: "Services", Title: "MySQL bind address",
							Status: "fail", Severity: "high", Detail: fmt.Sprintf("MySQL bind-address=%s (should be 127.0.0.1)", addr)})
					} else {
						r = append(r, AuditResult{ID: "svc.mysql_bind", Category: "Services", Title: "MySQL bind address",
							Status: "pass", Severity: "high", Detail: fmt.Sprintf("MySQL bind-address=%s", addr)})
					}
					return r
				}
			}
		}
	}
	return r
}

func auditPostgresTrust() []AuditResult {
	var r []AuditResult
	matches, _ := filepath.Glob("/etc/postgresql/*/main/pg_hba.conf")
	for _, path := range matches {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var trustLines []string
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") || line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				authMethod := fields[len(fields)-1]
				connType := fields[0]
				if authMethod == "trust" && connType != "local" {
					trustLines = append(trustLines, line)
				}
			}
		}
		if len(trustLines) > 0 {
			r = append(r, AuditResult{ID: "svc.pg_trust", Category: "Services", Title: "PostgreSQL trust authentication",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("pg_hba.conf has trust auth for network: %s", strings.Join(trustLines, "; "))})
		} else {
			r = append(r, AuditResult{ID: "svc.pg_trust", Category: "Services", Title: "PostgreSQL authentication",
				Status: "pass", Severity: "critical", Detail: "No trust auth for network connections"})
		}
		return r
	}
	return r
}

func auditNFSExports() []AuditResult {
	var r []AuditResult
	data, err := os.ReadFile("/etc/exports")
	if err != nil {
		return r
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, "no_root_squash") {
			r = append(r, AuditResult{ID: "svc.nfs_root_squash", Category: "Services", Title: "NFS no_root_squash",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("NFS export with no_root_squash: %s", line)})
			return r
		}
	}
	r = append(r, AuditResult{ID: "svc.nfs_root_squash", Category: "Services", Title: "NFS root_squash",
		Status: "pass", Severity: "critical", Detail: "No NFS exports with no_root_squash"})
	return r
}

func auditSNMP() []AuditResult {
	var r []AuditResult
	data, err := os.ReadFile("/etc/snmp/snmpd.conf")
	if err != nil {
		return r
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if (strings.Contains(lower, "community") || strings.Contains(lower, "rocommunity") || strings.Contains(lower, "rwcommunity")) &&
			(strings.Contains(lower, "public") || strings.Contains(lower, "private")) {
			r = append(r, AuditResult{ID: "svc.snmp_community", Category: "Services", Title: "SNMP default community string",
				Status: "fail", Severity: "critical", Detail: fmt.Sprintf("Default SNMP community string: %s", line)})
			return r
		}
	}
	r = append(r, AuditResult{ID: "svc.snmp_community", Category: "Services", Title: "SNMP community strings",
		Status: "pass", Severity: "critical", Detail: "No default community strings (public/private)"})
	return r
}

package collector

import (
	"bufio"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// BruteForceReport summarizes brute force activity from log analysis.
type BruteForceReport struct {
	SSHVelocity     int              // failures in last 5 min
	SSHUniqueIPs    int              // unique attacker IPs in last 5 min
	SSHTopAttackers []IPCount        // top 5 attacker IPs
	SSHCompromise   []CompromiseHint // success-after-failure indicators
	HTTPVelocity    int              // HTTP 401/403 in last 5 min
	HTTPUniqueIPs   int
	IsActiveAttack  bool // SSHVelocity > 50
	IsDistributed   bool // SSHUniqueIPs > 10
	HasCompromise   bool // any CompromiseHint found
}

// IPCount tracks failure count per IP.
type IPCount struct {
	IP    string
	Count int
}

// CompromiseHint means a successful login followed many failures from the same IP.
type CompromiseHint struct {
	IP             string
	FailuresBefore int
	SuccessUser    string
	SuccessAt      time.Time
}

type logEntry struct {
	ts       time.Time
	sourceIP string
	user     string
	success  bool
}

// BruteForceAnalyzer maintains sliding windows over auth logs.
type BruteForceAnalyzer struct {
	mu          sync.Mutex
	sshEntries  []logEntry
	httpEntries []logEntry
	lastSSHPos  int64 // track file read position for incremental parsing
	lastHTTPPos int64
	window      time.Duration // default 10 min retention
}

// NewBruteForceAnalyzer creates an analyzer with a 10-minute sliding window.
func NewBruteForceAnalyzer() *BruteForceAnalyzer {
	return &BruteForceAnalyzer{
		window: 10 * time.Minute,
	}
}

// Update reads new log entries and prunes old ones.
func (a *BruteForceAnalyzer) Update() {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.parseSSHLogs()
	a.parseHTTPLogs()
	a.prune()
}

// Analyze returns the current brute force report.
func (a *BruteForceAnalyzer) Analyze() BruteForceReport {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	fiveMin := now.Add(-5 * time.Minute)

	var r BruteForceReport

	// SSH analysis (5-min window for velocity).
	sshFailIPs := make(map[string]int)
	sshSuccessIPs := make(map[string]logEntry)
	for _, e := range a.sshEntries {
		if e.ts.Before(fiveMin) {
			continue
		}
		if e.success {
			sshSuccessIPs[e.sourceIP] = e
		} else {
			sshFailIPs[e.sourceIP]++
			r.SSHVelocity++
		}
	}
	r.SSHUniqueIPs = len(sshFailIPs)
	r.SSHTopAttackers = topN(sshFailIPs, 5)

	// Compromise: IP had failures then a success.
	for ip, count := range sshFailIPs {
		if count >= 3 {
			if succ, ok := sshSuccessIPs[ip]; ok {
				r.SSHCompromise = append(r.SSHCompromise, CompromiseHint{
					IP:             ip,
					FailuresBefore: count,
					SuccessUser:    succ.user,
					SuccessAt:      succ.ts,
				})
			}
		}
	}

	// HTTP analysis.
	httpIPs := make(map[string]int)
	for _, e := range a.httpEntries {
		if e.ts.Before(fiveMin) {
			continue
		}
		httpIPs[e.sourceIP]++
		r.HTTPVelocity++
	}
	r.HTTPUniqueIPs = len(httpIPs)

	r.IsActiveAttack = r.SSHVelocity > 50
	r.IsDistributed = r.SSHUniqueIPs > 10
	r.HasCompromise = len(r.SSHCompromise) > 0

	return r
}

// --- SSH log parsing ---

// Matches: "Failed password for root from 192.168.1.1 port 22 ssh2"
// Matches: "Failed password for invalid user admin from 10.0.0.5 port 22 ssh2"
var sshFailRegex = regexp.MustCompile(`(?i)failed password for (?:invalid user )?(\S+) from (\d+\.\d+\.\d+\.\d+)`)

// Matches: "Accepted password for root from 192.168.1.1 port 22 ssh2"
// Matches: "Accepted publickey for deploy from 10.0.0.1 port 22 ssh2"
var sshSuccessRegex = regexp.MustCompile(`(?i)accepted (?:password|publickey) for (\S+) from (\d+\.\d+\.\d+\.\d+)`)

func (a *BruteForceAnalyzer) parseSSHLogs() {
	for _, path := range []string{"/var/log/auth.log", "/var/log/secure"} {
		pos, entries := parseLogIncremental(path, a.lastSSHPos, func(line string) *logEntry {
			if m := sshFailRegex.FindStringSubmatch(line); m != nil {
				return &logEntry{ts: time.Now(), sourceIP: m[2], user: m[1], success: false}
			}
			if m := sshSuccessRegex.FindStringSubmatch(line); m != nil {
				return &logEntry{ts: time.Now(), sourceIP: m[2], user: m[1], success: true}
			}
			return nil
		})
		if pos > a.lastSSHPos {
			a.lastSSHPos = pos
			a.sshEntries = append(a.sshEntries, entries...)
			return // only parse from first found log file
		}
	}
}

// --- HTTP log parsing ---

// Matches nginx/apache combined log format: IP - - [date] "METHOD URL" STATUS
var httpFailRegex = regexp.MustCompile(`^(\d+\.\d+\.\d+\.\d+)\s.*?" (401|403) `)

func (a *BruteForceAnalyzer) parseHTTPLogs() {
	for _, path := range []string{
		"/var/log/nginx/access.log",
		"/var/log/apache2/access.log",
		"/var/log/httpd/access_log",
	} {
		pos, entries := parseLogIncremental(path, a.lastHTTPPos, func(line string) *logEntry {
			if m := httpFailRegex.FindStringSubmatch(line); m != nil {
				return &logEntry{ts: time.Now(), sourceIP: m[1], success: false}
			}
			return nil
		})
		if pos > a.lastHTTPPos {
			a.lastHTTPPos = pos
			a.httpEntries = append(a.httpEntries, entries...)
			return
		}
	}
}

func (a *BruteForceAnalyzer) prune() {
	cutoff := time.Now().Add(-a.window)
	a.sshEntries = pruneEntries(a.sshEntries, cutoff)
	a.httpEntries = pruneEntries(a.httpEntries, cutoff)
}

// --- helpers ---

func parseLogIncremental(path string, lastPos int64, parseLine func(string) *logEntry) (int64, []logEntry) {
	f, err := os.Open(path)
	if err != nil {
		return lastPos, nil
	}
	defer f.Close()

	// Check for log rotation (file shrunk).
	info, err := f.Stat()
	if err != nil {
		return lastPos, nil
	}
	if info.Size() < lastPos {
		lastPos = 0 // file was rotated, start from beginning
	}

	if lastPos > 0 {
		if _, err := f.Seek(lastPos, 0); err != nil {
			return lastPos, nil
		}
	}

	var entries []logEntry
	scanner := bufio.NewScanner(f)
	// Limit to 5000 new lines per scan to bound CPU.
	maxLines := 5000
	for scanner.Scan() && maxLines > 0 {
		maxLines--
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if e := parseLine(line); e != nil {
			entries = append(entries, *e)
		}
	}

	newPos, _ := f.Seek(0, 1) // current position
	return newPos, entries
}

func pruneEntries(entries []logEntry, cutoff time.Time) []logEntry {
	n := 0
	for _, e := range entries {
		if e.ts.After(cutoff) {
			entries[n] = e
			n++
		}
	}
	return entries[:n]
}

func topN(counts map[string]int, n int) []IPCount {
	type kv struct {
		k string
		v int
	}
	var sorted []kv
	for k, v := range counts {
		sorted = append(sorted, kv{k, v})
	}
	// Simple selection — fine for small N.
	var result []IPCount
	for i := 0; i < n && len(sorted) > 0; i++ {
		maxIdx := 0
		for j := 1; j < len(sorted); j++ {
			if sorted[j].v > sorted[maxIdx].v {
				maxIdx = j
			}
		}
		result = append(result, IPCount{IP: sorted[maxIdx].k, Count: sorted[maxIdx].v})
		sorted[maxIdx] = sorted[len(sorted)-1]
		sorted = sorted[:len(sorted)-1]
	}
	return result
}

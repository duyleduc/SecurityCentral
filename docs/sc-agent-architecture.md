# sc-agent Architecture — Server State Monitoring

> Design for Purpose 1: server health + security posture monitoring.
> Based on `spec-analysis-report.md` (38 optimized data points) and existing agent code.

---

## 1. Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Extend, don't rewrite** | Current dual-loop heartbeat works. Add collectors on top. |
| **Collector-per-domain** | Each metric domain (CPU, disk, network...) is a self-contained module. Easy to test, enable/disable, and add new ones. |
| **Multi-cadence** | Not everything needs 1s sampling. CPU and RAM do. Listening ports don't. Each collector declares its own frequency. |
| **Feature detection** | Docker collector only loads if Docker is present. Swap metrics only if swap exists. No wasted work. |
| **Dual pipeline** | Real-time metrics (heartbeat) vs security posture (periodic scan). Different payloads, different cadences, same transport. |
| **gopsutil + stdlib only** | No new dependencies. gopsutil already covers CPU, memory, disk, network, process, host. Supplement with `/proc` and `/sys` reads for Linux-specific data. |

---

## 2. Module Layout

```
sc-agent/
├── cmd/sc-agent/
│   └── main.go                          # CLI (unchanged: run, install, status)
│
├── internal/
│   ├── agent/
│   │   ├── agent.go                     # Orchestrator (refactored from heartbeat.go)
│   │   ├── scheduler.go                 # NEW — multi-cadence tick scheduler
│   │   ├── ringbuffer.go                # Renamed from collector.go — ring buffer only
│   │   ├── alertbuffer.go               # Extracted from collector.go — alert buffer only
│   │   ├── thresholds.go                # Extended — new alert types
│   │   └── shutdown.go                  # Unchanged
│   │
│   ├── collector/                       # NEW — pluggable collector system
│   │   ├── registry.go                  # Collector interface + registry
│   │   ├── cpu.go                       # CPU: utilization, iowait, load avg
│   │   ├── memory.go                    # Memory: used/available, swap, OOM
│   │   ├── disk.go                      # Disk: space per mount, I/O throughput
│   │   ├── network.go                   # Network: bytes, errors, TCP connections
│   │   ├── process.go                   # Process: count, top consumers, zombies
│   │   ├── service.go                   # Systemd: failed units, tracked services
│   │   ├── docker.go                    # Docker: daemon, containers, stats (conditional)
│   │   └── security.go                  # Security posture: ports, SSH, firewall, packages
│   │
│   ├── config/
│   │   └── agentconfig.go               # Extended with new thresholds + collector toggles
│   │
│   ├── install/
│   │   └── install.go                   # Unchanged
│   │
│   ├── platform/
│   │   └── client.go                    # Extended payloads (v2 heartbeat + security report)
│   │
│   ├── sysinfo/
│   │   └── sysinfo.go                   # Static system info (unchanged)
│   │
│   └── logging/
│       └── logging.go                   # Unchanged
│
└── go.mod                               # No new dependencies
```

---

## 3. Collector Interface

The core abstraction. Every metric domain implements this.

```go
// internal/collector/registry.go

// Cadence defines how often a collector runs.
type Cadence int

const (
    CadenceFast     Cadence = iota  // 1s sampling, aggregated to 60s
    CadenceStandard                 // 60s direct collection
    CadenceSlow                     // 5 min
    CadenceScan                     // 1 hour (security posture)
    CadenceDaily                    // 24 hours
)

// Snapshot is a single collection result.
// Each collector returns its own typed data under a string key.
type Snapshot struct {
    Key  string      // e.g., "cpu", "disk", "network"
    Data interface{} // Typed struct per collector
    At   time.Time
}

// Collector is the interface every metric domain implements.
type Collector interface {
    // Name returns a unique identifier (e.g., "cpu", "disk.io").
    Name() string

    // Cadence returns how often this collector should run.
    Cadence() Cadence

    // Enabled probes the host and returns true if this collector
    // can run (e.g., Docker collector checks if dockerd is present).
    // Called once at startup.
    Enabled() bool

    // Init is called once before the first Collect().
    // Use for baseline readings (e.g., previous network byte counters
    // needed for delta calculation).
    Init() error

    // Collect gathers current metrics. Must be safe for concurrent calls.
    // Returns nil Snapshot if nothing to report (transient error).
    Collect() (*Snapshot, error)
}

// Registry holds all registered collectors.
type Registry struct {
    collectors []Collector
}

func NewRegistry() *Registry { ... }
func (r *Registry) Register(c Collector) { ... }
func (r *Registry) Enabled() []Collector { ... }     // filters by Enabled()
func (r *Registry) ByCadence(c Cadence) []Collector { ... }
```

**Why an interface, not a function?**
- `Enabled()` allows feature detection at startup (Docker? systemd? swap?)
- `Init()` allows baseline capture (previous network byte counters for delta calculation)
- `Cadence()` lets the scheduler group collectors by frequency
- `Name()` enables per-collector logging and error isolation

---

## 4. Collector Implementations

### 4.1 CPU Collector — `CadenceFast` (1s)

```
Collects:
  - CPUPercent    float64   // overall utilization %
  - IOWait        float64   // iowait % (Linux only, 0 on other OS)
  - LoadAvg1      float64   // 1-min load average
  - LoadAvg5      float64   // 5-min load average
  - LoadAvg15     float64   // 15-min load average

Source: gopsutil cpu.Times() (delta between samples), load.Avg()
Ring buffer: yes (60 samples → aggregate avg/max for CPUPercent and IOWait)
```

### 4.2 Memory Collector — `CadenceFast` (1s)

```
Collects:
  - UsedPercent   float64   // RAM used %
  - AvailableBytes uint64   // MemAvailable in bytes
  - SwapUsedPct  float64    // swap used % (0 if no swap)
  - SwapInOut     uint64    // swap pages in+out since last sample (delta)

Source: gopsutil mem.VirtualMemory(), mem.SwapMemory()
Ring buffer: yes (60 samples → aggregate avg/max for UsedPercent)
Conditional: SwapInOut only reported if SwapTotal > 0
```

### 4.3 Disk Collector — `CadenceStandard` (60s)

```
Collects:
  - Mounts []MountMetrics   // per-mount usage
      - Path       string   // e.g., "/"
      - UsedPct    float64  // usage %
      - InodePct   float64  // inode usage % (Tier 2, Phase 4)
  - IO DiskIOMetrics
      - ReadBytes  uint64   // bytes read since last (delta)
      - WriteBytes uint64   // bytes written since last (delta)
      - IOUtil     float64  // estimated I/O utilization % (weighted time / interval)

Source: gopsutil disk.Usage() per partition, disk.IOCounters()
Init(): capture baseline IOCounters for delta calculation
Threshold alerts: #3 Disk Full, #4 Disk IO Saturation, #10 Disk Errors
```

### 4.4 Network Collector — `CadenceStandard` (60s)

```
Collects:
  - Interfaces []IfaceMetrics  // per-interface (non-loopback only)
      - Name       string
      - RxBytes    uint64      // received since last (delta)
      - TxBytes    uint64      // transmitted since last (delta)
      - RxErrors   uint64      // receive errors (delta)
      - TxErrors   uint64      // transmit errors (delta)
      - RxDrops    uint64      // receive drops (delta)
      - TxDrops    uint64      // transmit drops (delta)
  - TCPEstablished int         // active TCP connections
  - TCPListening   int         // listening TCP sockets (count only; full port list in security collector)

Source: gopsutil net.IOCounters(perNIC=true), net.Connections("tcp")
Init(): capture baseline IOCounters for delta calculation
```

### 4.5 Process Collector — `CadenceStandard` (60s)

```
Collects:
  - Total          int              // total process count
  - ZombieCount    int              // zombie process count
  - TopCPU         []ProcessInfo    // top 5 by CPU
  - TopRAM         []ProcessInfo    // top 5 by RAM
  - OOMKills       int              // OOM kill events since last check (delta from dmesg)

ProcessInfo:
  - PID    int32
  - Name   string
  - User   string
  - CPU    float64   // CPU %
  - RAM    float64   // RAM %
  - RSS    uint64    // resident set size bytes

Source: gopsutil process.Pids(), process.NewProcess() for top-N
OOM: parse dmesg or /dev/kmsg for "oom" / "killed process"
Threshold alerts: #7 Unexpected Spike (process-level), #9 Suspicious Process
Note: Top-N iteration is bounded (sample max 100 processes, sort, take 5)
```

### 4.6 Service Collector — `CadenceStandard` (60s)

```
Collects:
  - FailedUnits  []string   // names of failed systemd units

Source: exec `systemctl list-units --state=failed --no-legend --plain`
Enabled(): checks if systemctl binary exists
Threshold alerts: #11 Critical Service Down
```

### 4.7 Docker Collector — `CadenceStandard` (60s), Conditional

```
Collects:
  - DaemonActive   bool
  - Containers     []ContainerInfo
      - ID         string
      - Name       string
      - Image      string
      - State      string    // running, exited, etc.
      - CPUPercent float64
      - MemPercent float64
      - Restarts   int

Source: exec `docker ps -a --format json`, `docker stats --no-stream --format json`
Enabled(): checks if `docker` binary exists AND `systemctl is-active docker` succeeds
Note: Uses exec, not Docker SDK — avoids large dependency. JSON format parsing.
```

### 4.8 Security Collector — `CadenceScan` (1 hour)

This is the **differentiator**. Pure monitoring tools don't do this.

```
Collects:
  SecurityPosture:
    - ListeningPorts   []PortInfo       // all TCP/UDP listeners
        - Port     int
        - Proto    string               // "tcp" / "udp"
        - Process  string               // process name
        - BindAddr string               // 0.0.0.0 = external-facing
    - SSHConfig        SSHConfigInfo
        - RootLogin       string        // "yes" / "no" / "prohibit-password"
        - PasswordAuth    string        // "yes" / "no"
        - Port            int
        - PermitEmptyPwd  string
    - FirewallActive   bool             // ufw/iptables/nftables active
    - FirewallType     string           // "ufw" / "iptables" / "nftables" / "none"
    - LoggedInUsers    []UserSession
        - User    string
        - From    string                // source IP or "console"
        - Since   string                // login time
    - SSHAuthFailures  int              // failed SSH attempts since last check
    - ShellUsers       []string         // users with /bin/bash or /bin/sh
    - PendingReboot    bool
    - OpenFDs          FDInfo
        - Allocated  int
        - Max        int

  CadenceDaily items (bundled into security report):
    - InstalledPackages []PackageInfo   // name + version (dpkg/rpm)
        - Name    string
        - Version string
    - WorldWritable     []string        // world-writable files in /etc, /usr

Source:
  - Ports: gopsutil net.Connections() filtered to LISTEN state
  - SSH: parse /etc/ssh/sshd_config
  - Firewall: exec `ufw status` / `iptables -L -n` / `nft list ruleset`
  - Users: parse /etc/passwd (shell != /usr/sbin/nologin, /bin/false)
  - Sessions: exec `who` or parse utmp
  - SSH failures: count "Failed password" in /var/log/auth.log since last check
  - Packages: exec `dpkg-query -W -f '${Package}\t${Version}\n'` or `rpm -qa --queryformat`
  - Reboot: check /var/run/reboot-required
  - FDs: read /proc/sys/fs/file-nr
  - World-writable: exec `find /etc /usr -maxdepth 3 -perm -o+w -type f` (bounded depth)
```

---

## 5. Scheduler

Replaces the current single `collectLoop`. Groups collectors by cadence and ticks each group independently.

```go
// internal/agent/scheduler.go

type Scheduler struct {
    registry  *collector.Registry
    log       *logging.Logger
    results   chan collector.Snapshot  // all results flow here
}

func NewScheduler(reg *collector.Registry, log *logging.Logger) *Scheduler

// Run starts a goroutine per cadence group.
// Each goroutine ticks at the cadence interval and calls Collect()
// on all collectors in that group. Results pushed to the results channel.
func (s *Scheduler) Run(ctx context.Context) <-chan collector.Snapshot
```

**Cadence → Interval mapping:**

| Cadence | Interval | Collectors |
|---------|----------|------------|
| Fast | 1s | CPU, Memory |
| Standard | 60s | Disk, Network, Process, Service, Docker |
| Slow | 5 min | (reserved for future: ports baseline diff) |
| Scan | 1 hour | Security |
| Daily | 24 hours | Packages, World-writable files |

**Goroutine model:**

```
Scheduler.Run(ctx)
  ├── goroutine: fastTick (1s)
  │     ├── cpu.Collect() → results chan
  │     └── memory.Collect() → results chan
  │
  ├── goroutine: standardTick (60s)
  │     ├── disk.Collect() → results chan
  │     ├── network.Collect() → results chan
  │     ├── process.Collect() → results chan
  │     ├── service.Collect() → results chan
  │     └── docker.Collect() → results chan  (if enabled)
  │
  ├── goroutine: scanTick (1h)
  │     └── security.Collect() → results chan
  │
  └── goroutine: dailyTick (24h)
        └── security.CollectDaily() → results chan
```

Each goroutine:
1. Ticks at interval
2. Calls `Collect()` on each collector in the group sequentially (within a group, collectors are cheap)
3. If a collector returns error, log it, skip this tick, continue next time
4. Push `Snapshot` to shared results channel

---

## 6. Agent Orchestrator (Refactored)

The current `Agent.Run()` has two loops: `collectLoop` and `sendLoop`. The new design replaces `collectLoop` with the `Scheduler` and adds a `store` layer between scheduler output and heartbeat sending.

```go
// internal/agent/agent.go

type Agent struct {
    cfg        *config.Config
    client     *platform.Client
    log        *logging.Logger
    scheduler  *Scheduler
    store      *MetricStore          // NEW: holds latest snapshots per collector
    alertBuf   *AlertBuffer
    thresholds *ThresholdChecker     // NEW: extended threshold logic
}

func New(cfg *config.Config, log *logging.Logger) *Agent {
    reg := collector.NewRegistry()

    // Register all collectors
    reg.Register(collector.NewCPU())
    reg.Register(collector.NewMemory())
    reg.Register(collector.NewDisk())
    reg.Register(collector.NewNetwork())
    reg.Register(collector.NewProcess())
    reg.Register(collector.NewService())
    reg.Register(collector.NewDocker())
    reg.Register(collector.NewSecurity())

    return &Agent{
        cfg:        cfg,
        client:     platform.NewClient(cfg.APIBaseURL, cfg.APIKey),
        log:        log,
        scheduler:  NewScheduler(reg, log),
        store:      NewMetricStore(),
        alertBuf:   NewAlertBuffer(),
        thresholds: NewThresholdChecker(cfg),
    }
}

func (a *Agent) Run(ctx context.Context) {
    results := a.scheduler.Run(ctx)

    go a.processLoop(ctx, results)  // consume snapshots, check thresholds
    a.sendLoop(ctx)                 // send heartbeats (unchanged timing)
}
```

### Process Loop (replaces collectLoop)

```go
func (a *Agent) processLoop(ctx context.Context, results <-chan collector.Snapshot) {
    for {
        select {
        case <-ctx.Done():
            return
        case snap := <-results:
            a.store.Update(snap)
            alerts := a.thresholds.Check(snap)
            if len(alerts) > 0 {
                a.alertBuf.Push(alerts)
            }
        }
    }
}
```

### Send Loop (timing unchanged)

Same 60s normal / 15s urgent debounce pattern. The only change is **what** gets sent:

```go
func (a *Agent) buildHeartbeat(urgent bool, alerts []platform.Alert) platform.HeartbeatRequest {
    return platform.HeartbeatRequest{
        AgentID:  a.cfg.AgentID,
        Urgent:   urgent,
        Alerts:   alerts,
        Metrics:  a.store.AggregateMetrics(),     // NEW: builds full MetricsData v2
        System:   a.store.SystemDataIfChanged(),   // only on first send or change
    }
}
```

---

## 7. Metric Store

Holds the latest snapshot from each collector, plus a ring buffer for fast-cadence metrics that need aggregation (CPU, RAM).

```go
// internal/agent/store.go

type MetricStore struct {
    mu        sync.RWMutex
    latest    map[string]*collector.Snapshot   // keyed by collector name
    cpuRing   *RingBuffer[CPUSample]           // 60 samples for avg/max
    memRing   *RingBuffer[MemSample]           // 60 samples for avg/max
}

// Update stores a snapshot. For fast-cadence collectors,
// also pushes to the ring buffer.
func (ms *MetricStore) Update(snap collector.Snapshot) { ... }

// AggregateMetrics builds the heartbeat payload from current state.
// Fast metrics: aggregated from ring buffer (avg/max over 60s).
// Standard metrics: latest snapshot value.
func (ms *MetricStore) AggregateMetrics() platform.MetricsDataV2 { ... }
```

**What goes in the ring buffer (aggregated):**
- CPU percent → avg, max
- CPU iowait → avg, max
- RAM used percent → avg, max

**What uses latest value (no aggregation):**
- Load averages (already smoothed by the kernel)
- Disk space % per mount
- Disk I/O bytes (already a delta over 60s)
- Network bytes (already a delta over 60s)
- Process count
- TCP connections
- Everything else

---

## 8. Extended Threshold Checker

Current: checks CPU, RAM, Disk against static thresholds.
New: checks all 11 alert rules from the product spec.

```go
// internal/agent/thresholds.go

type ThresholdChecker struct {
    cfg          *config.Config
    prevCPU      float64          // for spike detection
    prevRAM      float64          // for spike detection
    knownPorts   map[int]bool     // baseline ports for "new port" detection
    portBaseline bool             // true after first port scan
}

func (tc *ThresholdChecker) Check(snap collector.Snapshot) []platform.Alert {
    switch snap.Key {
    case "cpu":
        return tc.checkCPU(snap.Data)      // #1 CPU High, #7 Spike
    case "memory":
        return tc.checkMemory(snap.Data)   // #2 Memory High, #7 Spike
    case "disk":
        return tc.checkDisk(snap.Data)     // #3 Disk Full, #4 IO Saturation, #10 Errors
    case "process":
        return tc.checkProcess(snap.Data)  // #9 Suspicious Process
    case "service":
        return tc.checkService(snap.Data)  // #11 Critical Service Down
    case "security":
        return tc.checkSecurity(snap.Data) // #8 New Public Port
    }
    return nil
}
```

**Alert rules mapped to collectors:**

| Spec Alert Rule | Collector | Check Logic |
|----------------|-----------|-------------|
| #1 CPU High | cpu | `CPUPercent > cfg.CPUThresh` |
| #2 Memory High | memory | `UsedPercent > cfg.RAMThresh` |
| #3 Disk Full | disk | `mount.UsedPct > cfg.DiskThresh` |
| #4 Disk IO Saturation | disk | `IOUtil > cfg.IOWaitThresh` (default 20%) |
| #5 Server Unreachable | platform-api | (server-side: 3 missed heartbeats) |
| #6 Agent Offline | platform-api | (server-side: no metrics for 5 min) |
| #7 Unexpected Spike | cpu, memory | `abs(current - prev) > 40%` within 1 min |
| #8 New Public Port | security | port in `ListeningPorts` not in `knownPorts` baseline, `BindAddr == "0.0.0.0"` |
| #9 Suspicious Process | process | unknown process in TopCPU with `CPU > 50%` |
| #10 Disk Errors | disk | `IOErrors > 0` (from gopsutil IOCounters) |
| #11 Critical Service Down | service | `len(FailedUnits) > 0` |

Note: #5 and #6 are **server-side** checks (platform-api detects missing heartbeats). The agent doesn't self-detect these.

---

## 9. Heartbeat Payload v2

Extend the current `HeartbeatRequest` to carry all new data. Backward-compatible — new fields are additive.

```go
// internal/platform/client.go

type HeartbeatRequest struct {
    AgentID string        `json:"agentId"`
    Urgent  bool          `json:"urgent"`
    Alerts  []Alert       `json:"alerts"`
    Metrics MetricsDataV2 `json:"metrics"`       // v2 — extended
    System  *SystemData   `json:"system,omitempty"`
}

type MetricsDataV2 struct {
    CPU     CPUMetricsV2      `json:"cpu"`
    Memory  MemoryMetrics     `json:"memory"`
    Load    LoadMetrics       `json:"load"`
    Disk    DiskMetricsV2     `json:"disk"`
    Network NetworkMetrics    `json:"network"`
    Process ProcessMetrics    `json:"process"`
    Service ServiceMetrics    `json:"service"`
    Docker  *DockerMetrics    `json:"docker,omitempty"`  // nil if Docker absent
}

// --- CPU ---
type CPUMetricsV2 struct {
    Avg      float64 `json:"avg"`       // avg CPU % over 60s
    Max      float64 `json:"max"`       // peak CPU % over 60s
    IOWait   float64 `json:"ioWait"`    // avg iowait % over 60s
}

// --- Memory ---
type MemoryMetrics struct {
    UsedPct      float64 `json:"usedPct"`        // avg RAM % over 60s
    UsedPctMax   float64 `json:"usedPctMax"`     // peak RAM % over 60s
    AvailableBytes uint64 `json:"availableBytes"` // latest MemAvailable
    SwapUsedPct  float64 `json:"swapUsedPct"`    // swap used %
}

// --- Load ---
type LoadMetrics struct {
    Load1  float64 `json:"load1"`
    Load5  float64 `json:"load5"`
    Load15 float64 `json:"load15"`
}

// --- Disk ---
type DiskMetricsV2 struct {
    Mounts []MountMetric `json:"mounts"`
    IO     DiskIO        `json:"io"`
}

type MountMetric struct {
    Path    string  `json:"path"`
    UsedPct float64 `json:"usedPct"`
}

type DiskIO struct {
    ReadBytesPerSec  uint64  `json:"readBytesPerSec"`
    WriteBytesPerSec uint64  `json:"writeBytesPerSec"`
    UtilPct          float64 `json:"utilPct"`
}

// --- Network ---
type NetworkMetrics struct {
    Interfaces []IfaceMetric `json:"interfaces"`
    TCPActive  int           `json:"tcpActive"`
}

type IfaceMetric struct {
    Name     string `json:"name"`
    RxBytes  uint64 `json:"rxBytes"`    // per 60s interval
    TxBytes  uint64 `json:"txBytes"`
    RxErrors uint64 `json:"rxErrors"`
    TxErrors uint64 `json:"txErrors"`
    Drops    uint64 `json:"drops"`      // rx + tx drops combined
}

// --- Process ---
type ProcessMetrics struct {
    Total     int            `json:"total"`
    Zombies   int            `json:"zombies"`
    OOMKills  int            `json:"oomKills"`
    Top       []ProcessInfo  `json:"top"`        // top 5 by CPU
}

type ProcessInfo struct {
    PID  int32   `json:"pid"`
    Name string  `json:"name"`
    User string  `json:"user"`
    CPU  float64 `json:"cpu"`
    RAM  float64 `json:"ram"`
}

// --- Service ---
type ServiceMetrics struct {
    FailedUnits []string `json:"failedUnits"`
}

// --- Docker (conditional) ---
type DockerMetrics struct {
    Running    int               `json:"running"`
    Stopped    int               `json:"stopped"`
    Containers []ContainerInfo   `json:"containers"`
}

type ContainerInfo struct {
    Name     string  `json:"name"`
    Image    string  `json:"image"`
    State    string  `json:"state"`
    CPU      float64 `json:"cpu"`
    Memory   float64 `json:"memory"`
    Restarts int     `json:"restarts"`
}
```

---

## 10. Security Posture Report (Separate Endpoint)

Security scan results are too large for the heartbeat. They go to a dedicated endpoint.

```
POST /v1/agents/security-posture
```

```go
type SecurityPostureReport struct {
    AgentID        string          `json:"agentId"`
    CollectedAt    string          `json:"collectedAt"`    // RFC3339

    ListeningPorts []PortInfo      `json:"listeningPorts"`
    SSHConfig      SSHConfigInfo   `json:"sshConfig"`
    Firewall       FirewallInfo    `json:"firewall"`
    LoggedInUsers  []UserSession   `json:"loggedInUsers"`
    SSHFailures    int             `json:"sshFailures"`
    ShellUsers     []string        `json:"shellUsers"`
    PendingReboot  bool            `json:"pendingReboot"`
    OpenFDs        FDInfo          `json:"openFDs"`

    // Daily items (included when available)
    Packages       []PackageInfo   `json:"packages,omitempty"`
    WorldWritable  []string        `json:"worldWritable,omitempty"`
}

type PortInfo struct {
    Port    int    `json:"port"`
    Proto   string `json:"proto"`
    Process string `json:"process"`
    Bind    string `json:"bind"`     // "0.0.0.0" = external
}

type SSHConfigInfo struct {
    RootLogin      string `json:"rootLogin"`
    PasswordAuth   string `json:"passwordAuth"`
    Port           int    `json:"port"`
    PermitEmptyPwd string `json:"permitEmptyPwd"`
}

type FirewallInfo struct {
    Active bool   `json:"active"`
    Type   string `json:"type"`   // ufw / iptables / nftables / none
}

type UserSession struct {
    User  string `json:"user"`
    From  string `json:"from"`
    Since string `json:"since"`
}

type FDInfo struct {
    Allocated int `json:"allocated"`
    Max       int `json:"max"`
}

type PackageInfo struct {
    Name    string `json:"name"`
    Version string `json:"version"`
}
```

---

## 11. Data Flow

```
                    ┌─────────────────────────────────────────────────┐
                    │                   SCHEDULER                     │
                    │                                                 │
                    │  ┌──────────────┐  ┌────────────────────────┐  │
                    │  │  Fast (1s)   │  │   Standard (60s)       │  │
                    │  │  ┌────────┐  │  │  ┌──────┐ ┌─────────┐ │  │
                    │  │  │  CPU   │  │  │  │ Disk │ │ Network │ │  │
                    │  │  │ Memory │  │  │  │ Proc │ │ Service │ │  │
                    │  │  └───┬────┘  │  │  │Docker│ └────┬────┘ │  │
                    │  └──────┼───────┘  │  └──┬───┘      │      │  │
                    │         │          └─────┼──────────┼──────┘  │
                    │  ┌──────┴────────────────┴──────────┴──────┐  │
                    │  │          results channel                 │  │
                    │  └────────────────────┬────────────────────┘  │
                    └──────────────────────┼────────────────────────┘
                                           │
                              ┌─────────────▼──────────────┐
                              │       PROCESS LOOP         │
                              │                            │
                              │  store.Update(snapshot)    │
                              │  thresholds.Check()        │
                              │  alertBuf.Push(alerts)     │
                              └─────────────┬──────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                  SEND LOOP                    │
                    │                                               │
                    │  ┌──────────────┐     ┌────────────────────┐ │
                    │  │ Normal (60s) │     │ Urgent (15s dbnc)  │ │
                    │  │              │     │ if alerts exist     │ │
                    │  │ store ─────────────────→ buildHeartbeat  │ │
                    │  │ .Aggregate() │     │    .Build()         │ │
                    │  └──────┬───────┘     └────────┬───────────┘ │
                    └─────────┼──────────────────────┼─────────────┘
                              │                      │
                              ▼                      ▼
                    ┌──────────────────────────────────────┐
                    │  POST /v1/agents/heartbeat            │
                    │  (X-Agent-Key auth)                   │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │  SECURITY SCAN (1h / 24h)            │
                    │  security.Collect()                   │
                    │           │                           │
                    │           ▼                           │
                    │  POST /v1/agents/security-posture     │
                    └──────────────────────────────────────┘
```

---

## 12. Configuration (Extended)

```go
type Config struct {
    // Existing
    APIBaseURL string  `json:"apiBaseUrl"`
    AgentID    string  `json:"agentId"`
    APIKey     string  `json:"apiKey"`

    // Thresholds (with defaults)
    CPUThresh      float64 `json:"cpuThreshold"`       // default: 85
    RAMThresh      float64 `json:"ramThreshold"`       // default: 85
    DiskThresh     float64 `json:"diskThreshold"`      // default: 90
    IOWaitThresh   float64 `json:"ioWaitThreshold"`    // default: 20
    SpikeThresh    float64 `json:"spikeThreshold"`     // default: 40 (% jump)

    // Collector toggles (all default true, can be disabled)
    Collectors CollectorConfig `json:"collectors"`
}

type CollectorConfig struct {
    CPU      bool `json:"cpu"`       // default: true
    Memory   bool `json:"memory"`    // default: true
    Disk     bool `json:"disk"`      // default: true
    Network  bool `json:"network"`   // default: true
    Process  bool `json:"process"`   // default: true
    Service  bool `json:"service"`   // default: true
    Docker   bool `json:"docker"`    // default: true (auto-disabled if not present)
    Security bool `json:"security"`  // default: true
}
```

---

## 13. Error Handling Strategy

| Scenario | Behavior |
|----------|----------|
| Collector returns error | Log warning, skip this tick, retry next tick. Never crash. |
| gopsutil function unavailable on OS | `Enabled()` returns false at startup. Collector never registered. |
| Docker not installed | Docker collector `Enabled()` returns false. `DockerMetrics` field is `nil` in heartbeat. |
| No swap partition | SwapUsedPct = 0, SwapInOut omitted. |
| `/var/log/auth.log` not readable | SSHFailures = -1 (signal "unavailable"), log once. |
| Heartbeat send fails | Log error, buffer metrics, retry next cycle. No exponential backoff for MVP (60s is already slow). |
| Security scan takes too long | 30s timeout per collector. If exceeded, return partial results. |
| Process iteration too slow | Sample max 200 PIDs, sort, take top 5. Bounded cost. |

---

## 14. Resource Budget

Target: minimal footprint on customer servers (1 vCPU, 1GB RAM VMs).

| Resource | Budget | How |
|----------|--------|-----|
| CPU | < 0.5% sustained | 1s sampling uses gopsutil (efficient). 60s collectors are cheap reads. Security scan is hourly burst. |
| RAM | < 15 MB | Ring buffers: 2 x 60 samples x ~200 bytes = ~24 KB. Latest snapshots: ~50 KB. Process list: bounded at 200 x 100 bytes = 20 KB. Package list: largest item, ~500 KB once per day. |
| Disk | 0 (no local storage) | All data sent to platform. Config file only (~1 KB). |
| Network | ~3 KB/min | Heartbeat: ~2-3 KB JSON every 60s. Security report: ~50-200 KB every hour. |
| Binary size | < 15 MB | gopsutil + cobra + stdlib. No Docker SDK, no DB drivers. |

Comparison:
- node_exporter: 10-30 MB RAM, <1% CPU
- Zabbix Agent: <32 MB RAM, <0.3% CPU
- **sc-agent target: <15 MB RAM, <0.5% CPU** — lighter than both

---

## 15. Implementation Phases

### Phase 2A — Core Metrics (extend existing agent)

Add 7 new data points to existing heartbeat. Low risk, high value.

| Task | Files Modified | New Files |
|------|---------------|-----------|
| Add load avg, iowait to CPU collection | `sysinfo/sysinfo.go` | — |
| Add swap to memory collection | `sysinfo/sysinfo.go` | — |
| Add disk I/O (delta calculation) | `sysinfo/sysinfo.go` | — |
| Add network bytes/errors (delta) | `sysinfo/sysinfo.go` | — |
| Extend `Metrics` struct | `sysinfo/sysinfo.go` | — |
| Extend `MetricsData` → `MetricsDataV2` | `platform/client.go` | — |
| Update `RingBuffer.Aggregate()` | `agent/collector.go` | — |
| Add iowait + spike thresholds | `agent/thresholds.go` | — |

**Can ship incrementally** — no architectural change needed.

### Phase 2B — Collector Architecture

Refactor into the pluggable collector system. This is the architectural change.

| Task | Files Modified | New Files |
|------|---------------|-----------|
| Create Collector interface + Registry | — | `collector/registry.go` |
| Extract CPU collector | `sysinfo/sysinfo.go` → | `collector/cpu.go` |
| Extract Memory collector | `sysinfo/sysinfo.go` → | `collector/memory.go` |
| Extract Disk collector | — | `collector/disk.go` |
| Extract Network collector | — | `collector/network.go` |
| Create Scheduler | — | `agent/scheduler.go` |
| Create MetricStore | — | `agent/store.go` |
| Refactor Agent orchestrator | `agent/heartbeat.go` → | `agent/agent.go` |
| Split ringbuffer / alertbuffer | `agent/collector.go` → | `agent/ringbuffer.go`, `agent/alertbuffer.go` |

### Phase 3 — Security Posture

Add security-relevant collection.

| Task | New Files |
|------|-----------|
| Process collector | `collector/process.go` |
| Service collector | `collector/service.go` |
| Security collector | `collector/security.go` |
| Security posture API endpoint (platform-api) | `modules/agents/` |
| New port detection in thresholds | `agent/thresholds.go` |
| Suspicious process detection | `agent/thresholds.go` |

### Phase 4 — Scoring Inputs

| Task | Changes |
|------|---------|
| Package list collection | `collector/security.go` (daily cadence) |
| World-writable file scan | `collector/security.go` (daily cadence) |
| Inode usage | `collector/disk.go` (add field) |

### Phase 5 — Docker (Optional)

| Task | New Files |
|------|-----------|
| Docker collector | `collector/docker.go` |
| Docker metrics in heartbeat | `platform/client.go` |

---

## 16. Testing Strategy

| Layer | What to Test | How |
|-------|-------------|-----|
| **Collectors** | Each collector returns correct struct shape, handles missing data gracefully | Unit test with mock `/proc` files and recorded gopsutil output |
| **Registry** | Feature detection, cadence grouping | Unit test with mock collectors (Enabled true/false) |
| **Scheduler** | Correct tick intervals, collector errors don't crash loop | Integration test with fake clock + mock collectors |
| **Thresholds** | All 11 alert rules fire correctly, don't fire on normal values | Table-driven unit tests per alert rule |
| **MetricStore** | Ring buffer aggregation, latest-value storage, concurrent access | Parallel unit tests with race detector (`go test -race`) |
| **Heartbeat payload** | JSON serialization matches API contract | Snapshot test: serialize → compare against golden JSON |
| **Security collector** | SSH config parsing, port detection, package list parsing | Unit test with sample config files |
| **End-to-end** | Agent starts, collects, sends heartbeat, receives response | Integration test against mock HTTP server |

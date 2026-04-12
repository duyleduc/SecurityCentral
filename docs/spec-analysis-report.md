# Spec Analysis: Server State Monitoring Checklist

**Source:** `docs/scan-monitor-checklist.md`
**Type:** Technical Requirements / Data Collection Specification
**Date:** 2026-04-12
**Scope:** Optimize 144-item checklist for SecurityCentral's lightweight agent

---

## Executive Summary

The checklist is comprehensive and well-structured — it covers everything a full-stack monitoring platform like Prometheus+Grafana would need. But **SecurityCentral is not that product**. It's a lightweight security platform for small teams with a ~2MB Go agent.

**The problem:** 144 data points is 10x what the agent needs. Implementing all of them would turn sc-agent into a node_exporter clone, bloating the binary, increasing CPU/RAM overhead, and drowning non-security users in data they can't act on.

**The recommendation:** Cut to **38 essential data points** across 3 tiers, directly mapped to the product spec's 11 alert rules + security posture scoring.

| Category | Original | Keep | Cut |
|----------|----------|------|-----|
| Identity & Baseline | 14 | 6 | 8 |
| CPU | 15 | 5 | 10 |
| Memory | 16 | 5 | 11 |
| Disk & Storage | 19 | 5 | 14 |
| Network | 24 | 7 | 17 |
| Processes & Services | 16 | 6 | 10 |
| Kernel & OS | 9 | 2 | 7 |
| Logs & Security | 9 | 2 | 7 |
| Docker | 12 | 0 | 12 |
| Application | 10 | 0 | 10 |
| **Total** | **144** | **38** | **106** |

---

## Market Benchmark

### What default agents collect

| Tool | Default Metrics | Agent RAM | Collection Interval | Positioning |
|------|----------------|-----------|---------------------|-------------|
| **node_exporter** | ~200 (45 collectors) | 10-30 MB | Passive (scraped 15-60s) | Raw metric exporter, no alerting |
| **Datadog Agent** | 75-100 | 880 MB-1.3 GB on disk | 15-20s | Enterprise APM + infra |
| **Netdata** | 800+ (auto-discovered) | 150-200 MB | 1s | Real-time observability, heavy |
| **Zabbix Agent** | ~50 (template) | <32 MB | 30-60s | Traditional monitoring |
| **New Relic Infra** | ~60 | 1 GB limit | 5-20s | Cloud infrastructure |
| **Wazuh Agent** | ~30 (security-focused) | Lightweight | Event-driven + hourly | SIEM/XDR, closest to SecurityCentral |
| **Uptime Kuma** | External checks only | N/A (agentless) | 20s+ | Pure availability |

### Industry consensus: essential metrics every agent collects

1. CPU utilization (overall + iowait at minimum)
2. Memory used/available (absolute + percent)
3. Disk space per mount (used/total/percent)
4. Disk I/O (read/write rates, utilization %)
5. Network traffic per interface (bytes in/out, errors, drops)
6. System load averages (1/5/15)
7. Uptime / boot time
8. System identity (hostname, OS, kernel, arch, CPU count, total RAM)

### Where SecurityCentral fits

SecurityCentral's positioning is closest to **Wazuh** (security-first) but with **Zabbix-level simplicity** (small agent, clear defaults). It should NOT compete with Datadog/Netdata on metric depth.

**Target:** 30-40 data points, <10 MB RAM, ~0.1% CPU overhead, 60s heartbeat cycle.

---

## Optimized Checklist: 38 Essential Data Points

### Tier 1 — CORE (always collected, 23 items)
These directly support the product spec's 11 alert rules.

| # | Orig# | Data Point | Source | Interval | Supports Alert Rule |
|---|-------|-----------|--------|----------|-------------------|
| 1 | 1 | Hostname | `hostname` | Once + on change | Identity |
| 2 | 2 | OS / distro / version | `/etc/os-release` | Once | Security scoring (patch status) |
| 3 | 3 | Kernel version | `uname -r` | Daily | Security scoring (patch status) |
| 4 | 6 | System uptime | `/proc/uptime` | 60s | #5 Server Unreachable, #6 Agent Offline |
| 5 | 8 | System time (UTC) | `time.Now()` | 60s | Clock drift detection |
| 6 | 18 | Total logical CPUs | `runtime.NumCPU()` | Once | Load avg normalization |
| 7 | 20 | Load average (1/5/15) | `/proc/loadavg` | 60s | Saturation signal (load > nproc) |
| 8 | 21 | CPU utilization % | gopsutil `cpu.Percent` | 1s (agg 60s) | #1 CPU High, #7 Unexpected Spike |
| 9 | 23 | CPU iowait % | gopsutil `cpu.TimesStat.Iowait` | 1s (agg 60s) | #4 Disk IO Saturation |
| 10 | 31 | Available RAM (bytes) | `/proc/meminfo` MemAvailable | 1s (agg 60s) | #2 Memory High, #7 Unexpected Spike |
| 11 | 32 | Used RAM % | Computed | 1s (agg 60s) | #2 Memory High |
| 12 | 38 | Swap used % | `/proc/meminfo` | 60s | Memory pressure indicator |
| 13 | 43 | OOM kill events | `dmesg` OOM grep | 60s | Critical — immediate alert |
| 14 | 47 | Disk usage per mount (%) | `df` / gopsutil `disk.Usage` | 60s | #3 Disk Full |
| 15 | 49 | Disk read/write bytes/s | gopsutil `disk.IOCounters` | 60s (delta) | #4 Disk IO Saturation, #10 Disk Errors |
| 16 | 51 | Disk I/O utilization % | gopsutil `disk.IOCounters` | 60s (delta) | #4 Disk IO Saturation |
| 17 | 68-69 | Network RX/TX bytes | `/proc/net/dev` or gopsutil | 60s (delta) | Network throughput (spec 4.2.2) |
| 18 | 70-71 | Network errors + drops | gopsutil `net.IOCounters` | 60s (delta) | Network health |
| 19 | 73 | Active TCP connections | `ss` or gopsutil `net.Connections` | 60s | Connection spike detection |
| 20 | 75 | Listening TCP ports | gopsutil `net.Connections(LISTEN)` | 5 min | #8 New Public Port |
| 21 | 89 | Total process count | gopsutil `process.Pids` | 60s | Fork bomb detection |
| 22 | 93 | Failed systemd units | `systemctl --failed` | 60s | #11 Critical Service Down |
| 23 | 27+44 | Top CPU/RAM consumers | gopsutil `process` top-5 | 60s | #9 Suspicious Process |

### Tier 2 — SECURITY POSTURE (periodic scan, 11 items)
These support security scoring. Collected every 1 hour or on-demand.

| # | Orig# | Data Point | Source | Interval | Purpose |
|---|-------|-----------|--------|----------|---------|
| 24 | 48 | Inode usage per mount | `df -i` / gopsutil | 1 hour | Silent failure prevention |
| 25 | 114 | SSH auth failures (count) | `/var/log/auth.log` tail | 5 min | Brute force detection |
| 26 | 117 | Currently logged-in users | `w` / `utmp` | 5 min | Unexpected session alert |
| 27 | — | SSH config safety | Parse `/etc/ssh/sshd_config` | 1 hour | Security score (spec 4.2.1) |
| 28 | — | Firewall active status | `ufw status` / `iptables -L` | 1 hour | Security score (spec 4.2.1) |
| 29 | — | Open ports (external-facing) | `ss -tlnp` + bind address check | 5 min | #8 New Public Port (external only) |
| 30 | — | Installed packages (name+version) | `dpkg -l` / `rpm -qa` | Daily | Vulnerability matching (spec 4.2.1) |
| 31 | — | Users with shell access | `/etc/passwd` parse | Daily | User access risk (spec 4.2.1) |
| 32 | — | World-writable files (key dirs) | `find /etc /usr -perm -o+w` | Daily | File permission risk (spec 4.2.1) |
| 33 | 113 | Pending reboot required | `/var/run/reboot-required` | Daily | Patch status |
| 34 | 98 | Open file descriptors (global) | `/proc/sys/fs/file-nr` | 5 min | FD exhaustion prevention |

### Tier 3 — CONDITIONAL (only when detected, 4 items)
Collected only when the relevant subsystem is present on the server.

| # | Orig# | Data Point | Source | Condition | Interval |
|---|-------|-----------|--------|-----------|----------|
| 35 | 123 | Docker daemon status | `systemctl is-active docker` | Docker installed | 60s |
| 36 | 125 | Running containers (count + names) | `docker ps` | Docker active | 60s |
| 37 | 127 | Container resource usage | `docker stats --no-stream` | Docker active | 60s |
| 38 | 39 | Swap in/out rate | `/proc/vmstat` pswpin/pswpout | Swap > 0 | 60s |

---

## What Was Cut and Why

### Entire sections removed

| Section | Items | Reason |
|---------|-------|--------|
| **Application-level (#135-144)** | 10 | Stack-specific (Nginx, PostgreSQL, Redis, Proxmox). Not the agent's job — these require per-app integrations that don't belong in a generic agent binary. |
| **Docker full suite (#124-134)** | 10 of 12 | Kept 3 essentials (daemon up, containers running, resource usage). Cut image lists, dangling images, volumes, networks, events, disk usage — these are housekeeping, not security or health. |
| **ZFS/LVM/RAID (#57-63)** | 7 | Niche storage stacks. A small-company agent shouldn't ship with ZFS ARC stat parsing. Add as optional plugin later if demand exists. |

### Items cut from kept sections

| Cut Category | Examples | Reason |
|-------------|----------|--------|
| **Hardware inventory** | BIOS version, serial number, manufacturer (#12-14) | Asset management, not monitoring. One-time audit data that doesn't change or trigger alerts. |
| **CPU deep-dive** | Per-core util, steal time, frequency, governor, context switches, interrupts (#21-22, 24-25, 28-29) | Observability deep-dive. SecurityCentral users are non-security teams — per-core metrics create noise. Aggregate CPU + iowait covers all spec alert rules. |
| **Memory breakdown** | Free vs buffers vs cached vs shared vs slab vs hugepages vs dirty pages (#33-42, 45) | Linux memory internals. Available RAM (MemAvailable) is the only metric that matters for alerting. The kernel already accounts for reclaimable pages. |
| **Disk forensics** | SMART health, SMART attributes, dmesg I/O errors (#54-56) | Requires `smartctl` binary and root access to raw devices. Useful for bare metal ops, not for a lightweight security agent. |
| **Network deep-dive** | Conntrack, routing table, ARP table, DNS resolution time, MTU, bonding/LACP, TCP retransmit details (#78-88) | Network engineering diagnostics. None of these map to SecurityCentral's alert rules or scoring model. |
| **Process investigation** | Full process snapshot, zombie details, per-process FD/socket/thread counts, per-user cron (#90, 92, 100-104) | Investigation tools, not monitoring data. The agent collects top-5 consumers + process count — enough for "suspicious process" detection. |
| **Kernel tuning** | Loaded modules, sysctl values, swappiness, dirty ratio, CPU vulnerabilities, SELinux status (#105-112) | Config audit items. Important but should be a one-time "security scan" feature, not continuous collection. Move to Tier 2 security posture scan. |
| **Full log analysis** | Journal errors, syslog grep, application log sizes (#119-122) | Log shipping belongs in a separate pipeline (Loki, Fluentd). An agent heartbeat shouldn't include log content. |

---

## Findings from Analysis Passes

### Pass 1: Completeness

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| C1 | **High** | Checklist covers monitoring only — no mapping to product spec's security scoring (4.2.1: OS patches, open ports, SSH config, firewall, user access, file permissions). | Add Tier 2 security posture items as defined above. These are what differentiate SecurityCentral from pure monitoring tools. |
| C2 | **High** | No mapping between data points and the 11 alert rules in spec section 5.2. | The optimized checklist above adds the "Supports Alert Rule" column. Every data point must justify its existence against a spec requirement. |
| C3 | **Medium** | Missing data retention / storage strategy. 144 data points at 15s intervals = ~830K rows/day per server. | At 38 data points and 60s intervals, it's ~55K rows/day — manageable in MySQL for small deployments. |
| C4 | **Medium** | No definition of "normal" baselines for trending items. Many items say "Baseline trending" with no guidance on how to compute or store baselines. | Defer baseline/anomaly detection to Phase 4 (Real-Time + Polish). For MVP, use static thresholds only. |
| C5 | **Low** | Section 10 (Application-level) is tagged "optional" but has no criteria for when to implement. | Remove entirely from agent scope. Application monitoring should be a separate integration layer. |

### Pass 2: Ambiguity

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| A1 | **High** | "Real-time — poll every 5–60s" is a 12x range. 5s polling on 10 metrics vs 60s polling on 10 metrics are very different resource profiles. | Standardize: 1s internal sampling, 60s heartbeat (current agent design). Urgent heartbeat at 15s on threshold breach. |
| A2 | **Medium** | "Near bandwidth cap" (#68-69) — what bandwidth cap? No way to auto-detect link speed on all platforms. | Use percent-change detection (>50% increase in 5 min) instead of absolute thresholds. |
| A3 | **Medium** | "Sustained" appears 8 times with no duration definition. "Sustained near device max" (#49), "> 80% sustained" (#51). | Define: "sustained" = metric exceeds threshold for 3+ consecutive collection intervals (i.e., 3 minutes at 60s intervals). |
| A4 | **Low** | Frequency symbols are qualitative. "🟡 Periodic — poll every 1–15 min" — 1 min and 15 min are very different operationally. | Fixed in optimized checklist: every item has an exact interval. |

### Pass 3: Contradictions

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| X1 | **Medium** | Item #33 says "Use MemAvailable instead" of MemFree, but both are listed as separate data points to collect. | Drop MemFree (#33). MemAvailable is the correct metric (accounts for reclaimable memory). Done in optimized list. |
| X2 | **Medium** | The "Recommended Polling Stack" section at the bottom suggests using node_exporter + Prometheus + Grafana + Promtail + Loki + cAdvisor + Alertmanager — but SecurityCentral IS the polling stack. The agent shouldn't depend on external tools. | Remove the "Recommended Polling Stack" section. It's guidance for a different architecture. sc-agent IS the agent; platform-api IS the storage/alerting layer. |
| X3 | **Low** | Item #22 (CPU steal time) is 🔴 15s, but only matters on VMs. On bare metal it's always 0. | Move to conditional collection: only report steal time if value > 0 on first sample. |

### Pass 4: Risk Assessment

| ID | Severity | Risk | Mitigation |
|----|----------|------|------------|
| R1 | **Critical** | **Agent bloat.** Implementing all 144 items would require gopsutil, smartctl bindings, ZFS parser, Docker SDK, LVM tools, conntrack parser, journal reader, etc. Binary size would go from ~8MB to ~30MB+. | The optimized 38-item list can be implemented with just `gopsutil` (already used) + stdlib file reads. No additional dependencies. |
| R2 | **High** | **CPU overhead on small VMs.** Items like per-core CPU (#21), per-process RSS (#45), full `lsof` (#100), and per-user cron scan (#104) are expensive on low-resource servers. | Removed all high-cost items. Top-5 process sampling (kept) uses gopsutil's process iteration which is bounded. |
| R3 | **High** | **Heartbeat payload size.** 144 data points per heartbeat at 15s intervals = large JSON payloads + high DB write volume. | 38 data points at 60s = ~2-3 KB per heartbeat. Manageable. |
| R4 | **Medium** | **Root access required for many items.** `dmidecode`, `smartctl`, `dmesg`, reading `/var/log/auth.log`, all Docker commands require root/sudo. | sc-agent already runs as root (systemd service). But minimize privileged operations — prefer `/proc` and `/sys` reads over subprocess execution. |

### Pass 5: Implementability

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| I1 | **High** | Many commands are Linux-specific (`/proc/meminfo`, `systemctl`, `ss`). No macOS/Windows guidance. | Target Linux only for agent metrics (the primary use case). System info collection can remain cross-platform via gopsutil abstractions. |
| I2 | **High** | Checklist uses shell commands, but sc-agent should use Go libraries (gopsutil) not subprocess calls. | Map every data point to its gopsutil equivalent. Only fall back to exec for: `systemctl --failed`, SSH config parse, package list. |
| I3 | **Medium** | No guidance on error handling when a data point is unavailable (e.g., no swap partition, no Docker, permission denied). | Agent should use best-effort collection: if a data point fails, log once and skip. Never crash or retry aggressively. Include a `capabilities` field in the first heartbeat listing what the agent can collect on this host. |
| I4 | **Medium** | No data format specification for the heartbeat payload. The checklist defines what to collect but not how to serialize it. | Already addressed: sc-agent has `HeartbeatRequest` struct in `platform/client.go`. Extend it with the new fields from the optimized list. |

---

## Implementation Priority

### Phase 2 (Current — complete agent heartbeat)
Add to existing heartbeat — **7 new data points**:
- Load average 1/5/15 (#7)
- CPU iowait % (#9)
- Swap used % (#12)
- Disk I/O bytes + utilization (#15-16)
- Network RX/TX bytes (#17)
- Network errors + drops (#18)

These bring the agent from "3 toy metrics" to competitive parity with minimum viable monitoring.

### Phase 3 (Security posture)
Add security-relevant collection — **10 new data points**:
- Listening ports (#20, #29)
- Top process consumers (#23)
- Failed systemd units (#22)
- SSH auth failures (#25)
- SSH config safety (#27)
- Firewall status (#28)
- Total process count (#21)
- OOM kill events (#13)
- Active TCP connections (#19)
- Currently logged-in users (#26)

### Phase 4 (Scoring + Polish)
Add scoring inputs — **6 new data points**:
- Installed packages (#30)
- Users with shell access (#31)
- World-writable files (#32)
- Pending reboot (#33)
- Open FDs (#34)
- Inode usage (#24)

### Phase 5 (Optional - Docker)
Add if demand exists — **4 data points**:
- Docker daemon, containers, resource usage, swap rate (#35-38)

---

## Key Takeaway

The original checklist is a great **reference document** for a full observability platform. But SecurityCentral's agent needs to be opinionated:

> **Collect 38 things well, alert on 11 rules, score on 7 categories.**

Every market-leading lightweight agent (Zabbix: ~50 items, New Relic: ~60 items) converges on this range. The only tools collecting 100+ metrics (Netdata, node_exporter) are designed as raw data exporters, not as end-user products.

SecurityCentral's competitive advantage is **not more data** — it's **actionable security posture** for teams that don't have a dedicated SRE. Cut the noise.

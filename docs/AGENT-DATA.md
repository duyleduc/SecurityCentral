# Agent Data Collection Reference

Everything the `sc-agent` binary collects from the host, when it collects it, and how.

---

## Data Collected at Install Time

Collected once when `sc-agent install --token <TOKEN>` runs.
Sent to `POST /v1/agents/enroll`.

| Data | Source | Example |
|------|--------|---------|
| Hostname | `os.Hostname()` | `prod-web-01` |
| OS family | `/etc/os-release` `ID` field | `ubuntu`, `centos`, `alpine` |
| OS version | `/etc/os-release` `VERSION_ID` field | `22.04`, `9`, `3.18` |
| Architecture | `runtime.GOARCH` | `amd64`, `arm64` |
| Cloud provider | IMDS auto-detection (see below) | `aws`, `gcp`, `azure`, or empty |
| Cloud region | IMDS | `us-east-1`, `us-central1-a` |
| Cloud instance ID | IMDS | `i-0abc123def456` |
| Cloud instance type | IMDS | `t3.micro`, `e2-medium` |
| CSR | Generated ECDSA P-256 keypair | PEM-encoded PKCS#10 |

### Cloud Auto-Detection

The agent probes cloud metadata endpoints with a **1-second timeout** per provider. No credentials needed — IMDS is available from within the instance.

| Provider | Endpoint | Data Retrieved |
|----------|----------|---------------|
| **AWS** | `http://169.254.169.254/latest/meta-data/` | `instance-id`, `placement/region`, `instance-type` |
| **GCP** | `http://metadata.google.internal/computeMetadata/v1/` | `instance/id`, `instance/zone`, `instance/machine-type` |
| **Azure** | `http://169.254.169.254/metadata/instance?api-version=2021-02-01` | `compute.vmId`, `compute.location`, `compute.vmSize` |

Detection order: AWS → GCP → Azure. Stops at first successful probe. If all fail → on-prem/bare metal (fields left empty).

---

## Data Collected Every Heartbeat

Sent every **60 seconds** to `POST /v1/agents/heartbeat` via mTLS.

### Identity (updated each heartbeat)

| Data | Source | Example |
|------|--------|---------|
| Agent version | Compiled into binary | `1.0.0` |
| Hostname | `os.Hostname()` | `prod-web-01` |
| OS family | `/etc/os-release` | `ubuntu` |
| OS version | `/etc/os-release` | `22.04` |

### Resource Usage (real-time)

| Data | Source | Example |
|------|--------|---------|
| CPU % | `/proc/stat` (two reads, 500ms delta) | `23.5` |
| Memory % | `/proc/meminfo` (`MemTotal - MemAvailable`) | `67.2` |
| Disk % | `syscall.Statfs("/")` | `45.8` |
| Load average (1m) | `/proc/loadavg` | `0.52` |
| Load average (5m) | `/proc/loadavg` | `0.38` |
| Load average (15m) | `/proc/loadavg` | `0.41` |
| Memory used (MB) | `/proc/meminfo` | `2718` |
| Memory total (MB) | `/proc/meminfo` `MemTotal` | `4048` |
| Disk used (GB) | `syscall.Statfs("/")` | `18` |
| Disk total (GB) | `syscall.Statfs("/")` | `40` |
| Uptime (seconds) | `/proc/uptime` | `864000` |

### System Info (static, collected once at startup)

| Data | Source | Example |
|------|--------|---------|
| Kernel version | `syscall.Uname()` | `5.15.0-91-generic` |
| CPU cores | `runtime.NumCPU()` | `4` |
| CPU model | `/proc/cpuinfo` `model name` | `Intel(R) Xeon(R) CPU @ 2.20GHz` |
| Total RAM (MB) | `/proc/meminfo` `MemTotal` | `4048` |
| Total disk (GB) | `syscall.Statfs("/")` total blocks | `40` |
| IP addresses | `net.Interfaces()` (non-loopback IPv4) | `["10.0.1.15", "172.17.0.1"]` |

---

## Data Collected During Scans

Scans run on a configurable interval (default: **every 6 hours**) or on-demand via dashboard.
Results sent to `POST /v1/agents/findings` via mTLS.

### OS Package Vulnerabilities (`infra_packages`)

| Data | Source | Example |
|------|--------|---------|
| Package name | OS package manager | `openssl` |
| Installed version | OS package manager | `1.1.1f-1ubuntu2.19` |
| Fixed version | Vulnerability database | `1.1.1f-1ubuntu2.20` |
| CVE ID | NVD / vuln DB match | `CVE-2023-5678` |
| CVSS score | NVD | `7.5` |
| CVSS vector | NVD | `CVSS:3.1/AV:N/AC:L/PR:N/...` |
| Severity | Derived from CVSS | `high` |
| Auto-fixable | Fixed version available? | `true` |
| Remediation | Generated advice | `Upgrade openssl to 1.1.1f-1ubuntu2.20` |

Package detection by OS:

| OS | Method | What it reads |
|----|--------|--------------|
| Ubuntu / Debian | `dpkg-query -W -f '${Package}\t${Version}\n'` | All installed .deb packages |
| CentOS / RHEL | `rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\n'` | All installed RPM packages |
| Alpine | Parse `/lib/apk/db/installed` or `apk list -I` | All installed APK packages |

### CIS Compliance Benchmarks (`infra_compliance`)

30+ checks across 5 categories:

#### SSH Hardening (CIS 5.2.x)

| Check | What it reads | Pass condition |
|-------|--------------|----------------|
| Root login disabled | `/etc/ssh/sshd_config` `PermitRootLogin` | `no` |
| Empty passwords blocked | `/etc/ssh/sshd_config` `PermitEmptyPasswords` | `no` |
| MaxAuthTries | `/etc/ssh/sshd_config` `MaxAuthTries` | `<= 4` |
| Protocol version | `/etc/ssh/sshd_config` `Protocol` | `2` |
| X11 forwarding | `/etc/ssh/sshd_config` `X11Forwarding` | `no` |
| Approved ciphers | `/etc/ssh/sshd_config` `Ciphers` | No weak ciphers (DES, RC4, etc.) |
| Approved MACs | `/etc/ssh/sshd_config` `MACs` | No weak MACs (MD5, etc.) |
| Login grace time | `/etc/ssh/sshd_config` `LoginGraceTime` | `<= 60` |
| Client alive interval | `/etc/ssh/sshd_config` `ClientAliveInterval` | Set and reasonable |

#### Filesystem Security (CIS 1.x)

| Check | What it reads | Pass condition |
|-------|--------------|----------------|
| cramfs disabled | `/proc/modules`, `modprobe -n` | Module not loaded |
| squashfs disabled | `/proc/modules`, `modprobe -n` | Module not loaded |
| udf disabled | `/proc/modules`, `modprobe -n` | Module not loaded |
| /tmp nodev | `/proc/mounts` | `nodev` option present |
| /tmp nosuid | `/proc/mounts` | `nosuid` option present |
| /tmp noexec | `/proc/mounts` | `noexec` option present |
| Sticky bit on world-writable dirs | `find` world-writable dirs | Sticky bit set |

#### Network Security (CIS 3.x)

| Check | What it reads | Pass condition |
|-------|--------------|----------------|
| IP forwarding | `/proc/sys/net/ipv4/ip_forward` | `0` |
| ICMP redirects | `/proc/sys/net/ipv4/conf/all/accept_redirects` | `0` |
| TCP SYN cookies | `/proc/sys/net/ipv4/tcp_syncookies` | `1` |
| Source-routed packets | `/proc/sys/net/ipv4/conf/all/accept_source_route` | `0` |
| IPv6 router advertisements | `/proc/sys/net/ipv6/conf/all/accept_ra` | `0` |

#### Kernel Security (CIS 1.5.x)

| Check | What it reads | Pass condition |
|-------|--------------|----------------|
| ASLR enabled | `/proc/sys/kernel/randomize_va_space` | `2` |
| ptrace scope | `/proc/sys/kernel/yama/ptrace_scope` | `>= 1` |
| Core dumps restricted | `/etc/security/limits.conf` | `* hard core 0` |
| SUID dumpable | `/proc/sys/fs/suid_dumpable` | `0` |

#### User/Password Policy (CIS 5.4.x, 6.2.x)

| Check | What it reads | Pass condition |
|-------|--------------|----------------|
| Password max days | `/etc/login.defs` `PASS_MAX_DAYS` | `<= 365` |
| Password min days | `/etc/login.defs` `PASS_MIN_DAYS` | `>= 1` |
| Password warning age | `/etc/login.defs` `PASS_WARN_AGE` | `>= 7` |
| Inactive account lock | `/etc/default/useradd` `INACTIVE` | Set (not `-1`) |
| Default umask | `/etc/login.defs` `UMASK` | `027` or more restrictive |
| No duplicate UIDs | `/etc/passwd` | All UIDs unique |
| No duplicate GIDs | `/etc/group` | All GIDs unique |
| Root-only UID 0 | `/etc/passwd` | Only `root` has UID 0 |

---

## Severity Mapping

| CVSS Score | Severity |
|------------|----------|
| 9.0 – 10.0 | Critical |
| 7.0 – 8.9 | High |
| 4.0 – 6.9 | Medium |
| 0.1 – 3.9 | Low |
| 0 | Info |

---

## Data NOT Collected

The agent does **not** collect:
- File contents (only package metadata and config values from specific paths)
- User data, application data, or database contents
- Environment variables or secrets
- Network traffic or packet captures
- Browsing history or application logs
- Any data from non-standard paths (only reads procfs, sysfs, and standard config locations)

---

## Data Flow

```
Target Server                         Platform API                    Dashboard
┌─────────────────┐                  ┌──────────────┐               ┌──────────┐
│  sc-agent        │                  │              │               │          │
│                  │──── install ────▶│  /enroll     │               │          │
│                  │  hostname, os,   │  Creates     │               │          │
│                  │  arch, cloud,    │  Server +    │               │          │
│                  │  CSR             │  signs cert  │               │          │
│                  │                  │              │               │          │
│                  │◀─── response ───│  agentId +   │               │          │
│                  │  cert, CA, cfg   │  certs       │               │          │
│                  │                  │              │               │          │
│                  │── heartbeat ───▶│  /heartbeat  │──── query ───▶│ Server   │
│                  │  (every 60s)     │  Updates     │               │ detail   │
│                  │  CPU, mem, disk, │  metadata    │               │ page     │
│                  │  kernel, IPs,    │              │               │          │
│                  │  load avg        │              │               │          │
│                  │                  │              │               │          │
│                  │── findings ────▶│  /findings   │──── query ───▶│ Findings │
│                  │  (every 6h)      │  Dedup +     │               │ page     │
│                  │  packages, CVEs, │  ingest      │               │          │
│                  │  compliance      │              │               │          │
└─────────────────┘                  └──────────────┘               └──────────┘
         │                                    │
         │  mTLS (client cert)                │  JWT (user auth)
         │  No secrets sent                   │
         │  All data is infra metadata        │
```

---

## Storage on Platform

| Data | Stored in | Field |
|------|-----------|-------|
| Hostname, OS, arch, cloud | `servers` table | Direct columns |
| Agent version, last heartbeat | `servers` table | Direct columns |
| Resource usage (CPU, mem, disk, load, uptime) | `servers.metadata` JSON | `metadata.resourceUsage` |
| System info (kernel, cores, RAM, IPs) | `servers.metadata` JSON | `metadata.systemInfo` |
| Package vulnerabilities | `findings` table | One row per finding |
| Compliance check results | `findings` table | One row per check |

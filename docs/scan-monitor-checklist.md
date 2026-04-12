# Server State Monitoring — Data Collection Checklist

> **Purpose:** Define what to collect, how to collect it, and at what frequency for server state monitoring (purpose 1 — not CVE scanning).

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 | Real-time — poll every 5–60s, alert on threshold breach |
| 🟡 | Periodic — poll every 1–15 min, automated |
| 🔵 | Scheduled — hourly or daily cron job |
| ⚪ | Manual — on-demand / user-triggered only |

---

## 1. Identity & System Baseline

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 1 | Hostname / FQDN | `hostname -f` | ⚪ Manual | Change = investigate |
| 2 | OS / distro / version | `cat /etc/os-release` | ⚪ Manual | — |
| 3 | Kernel version | `uname -r` | 🔵 Daily | Change = reboot occurred |
| 4 | Architecture | `uname -m` | ⚪ Manual | — |
| 5 | Virtualization type | `systemd-detect-virt` | ⚪ Manual | — |
| 6 | System uptime | `cat /proc/uptime` | 🟡 5 min | Sudden drop = unexpected reboot |
| 7 | Last reboot time | `who -b` | 🔵 Hourly | Cross-check against uptime |
| 8 | System time (UTC timestamp) | `date -u +%s` | 🟡 5 min | Drift > 1s = check NTP |
| 9 | NTP sync status | `timedatectl show` | 🟡 5 min | `NTPSynchronized=no` = alert |
| 10 | Timezone | `timedatectl show --property=Timezone` | 🔵 Daily | Unexpected change = alert |
| 11 | Locale | `localectl status` | ⚪ Manual | — |
| 12 | BIOS / firmware version | `dmidecode -s bios-version` | ⚪ Manual | After firmware update |
| 13 | System manufacturer / model | `dmidecode -s system-product-name` | ⚪ Manual | Asset audit only |
| 14 | Serial number | `dmidecode -s system-serial-number` | ⚪ Manual | Asset tracking only |

---

## 2. CPU

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 15 | CPU model | `lscpu \| grep 'Model name'` | ⚪ Manual | Static after setup |
| 16 | Physical CPU count | `lscpu \| grep 'Socket(s)'` | ⚪ Manual | Static |
| 17 | Cores per socket | `lscpu \| grep 'Core(s) per socket'` | ⚪ Manual | Static |
| 18 | Total logical CPUs | `nproc` | ⚪ Manual | Static |
| 19 | Hyperthreading enabled | `lscpu \| grep 'Thread(s) per core'` | ⚪ Manual | Static |
| 20 | Load average (1/5/15 min) | `cat /proc/loadavg` | 🔴 15s | 1-min avg > nproc |
| 21 | Per-core CPU utilization | `mpstat -P ALL 1 1` | 🔴 15s | Any core > 85% sustained |
| 22 | CPU steal time | `mpstat 1 1 \| awk '/all/{print $9}'` | 🔴 15s | > 10% = noisy neighbor |
| 23 | CPU iowait | `mpstat 1 1 \| awk '/all/{print $6}'` | 🔴 15s | > 30% = disk bottleneck |
| 24 | CPU frequency (current) | `cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq` | ⚪ Manual | Performance investigation |
| 25 | CPU governor | `cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor` | ⚪ Manual | When tuning |
| 26 | CPU temperature | `sensors \| grep Core` | 🟡 2 min | > 80°C = alert |
| 27 | Top CPU consumers | `ps axo pid,user,pcpu,comm --sort=-%cpu \| head -10` | 🟡 2 min | Log snapshot for trending |
| 28 | Context switches/s | `vmstat 1 2 \| tail -1 \| awk '{print $12}'` | 🔵 Hourly | Baseline trending |
| 29 | Interrupts/s | `vmstat 1 2 \| tail -1 \| awk '{print $11}'` | 🔵 Hourly | Baseline trending |

---

## 3. Memory

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 30 | Total RAM | `grep MemTotal /proc/meminfo` | ⚪ Manual | Static |
| 31 | Available RAM | `grep MemAvailable /proc/meminfo` | 🔴 15s | < 10% of total |
| 32 | Used RAM | Compute: MemTotal − MemAvailable | 🔴 15s | > 90% of total |
| 33 | Free RAM | `grep MemFree /proc/meminfo` | 🔵 Hourly | Use MemAvailable instead |
| 34 | Buffers | `grep Buffers /proc/meminfo` | 🔵 Hourly | Trending |
| 35 | Cached | `grep ^Cached /proc/meminfo` | 🔵 Hourly | Trending |
| 36 | Shared memory | `grep Shmem /proc/meminfo` | 🔵 Hourly | Trending |
| 37 | Swap total | `grep SwapTotal /proc/meminfo` | ⚪ Manual | Static |
| 38 | Swap used | Compute: SwapTotal − SwapFree | 🔴 15s | > 50% of swap |
| 39 | Swap in/out rate | `vmstat 1 3 \| awk 'NR>2{print "si="$7,"so="$8}'` | 🔴 15s | Any si/so > 0 = critical |
| 40 | Dirty pages | `grep Dirty /proc/meminfo` | 🟡 5 min | Sustained spike = write stall |
| 41 | Slab memory (full) | `grep Slab /proc/meminfo` | ⚪ Manual | Memory leak investigation |
| 42 | Hugepages stats | `grep HugePages /proc/meminfo` | 🔵 Hourly | Only if DB / JVM present |
| 43 | OOM kill events | `dmesg -T \| grep -i 'oom\|killed process'` | 🟡 1 min | Any event = immediate alert |
| 44 | Top memory consumers | `ps axo pid,user,pmem,rss,comm --sort=-%mem \| head -10` | 🟡 5 min | Log for trending |
| 45 | Per-process RSS | `ps axo pid,comm,rss --sort=-rss \| head -20` | 🔵 Hourly | Memory leak detection |

---

## 4. Disk & Storage

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 46 | Block device layout | `lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL` | ⚪ Manual | Disk expansion or troubleshooting |
| 47 | Disk usage per mount | `df -Ph` | 🟡 5 min | > 80% warn / > 90% critical |
| 48 | Inode usage per mount | `df -ih` | 🟡 5 min | > 80% = write failures |
| 49 | Read/write bytes/s per device | `iostat -xz 1 3` | 🔴 30s | Sustained near device max |
| 50 | I/O await latency | `iostat -x 1 1 \| awk 'NR>3{print $1,$10}'` | 🔴 30s | > 20ms SSD / > 50ms HDD |
| 51 | I/O utilization % | `iostat -x 1 1 \| awk 'NR>3{print $1,$NF}'` | 🔴 30s | > 80% sustained |
| 52 | I/O queue depth | `iostat -x 1 1 \| awk 'NR>3{print $1,$8}'` | 🟡 1 min | Sustained high = saturation |
| 53 | Read/write IOPS | `iostat -x 1 1` (r/s, w/s columns) | 🔴 30s | Sustained near device limit |
| 54 | Disk errors (dmesg) | `dmesg -T \| grep -iE 'I/O error\|blk_update_request\|exception'` | ⚪ Manual | I/O error investigation |
| 55 | SMART health summary | `smartctl -H /dev/sdX` | ⚪ Manual | Disk showing errors |
| 56 | SMART attributes (full) | `smartctl -A /dev/sdX` | ⚪ Manual | Reallocated sectors, spin retries |
| 57 | ZFS pool status | `zpool status` | 🟡 5 min | Any DEGRADED / FAULTED state |
| 58 | ZFS pool capacity | `zpool list` | 🟡 5 min | Used > 80% |
| 59 | ZFS ARC stats (full) | `cat /proc/spl/kstat/zfs/arcstats` | 🔵 Hourly | Trending |
| 60 | ZFS ARC hit rate | Compute: hits / (hits + misses) from arcstats | 🟡 5 min | Drop below 80% = investigate |
| 61 | LVM volume list | `lvs -o lv_name,vg_name,lv_size,data_percent` | 🔵 Daily | New/removed volumes |
| 62 | LVM thin pool usage | `lvs -o lv_name,data_percent,metadata_percent` | 🟡 5 min | data_percent > 80% |
| 63 | Software RAID status | `cat /proc/mdstat` | 🟡 2 min | Any degraded array |
| 64 | Mount options | `findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS` | 🔵 Daily | Unexpected remount |

---

## 5. Network

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 65 | Interface list + state | `ip -j link show` | 🔵 Daily | New/removed interface |
| 66 | IP addresses | `ip -j addr show` | 🔵 Hourly | Unexpected IP change |
| 67 | Interface up/down state | `ip -j link show \| jq '.[].operstate'` | 🔴 15s | Any interface goes DOWN |
| 68 | RX bytes per interface | `cat /proc/net/dev` | 🔴 15s | Near bandwidth cap (compute delta) |
| 69 | TX bytes per interface | `cat /proc/net/dev` | 🔴 15s | Near bandwidth cap (compute delta) |
| 70 | RX/TX errors | `ip -s link show` | 🔴 15s | Any non-zero increment |
| 71 | RX/TX dropped packets | `ip -s link show` | 🔴 15s | Any non-zero increment |
| 72 | Network throughput rate | `sar -n DEV 1 3` | 🟡 1 min | Baseline trending |
| 73 | Active TCP connections | `ss -tn state established \| wc -l` | 🔴 15s | Sudden spike or drop |
| 74 | Connection state breakdown | `ss -tan \| awk 'NR>1{print $1}' \| sort \| uniq -c` | 🔴 15s | CLOSE_WAIT > 100 / TIME_WAIT > 500 |
| 75 | Listening TCP ports | `ss -tlnp` | 🟡 5 min | New unexpected port = alert |
| 76 | Listening UDP ports | `ss -ulnp` | 🟡 5 min | New unexpected port = alert |
| 77 | Total socket count | `ss -s` | 🟡 2 min | Sudden large increase |
| 78 | TCP retransmit details | `ss -ti \| grep retrans` | ⚪ Manual | Network degradation investigation |
| 79 | TCP retransmit rate | `netstat -s \| grep -i retransmit` | 🟡 2 min | Rising counter = network issue |
| 80 | Conntrack table usage | `cat /proc/sys/net/netfilter/nf_conntrack_count` | 🔴 15s | > 80% of nf_conntrack_max |
| 81 | Conntrack max | `cat /proc/sys/net/netfilter/nf_conntrack_max` | 🟡 5 min | Approaching limit |
| 82 | Routing table | `ip route show` | 🔵 Hourly | Unexpected route injection |
| 83 | Default gateway | `ip route \| grep default` | 🔵 Hourly | Change = potential MITM |
| 84 | ARP / neighbor table | `ip neigh show` | 🔵 Hourly | New unexpected ARP entries |
| 85 | DNS resolver config | `cat /etc/resolv.conf` | 🔵 Daily | Detect tampering |
| 86 | DNS resolution time | `time dig @<nameserver> google.com` | 🔵 Hourly | Latency trending |
| 87 | MTU per interface | `ip link show \| grep mtu` | 🔵 Daily | Change = connectivity issues |
| 88 | Bond / LACP status | `cat /proc/net/bonding/bond0` | ⚪ Manual | Link failure investigation |

---

## 6. Processes & Services

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 89 | Total process count | `ps aux \| wc -l` | 🔴 30s | Sudden spike = fork bomb risk |
| 90 | Full process list snapshot | `ps axo pid,ppid,user,stat,pcpu,pmem,rss,comm,args` | ⚪ Manual | Performance or security investigation |
| 91 | Zombie process count | `ps axo stat \| grep -c '^Z'` | 🔴 30s | > 5 zombies |
| 92 | Zombie process details | `ps axo pid,ppid,stat,comm \| awk '$3~/^Z/'` | ⚪ Manual | When zombie count > 0 |
| 93 | Failed systemd units | `systemctl list-units --state=failed --no-legend` | 🔴 30s | Any failure = alert |
| 94 | All service states | `systemctl list-units --type=service --all --no-legend` | 🟡 5 min | State change detection |
| 95 | Service restart counts | `systemctl show <svc> --property=NRestarts` | 🟡 1 min | Any increment |
| 96 | Service active timestamps | `systemctl show <svc> --property=ActiveEnterTimestamp` | 🟡 5 min | Unexpected restart |
| 97 | Systemd timer list | `systemctl list-timers --all` | 🟡 5 min | Missed scheduled runs |
| 98 | Open file descriptors (global) | `cat /proc/sys/fs/file-nr` | 🔴 30s | > 80% of file-max |
| 99 | FD max limit | `cat /proc/sys/fs/file-max` | 🔵 Daily | Static config |
| 100 | Open FDs per process (top) | `lsof -n \| awk '{print $2}' \| sort \| uniq -c \| sort -rn \| head -10` | 🟡 5 min | FD leak — process trending up |
| 101 | Open sockets per process | `ss -tnp \| grep -oP 'pid=\K[0-9]+' \| sort \| uniq -c \| sort -rn \| head -10` | ⚪ Manual | Connection leak investigation |
| 102 | Thread count per process | `ps -eo pid,nlwp,comm --sort=-nlwp \| head -10` | ⚪ Manual | Threadpool exhaustion |
| 103 | Cron jobs (system) | `ls -la /etc/cron* ; cat /etc/crontab` | 🔵 Daily | New/modified entries |
| 104 | Cron jobs (all users) | `for u in $(cut -f1 -d: /etc/passwd); do crontab -u $u -l 2>/dev/null; done` | 🔵 Daily | Unexpected new jobs |

---

## 7. Kernel & OS

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 105 | Loaded kernel modules | `lsmod` | ⚪ Manual | Security audit / troubleshooting |
| 106 | Key sysctl values | `sysctl -a 2>/dev/null \| grep -E 'net.core\|vm.swappiness\|fs.file-max\|kernel.pid_max'` | 🔵 Daily | Config drift from baseline |
| 107 | Swappiness | `sysctl vm.swappiness` | 🔵 Daily | Unexpected change |
| 108 | Dirty ratio | `sysctl vm.dirty_ratio vm.dirty_background_ratio` | 🔵 Daily | Unexpected change |
| 109 | CPU vulnerability mitigations | `grep -r . /sys/devices/system/cpu/vulnerabilities/` | ⚪ Manual | After kernel update |
| 110 | Kernel messages (errors) | `dmesg -T --level=err,crit,alert,emerg` | 🟡 1 min | Any new err/crit/emerg line |
| 111 | Kernel messages (full recent) | `dmesg -T --since "1 hour ago"` | ⚪ Manual | Post-incident review |
| 112 | SELinux / AppArmor status | `getenforce` / `apparmor_status` | ⚪ Manual | Security audit |
| 113 | Pending reboot required | `test -f /var/run/reboot-required && echo yes` | 🔵 Daily | After apt upgrade |

---

## 8. Logs & Security Events

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 114 | SSH auth failures | `grep 'Failed password\|Invalid user' /var/log/auth.log \| tail -50` | 🟡 1 min | > 10 failures/min = brute force |
| 115 | Successful SSH logins | `grep 'Accepted' /var/log/auth.log \| tail -20` | 🟡 2 min | Unexpected source IP |
| 116 | Last login history | `last -n 20` | ⚪ Manual | Security investigation |
| 117 | Currently logged-in users | `w` | 🟡 2 min | Unexpected active session |
| 118 | Sudo usage | `grep 'sudo' /var/log/auth.log \| tail -20` | 🟡 2 min | Unexpected sudo invocation |
| 119 | Systemd journal errors | `journalctl -p err --since "1 hour ago" --no-pager` | 🟡 2 min | New error lines |
| 120 | Journal disk usage | `journalctl --disk-usage` | 🔵 Daily | Runaway logging |
| 121 | Application log sizes | `du -sh /var/log/* 2>/dev/null \| sort -rh \| head -20` | 🔵 Daily | Unexpected large log files |
| 122 | Syslog recent errors | `grep -iE 'error\|critical\|emerg' /var/log/syslog \| tail -30` | ⚪ Manual | Active incident investigation |

---

## 9. Docker (if present)

| # | Data point | Command | Frequency | Alert condition |
|---|-----------|---------|-----------|----------------|
| 123 | Docker daemon status | `systemctl is-active docker` | 🔴 30s | Daemon not active |
| 124 | Docker version | `docker version --format json` | ⚪ Manual | After upgrade |
| 125 | Running containers | `docker ps --format json` | 🔴 30s | Expected container stopped |
| 126 | All containers (incl. stopped) | `docker ps -a --format json` | 🟡 5 min | Ghost container appeared |
| 127 | Container resource usage | `docker stats --no-stream --format json` | 🔴 30s | CPU > 90% / MEM near limit |
| 128 | Container restart counts | `docker inspect --format '{{.Name}} {{.RestartCount}}' $(docker ps -q)` | 🔴 30s | Any increment = crash loop |
| 129 | Docker image list | `docker images --format json` | 🔵 Daily | Unexpected new image |
| 130 | Dangling images | `docker images -f dangling=true` | 🔵 Daily | Disk waste — trigger cleanup |
| 131 | Docker volume list | `docker volume ls` | 🔵 Daily | Orphaned volumes |
| 132 | Docker network list | `docker network ls` | ⚪ Manual | Networking issue investigation |
| 133 | Docker disk usage | `docker system df` | 🔵 Daily | Total image/volume/container bloat |
| 134 | Docker events (recent) | `docker events --since 1h --until now --format json` | 🟡 1 min | kill / die / OOM event |

---

## 10. Application-level (optional, per stack)

| # | Data point | Command | Frequency | Notes |
|---|-----------|---------|-----------|-------|
| 135 | Nginx active connections | `curl -s http://localhost/nginx_status` | 🟡 1 min | Requires stub_status module |
| 136 | HAProxy backend states | `echo 'show stat' \| socat stdio /var/run/haproxy/admin.sock` | 🟡 1 min | DOWN backend = alert |
| 137 | PostgreSQL connections | `psql -c "SELECT count(*) FROM pg_stat_activity;"` | 🟡 1 min | Near max_connections |
| 138 | MySQL / MariaDB status | `mysqladmin -u root status` | 🟡 1 min | Threads_running spike |
| 139 | Redis memory + hit rate | `redis-cli INFO all` | 🟡 1 min | used_memory near maxmemory |
| 140 | GitLab health | `curl -s https://gitlab.domain/health` | 🟡 1 min | Non-200 response |
| 141 | Proxmox cluster status | `pvecm status` | 🟡 2 min | Quorum loss = critical |
| 142 | Proxmox node status | `pvesh get /nodes/<node>/status` | 🟡 1 min | Resource thresholds |
| 143 | Proxmox VM list | `qm list` | 🟡 2 min | Unexpected stopped VM |
| 144 | Proxmox LXC list | `pct list` | 🟡 2 min | Unexpected stopped container |

---

## Summary by Frequency

### 🔴 Real-time (5–60s) — 26 checks
Core resource metrics that spike fast and need immediate alerting.

> Load average, per-core CPU, steal/iowait, available RAM, swap activity, disk I/O (bytes/await/util), interface errors/drops, RX/TX throughput, TCP connections + states, conntrack usage, process count, zombie count, failed systemd units, open FDs, Docker container state + resource usage + restart counts.

### 🟡 Periodic (1–15 min) — 37 checks
Slower-moving state requiring automated polling but not sub-minute latency.

> CPU temperature, top consumers, OOM events, disk fill rate, inode usage, I/O queue depth, ZFS/RAID/LVM health, listening port baseline, TCP retransmit rate, service restart counts, timers, FD per process, kernel error tail, auth failures, active sessions, sudo events, journal errors, Docker events.

### 🔵 Scheduled (hourly/daily) — 30 checks
Config drift detection, trending baselines, layout changes.

> Kernel version, sysctl values, routing table, ARP table, DNS config, MTU, mount options, log sizes, cron jobs, memory breakdown, LVM layout, dangling images, Docker volumes, pending reboot flag.

### ⚪ Manual (on-demand) — 22 checks
Expensive, verbose, or only meaningful during active investigation.

> Hardware inventory (BIOS, model, serial), CPU topology, SMART attributes, full dmesg, bond/LACP, full process snapshot, zombie details, socket/thread per process, slab memory, kernel modules, CPU vulnerability mitigations, SELinux status, full login history, Docker network details.

---

## Recommended Polling Stack

| Layer | Tool | Role |
|-------|------|------|
| Metrics collection | `node_exporter` | Exposes most of sections 1–8 as Prometheus metrics |
| Time-series storage | `Prometheus` | Stores polled metrics with retention |
| Dashboards | `Grafana` | Visualize all metrics with alert rules |
| Log shipping | `Promtail` + `Loki` | Ships journal/auth logs; replaces manual grep |
| Docker metrics | `cAdvisor` | Replaces manual `docker stats` polling |
| Custom scripts | `bash` + `cron` | For checks not covered by node_exporter (ZFS ARC hit rate, conntrack, per-user crons) |
| Alerting | `Alertmanager` | Threshold-based alerts routed to Slack/email/PagerDuty |

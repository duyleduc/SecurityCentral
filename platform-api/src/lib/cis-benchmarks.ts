/**
 * CIS Benchmark mapping for server hardening audit checks.
 *
 * Maps sc-agent audit check IDs to CIS Distribution Independent Linux
 * Benchmark v2.0 control numbers + CIS Docker Benchmark v1.6.
 *
 * Maintained server-side so updates don't require agent redeployment.
 */

export interface CisControl {
  readonly controlId: string;   // e.g. "1.5.2"
  readonly benchmark: string;   // "CIS Linux" | "CIS Docker"
  readonly title: string;       // official CIS control title
  readonly level: 1 | 2;       // CIS profile level
}

const CIS_MAP: ReadonlyMap<string, CisControl> = new Map([
  // ---------------------------------------------------------------------------
  // Kernel hardening
  // ---------------------------------------------------------------------------
  ['kernel.aslr', {
    controlId: '1.5.2', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure address space layout randomization (ASLR) is enabled',
  }],
  ['kernel.kptr_restrict', {
    controlId: '1.5.3', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure kernel pointer restriction is configured',
  }],
  ['kernel.dmesg_restrict', {
    controlId: '1.5.1', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure dmesg restriction is configured',
  }],
  ['kernel.core_dump', {
    controlId: '1.5.4', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure core dumps are restricted',
  }],
  ['kernel.ptrace_scope', {
    controlId: '1.5.5', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure ptrace scope is restricted',
  }],

  // ---------------------------------------------------------------------------
  // User audit
  // ---------------------------------------------------------------------------
  ['users.uid0', {
    controlId: '6.2.2', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure root is the only UID 0 account',
  }],
  ['users.empty_password', {
    controlId: '6.2.1', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure accounts in /etc/passwd use shadowed passwords',
  }],
  ['users.weak_hash', {
    controlId: '5.4.4', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure password hashing algorithm is SHA-512 or yescrypt',
  }],
  ['users.nopasswd_sudo', {
    controlId: '5.3.5', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure sudo authentication timeout is configured correctly',
  }],
  ['users.home_perms', {
    controlId: '6.2.6', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure users home directories permissions are 750 or more restrictive',
  }],

  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------
  ['fs.suid_binaries', {
    controlId: '6.1.13', benchmark: 'CIS Linux', level: 2,
    title: 'Audit SUID executables',
  }],
  ['fs.world_writable_etc', {
    controlId: '6.1.10', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure no world writable files exist',
  }],
  ['fs.tmp_executables', {
    controlId: '1.1.2.1', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure /tmp is a separate partition',
  }],
  ['fs.passwd_perms', {
    controlId: '6.1.2', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure permissions on /etc/passwd are configured',
  }],
  ['fs.shadow_perms', {
    controlId: '6.1.4', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure permissions on /etc/shadow are configured',
  }],

  // ---------------------------------------------------------------------------
  // Container runtime
  // ---------------------------------------------------------------------------
  ['container.docker_sock', {
    controlId: '3.15', benchmark: 'CIS Docker', level: 1,
    title: 'Ensure Docker socket file permissions are set to 660 or more restrictive',
  }],
  ['container.privileged', {
    controlId: '5.4', benchmark: 'CIS Docker', level: 1,
    title: 'Ensure privileged containers are not used',
  }],
  ['container.sock_mount', {
    controlId: '5.31', benchmark: 'CIS Docker', level: 1,
    title: 'Ensure Docker socket is not mounted inside any containers',
  }],

  // ---------------------------------------------------------------------------
  // SSH
  // ---------------------------------------------------------------------------
  ['ssh.weak_ciphers', {
    controlId: '5.2.13', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure only strong ciphers are used',
  }],
  ['ssh.weak_macs', {
    controlId: '5.2.14', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure only strong MAC algorithms are used',
  }],
  ['ssh.weak_kex', {
    controlId: '5.2.15', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure only strong Key Exchange algorithms are used',
  }],
  ['ssh.weak_hostkey', {
    controlId: '5.2.16', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure only strong host key algorithms are used',
  }],
  ['ssh.max_auth_tries', {
    controlId: '5.2.7', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure SSH MaxAuthTries is set to 4 or less',
  }],
  ['ssh.x11forwarding', {
    controlId: '5.2.6', benchmark: 'CIS Linux', level: 2,
    title: 'Ensure SSH X11 forwarding is disabled',
  }],
  ['ssh.tcp_forwarding', {
    controlId: '5.2.20', benchmark: 'CIS Linux', level: 2,
    title: 'Ensure SSH AllowTcpForwarding is disabled',
  }],

  // ---------------------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------------------
  ['svc.legacy_23', {
    controlId: '2.1.1', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure telnet server is not installed',
  }],
  ['svc.legacy_21', {
    controlId: '2.1.5', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure FTP server is not installed',
  }],
  ['svc.legacy_111', {
    controlId: '2.1.6', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure rpcbind is not installed',
  }],
  ['svc.snmp_community', {
    controlId: '2.2.18', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure SNMP server is not enabled or uses strong community strings',
  }],
  ['svc.nfs_root_squash', {
    controlId: '2.2.17', benchmark: 'CIS Linux', level: 1,
    title: 'Ensure NFS is configured securely with root_squash',
  }],
]);

/** Look up CIS control for an audit check ID. Returns null if no mapping exists. */
export function getCisControl(checkId: string): CisControl | null {
  return CIS_MAP.get(checkId) ?? null;
}

/** Enrich an array of audit results with CIS control metadata. */
export function enrichWithCis<T extends { id: string }>(
  results: readonly T[],
): Array<T & { cis: CisControl | null }> {
  return results.map((r) => ({ ...r, cis: getCisControl(r.id) }));
}

/** Get compliance summary: total mapped checks, passing, failing. */
export function cisSummary(
  results: ReadonlyArray<{ id: string; status: string }>,
): { total: number; mapped: number; passing: number; failing: number } {
  let mapped = 0, passing = 0, failing = 0;
  for (const r of results) {
    const cis = CIS_MAP.get(r.id);
    if (!cis) continue;
    mapped++;
    if (r.status === 'pass') passing++;
    else if (r.status === 'fail') failing++;
  }
  return { total: results.length, mapped, passing, failing };
}

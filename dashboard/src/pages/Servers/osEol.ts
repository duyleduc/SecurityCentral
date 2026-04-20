// Static end-of-life (regular support) dates for common Linux distributions.
// Sourced from https://endoflife.date — update periodically.
// Using a static map avoids runtime API calls and cost during dashboard render.

interface EolEntry {
  version: string;
  eol: string; // ISO date
  latest?: boolean; // true if this is the newest supported major
}

const EOL_TABLE: Record<string, EolEntry[]> = {
  debian: [
    { version: '9', eol: '2022-06-30' },
    { version: '10', eol: '2024-06-30' },
    { version: '11', eol: '2026-08-15' },
    { version: '12', eol: '2028-06-10' },
    { version: '13', eol: '2030-06-10', latest: true },
  ],
  ubuntu: [
    { version: '16.04', eol: '2021-04-30' },
    { version: '18.04', eol: '2023-05-31' },
    { version: '20.04', eol: '2025-05-29' },
    { version: '22.04', eol: '2027-06-01' },
    { version: '24.04', eol: '2029-05-31', latest: true },
  ],
  rhel: [
    { version: '7', eol: '2024-06-30' },
    { version: '8', eol: '2029-05-31' },
    { version: '9', eol: '2032-05-31', latest: true },
  ],
  centos: [
    { version: '7', eol: '2024-06-30' },
    { version: '8', eol: '2021-12-31' },
    { version: '9', eol: '2027-05-31', latest: true },
  ],
  rocky: [
    { version: '8', eol: '2029-05-31' },
    { version: '9', eol: '2032-05-31', latest: true },
  ],
  alma: [
    { version: '8', eol: '2029-03-01' },
    { version: '9', eol: '2032-05-31', latest: true },
  ],
  fedora: [
    { version: '38', eol: '2024-05-21' },
    { version: '39', eol: '2024-11-12' },
    { version: '40', eol: '2025-05-13' },
    { version: '41', eol: '2025-11-11', latest: true },
  ],
};

export type OsStatus = 'ok' | 'upgrade_available' | 'eol_soon' | 'eol';

export interface OsStatusInfo {
  status: OsStatus;
  message: string;
  entry?: EolEntry;
  latest?: EolEntry;
}

/**
 * Classify the OS status based on its family + version.
 * `osFamily` should be the distro id (debian, ubuntu, rhel, ...).
 * `osVersion` should be the major version number (or "major.minor" for Ubuntu).
 */
export function classifyOs(
  osFamily: string | null | undefined,
  osVersion: string | null | undefined,
  now: Date = new Date(),
): OsStatusInfo {
  if (!osFamily || !osVersion) {
    return { status: 'ok', message: '' };
  }

  const family = osFamily.toLowerCase();
  const table = EOL_TABLE[family];
  if (!table) {
    return { status: 'ok', message: '' };
  }

  // Try to match by major version prefix (debian "13.4" → "13").
  const major = osVersion.split('.')[0];
  const entry = table.find((e) => e.version === osVersion) ?? table.find((e) => e.version.split('.')[0] === major);
  if (!entry) {
    return { status: 'ok', message: '' };
  }

  const latest = table.find((e) => e.latest);
  const eolDate = new Date(entry.eol);
  const daysToEol = Math.floor((eolDate.getTime() - now.getTime()) / 86_400_000);

  if (daysToEol < 0) {
    return {
      status: 'eol',
      message: `${osFamily} ${osVersion} reached end of life on ${entry.eol}. No more security updates. Upgrade to ${latest?.version ?? 'a supported version'} immediately.`,
      entry,
      latest,
    };
  }

  if (daysToEol < 90) {
    return {
      status: 'eol_soon',
      message: `${osFamily} ${osVersion} reaches end of life on ${entry.eol} (${daysToEol} days). Plan upgrade to ${latest?.version ?? 'a newer version'}.`,
      entry,
      latest,
    };
  }

  if (latest && latest.version !== entry.version) {
    return {
      status: 'upgrade_available',
      message: `${osFamily} ${osVersion} is supported until ${entry.eol}, but a newer release (${latest.version}) is available.`,
      entry,
      latest,
    };
  }

  return {
    status: 'ok',
    message: `${osFamily} ${osVersion} is current and supported until ${entry.eol}.`,
    entry,
    latest,
  };
}

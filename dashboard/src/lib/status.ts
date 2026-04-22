/**
 * Status normalization — Phase 1 / Option C.
 *
 * The backend keeps its existing status strings ("online", "warning", "healthy", etc.).
 * The UI translates those into three orthogonal dimensions:
 *
 *   - Health:    healthy | at-risk | critical | unknown   (applies to any asset)
 *   - Op state:  up | down                                (is the asset reachable?)
 *   - Work:      new | in-progress | resolved | dismissed (task lifecycle for findings/invitations)
 *
 * Storage stays unchanged — only display translates through these helpers.
 */

export type Health = 'healthy' | 'at-risk' | 'critical' | 'unknown';
export type OpState = 'up' | 'down';
export type WorkState = 'new' | 'in-progress' | 'resolved' | 'dismissed';

/** Server backend status → health. */
export function healthFromServerStatus(status: string | null | undefined): Health {
  switch (status) {
    case 'online':
      return 'healthy';
    case 'warning':
      return 'at-risk';
    case 'critical':
      return 'critical';
    case 'offline':
    case 'dead':
    case 'pending_delete':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Server backend status → operational state. */
export function opStateFromServerStatus(status: string | null | undefined): OpState {
  switch (status) {
    case 'online':
    case 'warning':
    case 'critical':
      return 'up';
    case 'offline':
    case 'dead':
    case 'pending_delete':
      return 'down';
    default:
      return 'down';
  }
}

/** Domain/endpoint backend status → health. */
export function healthFromDomainStatus(status: string | null | undefined): Health {
  switch (status) {
    case 'healthy':
      return 'healthy';
    case 'degraded':
      return 'at-risk';
    case 'down':
      return 'critical';
    case 'pending':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Domain backend status → operational state. */
export function opStateFromDomainStatus(status: string | null | undefined): OpState {
  switch (status) {
    case 'healthy':
    case 'degraded':
      return 'up';
    case 'down':
    case 'pending':
      return 'down';
    default:
      return 'down';
  }
}

/** Finding backend status → work state. */
export function workStateFromFindingStatus(status: string | null | undefined): WorkState {
  switch (status) {
    case 'open':
      return 'new';
    case 'in_progress':
      return 'in-progress';
    case 'resolved':
      return 'resolved';
    case 'ignored':
      return 'dismissed';
    default:
      return 'new';
  }
}

// ---------------------------------------------------------------------------
// Shared display metadata — labels, colors, and MUI-aligned semantic colors.
// Components import from here so the same word and color is used everywhere.
// ---------------------------------------------------------------------------

export const HEALTH_LABELS: Record<Health, string> = {
  healthy: 'healthy',
  'at-risk': 'at-risk',
  critical: 'critical',
  unknown: 'unknown',
};

/** Map to MUI's `color` prop for Chip/Button/etc. */
export const HEALTH_MUI_COLOR: Record<Health, 'success' | 'warning' | 'error' | 'default'> = {
  healthy: 'success',
  'at-risk': 'warning',
  critical: 'error',
  unknown: 'default',
};

export const OP_STATE_LABELS: Record<OpState, string> = {
  up: 'up',
  down: 'down',
};

export const OP_STATE_MUI_COLOR: Record<OpState, 'success' | 'default'> = {
  up: 'success',
  down: 'default',
};

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  new: 'new',
  'in-progress': 'in-progress',
  resolved: 'resolved',
  dismissed: 'dismissed',
};

export const WORK_STATE_MUI_COLOR: Record<WorkState, 'default' | 'warning' | 'success'> = {
  new: 'default',
  'in-progress': 'warning',
  resolved: 'success',
  dismissed: 'default',
};

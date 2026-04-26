/**
 * Slack notification channel — uses incoming webhooks (no Slack app required).
 * User configures: { webhookUrl: "https://hooks.slack.com/services/..." }
 */

import { logger } from '../logger.js';
import type { NotificationPayload, SlackConfig } from './dispatcher.js';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':rotating_light:',
  high: ':warning:',
  medium: ':large_yellow_circle:',
  low: ':white_check_mark:',
  info: ':information_source:',
};

export async function sendSlackWebhook(payload: NotificationPayload, config: SlackConfig): Promise<void> {
  const severity = payload.severity ?? 'info';
  const emoji = SEVERITY_EMOJI[severity] ?? ':information_source:';
  const color = SEVERITY_COLORS[severity] ?? '#2563eb';

  // Use Slack attachments for color sidebar.
  const body = {
    text: `${emoji} *${payload.title}*`,
    attachments: [{
      color,
      fields: [
        { title: 'Event', value: payload.event, short: true },
        { title: 'Severity', value: severity.toUpperCase(), short: true },
        ...(payload.description ? [{ title: 'Details', value: payload.description.slice(0, 1500), short: false }] : []),
      ],
      ...(payload.url ? { actions: [{ type: 'button', text: 'View in dashboard', url: payload.url }] } : {}),
      footer: 'SecurityCentral',
      ts: Math.floor(Date.now() / 1000),
    }],
  };

  const resp = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Slack webhook ${resp.status}: ${text}`);
  }

  logger.info('Slack notification sent', { orgId: payload.orgId, event: payload.event });
}

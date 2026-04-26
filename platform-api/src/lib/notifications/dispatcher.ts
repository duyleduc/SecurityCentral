/**
 * Notification dispatcher
 *
 * Central fan-out for security events. Fired by the WebSocket hooks layer
 * (ws/hooks.ts) — every emitX() in that file should also call dispatch().
 *
 * Looks up org's enabled notification preferences and sends to each channel.
 * Per-channel delivery is best-effort — one failed channel does not block others.
 */

import { prisma } from '../prisma.js';
import { logger } from '../logger.js';
import { sendNotificationEmail } from './email.js';
import { sendSlackWebhook } from './slack.js';
import { sendGenericWebhook } from './webhook.js';

export type NotificationEvent =
  | 'finding:new'
  | 'finding:resolved'
  | 'scan:completed'
  | 'agent:connected'
  | 'agent:disconnected'
  | 'cert:expiring'
  | 'brute_force:active'
  | 'cve:critical';

export interface NotificationPayload {
  readonly orgId: string;
  readonly event: NotificationEvent;
  readonly title: string;       // human-readable summary
  readonly description?: string; // longer text for email body
  readonly severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly url?: string;         // dashboard link
  readonly data?: Record<string, unknown>; // raw payload for webhook
}

/**
 * Channel-specific config stored in NotificationPreference.config.
 * The dispatcher reads these and passes to the channel handler.
 */
export interface SlackConfig { webhookUrl: string; minSeverity?: string; }
export interface WebhookConfig { url: string; secret?: string; minSeverity?: string; }
export interface EmailConfig { recipients?: string[]; minSeverity?: string; } // recipients optional → org admins

const SEVERITY_ORDER: Record<string, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

function meetsMinSeverity(severity: string | undefined, minSeverity: string | undefined): boolean {
  if (!minSeverity) return true;
  if (!severity) return false;
  return (SEVERITY_ORDER[severity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0);
}

/**
 * Dispatch a notification to all enabled channels for the org.
 * Non-blocking: failures are logged but don't throw.
 */
export async function dispatch(payload: NotificationPayload): Promise<void> {
  try {
    const prefs = await prisma.notificationPreference.findMany({
      where: { orgId: payload.orgId, eventType: payload.event, enabled: true },
    });

    if (prefs.length === 0) return;

    await Promise.all(prefs.map(async (pref) => {
      try {
        const config = (pref.config ?? {}) as Record<string, unknown>;

        switch (pref.channel) {
          case 'email': {
            const cfg = config as unknown as EmailConfig;
            if (!meetsMinSeverity(payload.severity, cfg.minSeverity)) return;
            await sendNotificationEmail(payload, cfg);
            break;
          }
          case 'slack': {
            const cfg = config as unknown as SlackConfig;
            if (!cfg.webhookUrl) return;
            if (!meetsMinSeverity(payload.severity, cfg.minSeverity)) return;
            await sendSlackWebhook(payload, cfg);
            break;
          }
          case 'webhook': {
            const cfg = config as unknown as WebhookConfig;
            if (!cfg.url) return;
            if (!meetsMinSeverity(payload.severity, cfg.minSeverity)) return;
            await sendGenericWebhook(payload, cfg);
            break;
          }
        }
      } catch (err) {
        logger.error('Notification delivery failed', {
          channel: pref.channel,
          event: payload.event,
          error: (err as Error).message,
        });
      }
    }));
  } catch (err) {
    logger.error('Notification dispatch error', { error: (err as Error).message });
  }
}

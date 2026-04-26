/**
 * Generic webhook channel — POSTs JSON to a user-configured URL.
 * Includes HMAC-SHA256 signature header for receiver verification.
 */

import crypto from 'node:crypto';

import { logger } from '../logger.js';
import type { NotificationPayload, WebhookConfig } from './dispatcher.js';

export async function sendGenericWebhook(payload: NotificationPayload, config: WebhookConfig): Promise<void> {
  const body = JSON.stringify({
    event: payload.event,
    severity: payload.severity ?? 'info',
    title: payload.title,
    description: payload.description ?? null,
    url: payload.url ?? null,
    data: payload.data ?? null,
    timestamp: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SecurityCentral/1.0',
    'X-SC-Event': payload.event,
  };

  // HMAC signature for receiver verification.
  if (config.secret) {
    const sig = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
    headers['X-SC-Signature'] = `sha256=${sig}`;
  }

  const resp = await fetch(config.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Webhook ${resp.status}: ${text.slice(0, 200)}`);
  }

  logger.info('Webhook notification sent', { orgId: payload.orgId, event: payload.event, url: config.url });
}

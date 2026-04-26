/**
 * Email notification channel — uses the existing nodemailer transport.
 * If recipients aren't specified in config, falls back to org owner + admins.
 */

import { prisma } from '../prisma.js';
import { logger } from '../logger.js';
import { isMailEnabled, getNotificationTransport, getFromHeader } from '../mailer-shared.js';
import type { NotificationPayload, EmailConfig } from './dispatcher.js';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function resolveRecipients(orgId: string, config: EmailConfig): Promise<string[]> {
  if (config.recipients && config.recipients.length > 0) return config.recipients;

  // Fall back to owners + admins.
  const members = await prisma.user.findMany({
    where: { orgId, role: { in: ['owner', 'admin'] } },
    select: { email: true },
  });
  return members.map((m) => m.email);
}

function renderHtml(payload: NotificationPayload): string {
  const color = SEVERITY_COLORS[payload.severity ?? 'info'];
  const severityLabel = payload.severity ? payload.severity.toUpperCase() : 'INFO';
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fa;margin:0;padding:32px;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:${color};color:#fff;padding:16px 24px;font-weight:600;">
      ${severityLabel} · ${escapeHtml(payload.event)}
    </td></tr>
    <tr><td style="padding:24px;">
      <h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(payload.title)}</h2>
      ${payload.description ? `<p style="margin:0 0 16px;color:#4b5563;line-height:1.5;white-space:pre-wrap;">${escapeHtml(payload.description)}</p>` : ''}
      ${payload.url ? `<p style="margin:0 0 16px;"><a href="${payload.url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;display:inline-block;">View in dashboard</a></p>` : ''}
      <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px;">
        SecurityCentral · ${new Date().toUTCString()}
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(payload: NotificationPayload): string {
  const lines = [
    `[${(payload.severity ?? 'info').toUpperCase()}] ${payload.event}`,
    '',
    payload.title,
  ];
  if (payload.description) lines.push('', payload.description);
  if (payload.url) lines.push('', payload.url);
  return lines.join('\n');
}

export async function sendNotificationEmail(payload: NotificationPayload, config: EmailConfig): Promise<void> {
  if (!isMailEnabled()) {
    logger.debug('Email channel skipped — SMTP not configured', { orgId: payload.orgId });
    return;
  }

  const recipients = await resolveRecipients(payload.orgId, config);
  if (recipients.length === 0) {
    logger.warn('No email recipients for notification', { orgId: payload.orgId });
    return;
  }

  const tx = getNotificationTransport();
  if (!tx) return;

  await tx.sendMail({
    from: getFromHeader(),
    to: recipients,
    subject: `[SecurityCentral] ${payload.title}`,
    html: renderHtml(payload),
    text: renderText(payload),
  });

  logger.info('Notification email sent', { orgId: payload.orgId, event: payload.event, recipients: recipients.length });
}

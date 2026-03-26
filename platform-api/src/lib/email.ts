import { prisma } from './prisma.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'email' });

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'noreply@securitycentral.io';

// ---------------------------------------------------------------------------
// Daily digest data aggregation
// ---------------------------------------------------------------------------

export interface DigestData {
  readonly orgId: string;
  readonly orgName: string;
  readonly period: string;
  readonly findings: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly total: number;
  };
  readonly expiringCerts: number;
  readonly offlineAgents: number;
}

export async function aggregateDigest(orgId: string): Promise<DigestData> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });

  // New findings in last 24h
  const findingCounts = await prisma.finding.groupBy({
    by: ['severity'],
    where: { orgId, createdAt: { gte: since } },
    _count: { id: true },
  });

  const counts: Record<string, number> = {};
  for (const g of findingCounts) {
    counts[g.severity] = g._count.id;
  }

  // Certs expiring in 30 days
  const expiringCerts = await prisma.certificate.count({
    where: {
      orgId,
      notAfter: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      status: { in: ['active', 'expiring'] },
    },
  });

  // Offline agents
  const offlineAgents = await prisma.server.count({
    where: { orgId, status: 'inactive' },
  });

  return {
    orgId,
    orgName: org?.name ?? 'Unknown',
    period: since.toISOString().split('T')[0],
    findings: {
      critical: counts['critical'] ?? 0,
      high: counts['high'] ?? 0,
      medium: counts['medium'] ?? 0,
      low: counts['low'] ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    expiringCerts,
    offlineAgents,
  };
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------

export function renderDigestHtml(data: DigestData): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SecurityCentral Daily Digest</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a1a2e; color: #fff; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 20px;">SecurityCentral Daily Digest</h1>
      <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">${data.orgName} — ${data.period}</p>
    </div>

    <div style="padding: 24px;">
      <h2 style="font-size: 16px; margin: 0 0 16px; color: #333;">New Findings (Last 24h)</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 12px; background: #dc2626; color: #fff; border-radius: 4px 0 0 0; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${data.findings.critical}</div>
            <div style="font-size: 12px;">Critical</div>
          </td>
          <td style="padding: 8px 12px; background: #ea580c; color: #fff; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${data.findings.high}</div>
            <div style="font-size: 12px;">High</div>
          </td>
          <td style="padding: 8px 12px; background: #ca8a04; color: #fff; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${data.findings.medium}</div>
            <div style="font-size: 12px;">Medium</div>
          </td>
          <td style="padding: 8px 12px; background: #2563eb; color: #fff; border-radius: 0 4px 0 0; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${data.findings.low}</div>
            <div style="font-size: 12px;">Low</div>
          </td>
        </tr>
      </table>

      ${data.expiringCerts > 0 ? `
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 16px; border-radius: 0 4px 4px 0;">
        <strong>⚠️ ${data.expiringCerts} certificate(s)</strong> expiring within 30 days
      </div>` : ''}

      ${data.offlineAgents > 0 ? `
      <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 16px; border-radius: 0 4px 4px 0;">
        <strong>🔴 ${data.offlineAgents} agent(s)</strong> currently offline
      </div>` : ''}

      <div style="text-align: center; margin-top: 24px;">
        <a href="https://app.securitycentral.io/dashboard" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Dashboard</a>
      </div>
    </div>

    <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #666;">
      SecurityCentral — Unified Security Platform<br>
      <a href="https://app.securitycentral.io/settings/notifications" style="color: #2563eb;">Manage notification preferences</a>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Send email via AWS SES (or log in dev)
// ---------------------------------------------------------------------------

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  // In production, use AWS SES SDK
  // For MVP, log the email
  if (process.env.NODE_ENV === 'production' && process.env.AWS_REGION) {
    try {
      const resp = await fetch(`https://email.${process.env.AWS_REGION}.amazonaws.com/v2/email/outbound-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FromEmailAddress: SES_FROM_EMAIL,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject },
              Body: { Html: { Data: html } },
            },
          },
        }),
      });
      return resp.ok;
    } catch (err) {
      log.error('SES send failed', { to, error: (err as Error).message });
      return false;
    }
  }

  log.info('Email (dev mode)', { to, subject, length: html.length });
  return true;
}

// ---------------------------------------------------------------------------
// Daily digest job processor
// ---------------------------------------------------------------------------

export async function processDailyDigest(orgId: string): Promise<number> {
  const digest = await aggregateDigest(orgId);

  if (digest.findings.total === 0 && digest.expiringCerts === 0 && digest.offlineAgents === 0) {
    log.debug('Empty digest, skipping', { orgId });
    return 0;
  }

  // Get users with email digest enabled
  const users = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, email: true },
  });

  const html = renderDigestHtml(digest);
  const subject = `SecurityCentral Digest: ${digest.findings.total} new findings — ${digest.period}`;

  let sent = 0;
  for (const user of users) {
    // Check email preference
    const pref = await prisma.notificationPreference.findFirst({
      where: { userId: user.id, channel: 'email', eventType: 'critical_finding', enabled: true },
    });

    if (!pref) continue;

    const ok = await sendEmail(user.email, subject, html);
    if (ok) sent++;
  }

  log.info('Daily digest sent', { orgId, recipients: sent });
  return sent;
}

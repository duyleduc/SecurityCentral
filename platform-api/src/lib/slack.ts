import { prisma } from './prisma.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'slack' });

// ---------------------------------------------------------------------------
// Slack Block Kit message templates
// ---------------------------------------------------------------------------

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string; style?: string }>;
  accessory?: unknown;
}

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function fields(...pairs: string[]): SlackBlock {
  return {
    type: 'section',
    fields: pairs.map((p) => ({ type: 'mrkdwn', text: p })),
  };
}

function actions(buttons: Array<{ text: string; url: string; style?: string }>): SlackBlock {
  return {
    type: 'actions',
    elements: buttons.map((b) => ({
      type: 'button',
      text: { type: 'plain_text', text: b.text },
      url: b.url,
      ...(b.style ? { style: b.style } : {}),
    })),
  };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

// ---------------------------------------------------------------------------
// T-9.3.3: Message templates
// ---------------------------------------------------------------------------

export function criticalFindingMessage(data: {
  cveId: string;
  severity: string;
  title: string;
  packageName?: string;
  asset?: string;
  cvssScore?: number;
  dashboardUrl: string;
}): SlackBlock[] {
  const emoji = data.severity === 'critical' ? '🔴' : '🟠';
  return [
    header(`${emoji} ${data.severity.toUpperCase()} Security Finding`),
    section(`*${data.title}*`),
    fields(
      `*CVE:*\n${data.cveId || 'N/A'}`,
      `*Severity:*\n${data.severity}`,
      `*CVSS:*\n${data.cvssScore ?? 'N/A'}`,
      `*Asset:*\n${data.asset || 'N/A'}`,
    ),
    divider(),
    actions([{ text: 'View Finding', url: data.dashboardUrl, style: 'danger' }]),
  ];
}

export function scanCompletedMessage(data: {
  scanType: string;
  asset: string;
  total: number;
  newFindings: number;
  resolved: number;
  duration: string;
  dashboardUrl: string;
}): SlackBlock[] {
  return [
    header('✅ Scan Completed'),
    section(`*${data.scanType}* scan on *${data.asset}*`),
    fields(
      `*Total Findings:*\n${data.total}`,
      `*New:*\n${data.newFindings}`,
      `*Resolved:*\n${data.resolved}`,
      `*Duration:*\n${data.duration}`,
    ),
    divider(),
    actions([{ text: 'View Results', url: data.dashboardUrl }]),
  ];
}

export function certExpiryMessage(data: {
  subjectCn: string;
  daysRemaining: number;
  notAfter: string;
  dashboardUrl: string;
}): SlackBlock[] {
  const emoji = data.daysRemaining <= 7 ? '🔴' : data.daysRemaining <= 30 ? '🟠' : '🟡';
  return [
    header(`${emoji} Certificate Expiring`),
    section(`*${data.subjectCn}* expires in *${data.daysRemaining} days*`),
    fields(
      `*Subject:*\n${data.subjectCn}`,
      `*Expires:*\n${data.notAfter}`,
    ),
    divider(),
    actions([{ text: 'View Certificate', url: data.dashboardUrl }]),
  ];
}

export function agentOfflineMessage(data: {
  hostname: string;
  lastSeen: string;
  dashboardUrl: string;
}): SlackBlock[] {
  return [
    header('⚠️ Agent Offline'),
    section(`Agent on *${data.hostname}* has not sent a heartbeat`),
    fields(
      `*Hostname:*\n${data.hostname}`,
      `*Last Seen:*\n${data.lastSeen}`,
    ),
    divider(),
    actions([{ text: 'View Server', url: data.dashboardUrl }]),
  ];
}

// ---------------------------------------------------------------------------
// T-9.3.2: Webhook sender
// ---------------------------------------------------------------------------

export async function sendSlackMessage(webhookUrl: string, blocks: SlackBlock[], text: string): Promise<boolean> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });

    if (!resp.ok) {
      log.error('Slack webhook failed', { status: resp.status, body: await resp.text() });
      return false;
    }

    return true;
  } catch (err) {
    log.error('Slack webhook error', { error: (err as Error).message });
    return false;
  }
}

/**
 * Send a Slack notification to all active Slack integrations for an org.
 */
export async function notifyOrg(orgId: string, blocks: SlackBlock[], fallbackText: string): Promise<number> {
  const integrations = await prisma.integration.findMany({
    where: { orgId, provider: 'slack', status: 'active' },
  });

  let sent = 0;
  for (const integration of integrations) {
    const config = integration.config as Record<string, string>;
    const webhookUrl = config.webhook_url;
    if (!webhookUrl) continue;

    const success = await sendSlackMessage(webhookUrl, blocks, fallbackText);
    if (success) sent++;
  }

  return sent;
}

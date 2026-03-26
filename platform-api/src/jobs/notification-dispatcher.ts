import type { Job } from 'bullmq';

import { prisma } from '../lib/prisma.js';
import { jobLogger } from '../lib/logger.js';
import {
  criticalFindingMessage,
  scanCompletedMessage,
  certExpiryMessage,
  agentOfflineMessage,
  notifyOrg,
} from '../lib/slack.js';
import type { JobContext } from './context.js';

export type NotificationEventType = 'critical_finding' | 'scan_complete' | 'cert_expiry' | 'agent_offline';

export interface NotificationJobData extends JobContext {
  orgId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
}

/**
 * BullMQ processor: routes notification events to appropriate channels
 * based on org integration settings and user preferences.
 */
export async function processNotification(job: Job<NotificationJobData>): Promise<void> {
  const { orgId, eventType, payload, request_id } = job.data;
  const log = jobLogger(job.queueName, job.id ?? 'unknown', request_id);

  log.info('Processing notification', { orgId, eventType });

  // Check if any users have this event type enabled for slack
  const prefs = await prisma.notificationPreference.findMany({
    where: { user: { orgId }, eventType, channel: 'slack', enabled: true },
  });

  if (prefs.length === 0) {
    log.debug('No users with slack notifications enabled for event', { eventType });
    // Still send if it's a critical event — org-level notification
    if (eventType !== 'critical_finding' && eventType !== 'agent_offline') {
      return;
    }
  }

  // Build Slack message based on event type
  const dashboardBase = 'https://app.securitycentral.io';
  let blocks;
  let fallbackText: string;

  switch (eventType) {
    case 'critical_finding':
      blocks = criticalFindingMessage({
        cveId: (payload.cveId as string) ?? '',
        severity: (payload.severity as string) ?? 'critical',
        title: (payload.title as string) ?? 'Security Finding',
        packageName: payload.packageName as string,
        asset: payload.asset as string,
        cvssScore: payload.cvssScore as number,
        dashboardUrl: `${dashboardBase}/findings/${payload.findingId ?? ''}`,
      });
      fallbackText = `Critical finding: ${payload.title ?? 'New vulnerability detected'}`;
      break;

    case 'scan_complete':
      blocks = scanCompletedMessage({
        scanType: (payload.scanType as string) ?? 'scan',
        asset: (payload.asset as string) ?? 'unknown',
        total: (payload.total as number) ?? 0,
        newFindings: (payload.newFindings as number) ?? 0,
        resolved: (payload.resolved as number) ?? 0,
        duration: (payload.duration as string) ?? 'N/A',
        dashboardUrl: `${dashboardBase}/scans/${payload.scanId ?? ''}`,
      });
      fallbackText = `Scan completed: ${payload.newFindings ?? 0} new findings`;
      break;

    case 'cert_expiry':
      blocks = certExpiryMessage({
        subjectCn: (payload.subjectCn as string) ?? '',
        daysRemaining: (payload.daysRemaining as number) ?? 0,
        notAfter: (payload.notAfter as string) ?? '',
        dashboardUrl: `${dashboardBase}/certificates/${payload.certificateId ?? ''}`,
      });
      fallbackText = `Certificate expiring: ${payload.subjectCn}`;
      break;

    case 'agent_offline':
      blocks = agentOfflineMessage({
        hostname: (payload.hostname as string) ?? '',
        lastSeen: (payload.lastSeen as string) ?? '',
        dashboardUrl: `${dashboardBase}/servers/${payload.serverId ?? ''}`,
      });
      fallbackText = `Agent offline: ${payload.hostname}`;
      break;

    default:
      log.warn('Unknown notification event type', { eventType });
      return;
  }

  const sent = await notifyOrg(orgId, blocks, fallbackText);
  log.info('Notification sent', { orgId, eventType, channelsSent: sent });
}

/**
 * Create default notification preferences for a new user.
 * Enables critical_finding and agent_offline on all channels.
 */
export async function createDefaultPreferences(userId: string): Promise<void> {
  const defaults: Array<{ channel: string; eventType: string; enabled: boolean }> = [
    { channel: 'slack', eventType: 'critical_finding', enabled: true },
    { channel: 'slack', eventType: 'agent_offline', enabled: true },
    { channel: 'slack', eventType: 'scan_complete', enabled: false },
    { channel: 'slack', eventType: 'cert_expiry', enabled: true },
    { channel: 'email', eventType: 'critical_finding', enabled: true },
    { channel: 'email', eventType: 'agent_offline', enabled: true },
    { channel: 'email', eventType: 'scan_complete', enabled: false },
    { channel: 'email', eventType: 'cert_expiry', enabled: true },
  ];

  for (const pref of defaults) {
    await prisma.notificationPreference.upsert({
      where: {
        userId_channel_eventType: {
          userId,
          channel: pref.channel,
          eventType: pref.eventType,
        },
      },
      create: { userId, ...pref },
      update: {},
    });
  }
}

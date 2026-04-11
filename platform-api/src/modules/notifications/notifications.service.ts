import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

const EVENT_TYPES = [
  'finding:new',
  'finding:resolved',
  'scan:completed',
  'agent:connected',
  'agent:disconnected',
  'cert:expiring',
] as const;

const CHANNELS = ['email', 'slack', 'webhook'] as const;

export async function list(orgId: string) {
  return prisma.notificationPreference.findMany({
    where: { orgId },
    orderBy: [{ channel: 'asc' }, { eventType: 'asc' }],
  });
}

export async function upsert(orgId: string, channel: string, eventType: string, enabled: boolean, config?: unknown) {
  if (!CHANNELS.includes(channel as any)) {
    throw new AppError('VALIDATION_ERROR', `Invalid channel: ${channel}`);
  }
  if (!EVENT_TYPES.includes(eventType as any)) {
    throw new AppError('VALIDATION_ERROR', `Invalid event type: ${eventType}`);
  }

  return prisma.notificationPreference.upsert({
    where: { orgId_channel_eventType: { orgId, channel, eventType } },
    create: { orgId, channel, eventType, enabled, config: config ? JSON.parse(JSON.stringify(config)) : undefined },
    update: { enabled, config: config ? JSON.parse(JSON.stringify(config)) : undefined },
  });
}

export async function remove(orgId: string, id: string) {
  const existing = await prisma.notificationPreference.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Notification preference not found');
  }
  await prisma.notificationPreference.delete({ where: { id } });
}

export function getEventTypes() {
  return EVENT_TYPES;
}

export function getChannels() {
  return CHANNELS;
}

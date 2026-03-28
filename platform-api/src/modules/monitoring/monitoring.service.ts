import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { domainMonitoringQueue } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import type { AddEndpointsInput, UpdateEndpointInput, ListEndpointsQueryType } from './monitoring.validation.js';

const log = logger.child({ component: 'monitoring' });

// ---------------------------------------------------------------------------
// Add endpoints
// ---------------------------------------------------------------------------

export async function addEndpoints(orgId: string, input: AddEndpointsInput) {
  const created: string[] = [];
  const errors: string[] = [];

  for (const ep of input.endpoints) {
    try {
      // Strip protocol prefix if user pasted a URL
      const cleanHost = ep.host
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')   // remove path
        .replace(/:(\d+)$/, ''); // remove port suffix (already in ep.port)

      const record = await prisma.monitoredEndpoint.create({
        data: {
          orgId,
          host: cleanHost,
          port: ep.port,
          label: ep.label ?? null,
          tags: ep.tags ?? {},
          checkInterval: input.checkInterval,
          status: 'active',
          projectId: input.projectId ?? null,
        },
      });
      created.push(record.id);

      // Enqueue initial check
      await domainMonitoringQueue.add('check-endpoint', {
        endpointId: record.id,
        host: cleanHost,
        port: ep.port,
        orgId,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        errors.push(`${ep.host}:${ep.port} already monitored`);
      } else {
        errors.push(`${ep.host}:${ep.port}: ${(err as Error).message}`);
      }
    }
  }

  log.info('Endpoints added', { orgId, created: created.length, errors: errors.length });
  return { created: created.length, errors };
}

// ---------------------------------------------------------------------------
// List endpoints
// ---------------------------------------------------------------------------

export async function listEndpoints(orgId: string, query: ListEndpointsQueryType) {
  const { page, per_page } = query;
  const skip = (page - 1) * per_page;

  const where: Record<string, unknown> = { orgId };
  if (query.status) where.status = query.status;
  if (query.projectId) where.projectId = query.projectId;

  // Tag filter: "env" (key exists) or "env:prod" (key=value)
  if (query.tag) {
    const [tagKey, tagValue] = query.tag.split(':');
    if (tagValue) {
      where.tags = { path: [tagKey], equals: tagValue };
    } else {
      where.tags = { path: [tagKey], not: null as any };
    }
  }

  const [data, total] = await Promise.all([
    prisma.monitoredEndpoint.findMany({
      where: where as any,
      skip,
      take: per_page,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.monitoredEndpoint.count({ where: where as any }),
  ]);

  return { data, meta: { page, per_page, total } };
}

// ---------------------------------------------------------------------------
// Update endpoint (label, tags, interval)
// ---------------------------------------------------------------------------

export async function updateEndpoint(orgId: string, endpointId: string, input: UpdateEndpointInput) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({
    where: { id: endpointId, orgId },
  });
  if (!endpoint) throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');

  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.checkInterval !== undefined) data.checkInterval = input.checkInterval;
  if (input.tags !== undefined) data.tags = input.tags;

  return prisma.monitoredEndpoint.update({ where: { id: endpointId }, data });
}

// ---------------------------------------------------------------------------
// Remove endpoint
// ---------------------------------------------------------------------------

export async function removeEndpoint(orgId: string, endpointId: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({
    where: { id: endpointId, orgId },
  });

  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  await prisma.monitoredEndpoint.delete({ where: { id: endpointId } });
  log.info('Endpoint removed', { orgId, endpointId, host: endpoint.host });
}

// ---------------------------------------------------------------------------
// Trigger immediate check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Get endpoint detail with uptime stats
// ---------------------------------------------------------------------------

export async function getEndpointDetail(orgId: string, endpointId: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({
    where: { id: endpointId, orgId },
  });
  if (!endpoint) throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');

  // Last 90 heartbeats for the beat bar
  const heartbeats = await prisma.endpointHeartbeat.findMany({
    where: { endpointId },
    orderBy: { createdAt: 'desc' },
    take: 90,
    select: { id: true, status: true, statusCode: true, responseMs: true, message: true, certDaysLeft: true, createdAt: true },
  });

  // Uptime stats: 24h, 7d, 30d
  const now = new Date();
  const periods = [
    { label: '24h', since: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    { label: '7d', since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    { label: '30d', since: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
  ];

  const uptime: Record<string, { total: number; up: number; pct: number; avgResponseMs: number }> = {};

  for (const p of periods) {
    const beats = await prisma.endpointHeartbeat.findMany({
      where: { endpointId, createdAt: { gte: p.since } },
      select: { status: true, responseMs: true },
    });
    const total = beats.length;
    const up = beats.filter((b) => b.status === 'up').length;
    const avgMs = total > 0 ? Math.round(beats.reduce((s, b) => s + b.responseMs, 0) / total) : 0;
    uptime[p.label] = { total, up, pct: total > 0 ? Math.round((up / total) * 10000) / 100 : 0, avgResponseMs: avgMs };
  }

  // Response time history: last 50 heartbeats for chart
  const responseHistory = heartbeats
    .slice(0, 50)
    .reverse()
    .map((h) => ({ time: h.createdAt, ms: h.responseMs, status: h.status }));

  return { ...endpoint, heartbeats: heartbeats.reverse(), uptime, responseHistory };
}

// ---------------------------------------------------------------------------
// Trigger immediate check
// ---------------------------------------------------------------------------

export async function triggerCheck(orgId: string, endpointId: string) {
  const endpoint = await prisma.monitoredEndpoint.findFirst({
    where: { id: endpointId, orgId },
  });

  if (!endpoint) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Endpoint not found');
  }

  await domainMonitoringQueue.add('check-endpoint', {
    endpointId: endpoint.id,
    host: endpoint.host,
    port: endpoint.port,
    orgId,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    priority: 1, // high priority for manual triggers
  });

  return { queued: true, endpointId: endpoint.id };
}

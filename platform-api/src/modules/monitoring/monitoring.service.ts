import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { domainMonitoringQueue } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import type { AddEndpointsInput, ListEndpointsQueryType } from './monitoring.validation.js';

const log = logger.child({ component: 'monitoring' });

// ---------------------------------------------------------------------------
// Add endpoints
// ---------------------------------------------------------------------------

export async function addEndpoints(orgId: string, input: AddEndpointsInput) {
  const created: string[] = [];
  const errors: string[] = [];

  for (const ep of input.endpoints) {
    try {
      const record = await prisma.monitoredEndpoint.create({
        data: {
          orgId,
          host: ep.host,
          port: ep.port,
          label: ep.label ?? null,
          checkInterval: input.checkInterval,
          status: 'active',
        },
      });
      created.push(record.id);

      // Enqueue initial check
      await domainMonitoringQueue.add('check-endpoint', {
        endpointId: record.id,
        host: ep.host,
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

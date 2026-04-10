import { Router } from 'express';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../lib/env.js';
import { successEnvelope } from '../../middleware/errors.js';
import { broadcastToOrg } from '../../ws/server.js';

export const monitorRouter = Router();

// ---------------------------------------------------------------------------
// GET /v1/monitor/endpoints — list endpoints due for uptime check
// Called by sc-monitor binary (authenticated via X-API-Key)
// ---------------------------------------------------------------------------

monitorRouter.get('/endpoints', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || apiKey !== env.SC_MONITOR_API_KEY) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const now = new Date();
    logger.debug('[monitor] polling due endpoints');
    const dueEndpoints = await prisma.monitoredEndpoint.findMany({
      where: {
        nextCheckAt: { lte: now },
      },
      select: {
        id: true,
        orgId: true,
        host: true,
        port: true,
        protocol: true,
        uptimeInterval: true,
        uptimeTimeout: true,
      },
      take: 100,
      orderBy: { nextCheckAt: 'asc' },
    });

    if (dueEndpoints.length > 0) {
      logger.info('[monitor] returning due endpoints', { count: dueEndpoints.length });
    }
    res.json(successEnvelope(dueEndpoints));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /v1/monitor/heartbeats — batch ingest heartbeat results
// Called by sc-monitor binary after performing checks
// ---------------------------------------------------------------------------

interface HeartbeatPayload {
  endpointId: string;
  isUp: boolean;
  statusCode?: number;
  responseMs: number;
  error?: string;
}

monitorRouter.post('/heartbeats', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || apiKey !== env.SC_MONITOR_API_KEY) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const heartbeats: HeartbeatPayload[] = req.body.heartbeats ?? [];
    logger.info('[monitor] received heartbeats', { count: heartbeats.length });
    if (heartbeats.length === 0) {
      return res.json(successEnvelope({ processed: 0 }));
    }

    let processed = 0;

    for (const hb of heartbeats) {
      try {
        const endpoint = await prisma.monitoredEndpoint.findUnique({
          where: { id: hb.endpointId },
          select: { id: true, orgId: true, uptimeInterval: true, status: true },
        });
        if (!endpoint) continue;

        const now = new Date();
        const nextCheckAt = new Date(now.getTime() + endpoint.uptimeInterval * 1000);
        const newStatus = hb.isUp ? 'healthy' : 'down';

        await prisma.$transaction([
          prisma.endpointHeartbeat.create({
            data: {
              endpointId: hb.endpointId,
              isUp: hb.isUp,
              statusCode: hb.statusCode ?? null,
              responseMs: hb.responseMs,
              error: hb.error ?? null,
            },
          }),
          prisma.monitoredEndpoint.update({
            where: { id: hb.endpointId },
            data: {
              status: newStatus,
              lastCheckAt: now,
              nextCheckAt,
            },
          }),
        ]);

        logger.debug('[monitor] heartbeat stored', { endpointId: hb.endpointId, isUp: hb.isUp, responseMs: hb.responseMs, status: newStatus });

        // Broadcast via Socket.IO to org room
        broadcastToOrg(endpoint.orgId, 'heartbeat', {
          endpointId: hb.endpointId,
          isUp: hb.isUp,
          statusCode: hb.statusCode,
          responseMs: hb.responseMs,
          error: hb.error,
          status: newStatus,
          timestamp: now.toISOString(),
        });

        // Broadcast status change event if status flipped
        if (endpoint.status !== newStatus) {
          logger.info('[monitor] status changed', { endpointId: hb.endpointId, from: endpoint.status, to: newStatus });
          broadcastToOrg(endpoint.orgId, 'endpoint:status-change', {
            endpointId: hb.endpointId,
            previousStatus: endpoint.status,
            newStatus,
            timestamp: now.toISOString(),
          });
        }

        processed++;
      } catch (err) {
        logger.warn('failed to process heartbeat', { endpointId: hb.endpointId, error: (err as Error).message });
      }
    }

    logger.info('[monitor] heartbeats processed', { processed, total: heartbeats.length });
    res.json(successEnvelope({ processed }));
  } catch (err) { next(err); }
});

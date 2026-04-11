import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { successEnvelope } from '../../middleware/errors.js';
import * as notificationsService from './notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// GET /api/v1/notifications/preferences
notificationsRouter.get('/preferences', requirePermission('manage_org'), async (req, res, next) => {
  try {
    const prefs = await notificationsService.list(req.auth!.orgId);
    res.json(successEnvelope(prefs));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/notifications/preferences
notificationsRouter.put('/preferences', requirePermission('manage_org'), async (req, res, next) => {
  try {
    const { channel, eventType, enabled, config } = req.body;
    const pref = await notificationsService.upsert(req.auth!.orgId, channel, eventType, enabled, config);
    res.json(successEnvelope(pref));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/notifications/preferences/:id
notificationsRouter.delete('/preferences/:id', requirePermission('manage_org'), async (req, res, next) => {
  try {
    await notificationsService.remove(req.auth!.orgId, req.params.id);
    res.json(successEnvelope({ deleted: true }));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notifications/event-types
notificationsRouter.get('/event-types', requirePermission('manage_org'), async (_req, res) => {
  res.json(successEnvelope({
    eventTypes: notificationsService.getEventTypes(),
    channels: notificationsService.getChannels(),
  }));
});

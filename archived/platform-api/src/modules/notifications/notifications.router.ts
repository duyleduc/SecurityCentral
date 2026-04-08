import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// GET /notification-preferences
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: req.auth!.userId },
      select: {
        id: true,
        channel: true,
        eventType: true,
        enabled: true,
      },
      orderBy: [{ channel: 'asc' }, { eventType: 'asc' }],
    });
    res.json(successEnvelope(prefs));
  } catch (err) {
    next(err);
  }
});

// PUT /notification-preferences — bulk update
const UpdatePrefsSchema = z.object({
  preferences: z.array(
    z.object({
      channel: z.enum(['slack', 'email']),
      eventType: z.enum(['critical_finding', 'scan_complete', 'cert_expiry', 'agent_offline']),
      enabled: z.boolean(),
    }),
  ),
});

notificationsRouter.put('/', validate({ body: UpdatePrefsSchema }), async (req, res, next) => {
  try {
    const userId = req.auth!.userId;

    for (const pref of req.body.preferences) {
      await prisma.notificationPreference.upsert({
        where: {
          userId_channel_eventType: {
            userId,
            channel: pref.channel,
            eventType: pref.eventType,
          },
        },
        create: { userId, channel: pref.channel, eventType: pref.eventType, enabled: pref.enabled },
        update: { enabled: pref.enabled },
      });
    }

    const updated = await prisma.notificationPreference.findMany({
      where: { userId },
      select: { id: true, channel: true, eventType: true, enabled: true },
    });

    res.json(successEnvelope(updated));
  } catch (err) {
    next(err);
  }
});

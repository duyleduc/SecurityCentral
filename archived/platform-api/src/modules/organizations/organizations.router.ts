import { Router } from 'express';

import { prisma } from '../../lib/prisma.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

// GET /organizations/me/onboarding-status
organizationsRouter.get('/me/onboarding-status', async (req, res, next) => {
  try {
    const orgId = req.auth!.orgId;

    const [org, repoCount, integrationCount, serverCount, endpointCount] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { onboardingCompleted: true } }),
      prisma.repository.count({ where: { orgId } }),
      prisma.integration.count({ where: { orgId, provider: { in: ['github', 'gitlab', 'bitbucket'] } } }),
      prisma.server.count({ where: { orgId, status: { not: 'decommissioned' } } }),
      prisma.monitoredEndpoint.count({ where: { orgId } }),
    ]);

    res.json(successEnvelope({
      completed: org?.onboardingCompleted ?? false,
      steps: {
        code: integrationCount > 0 || repoCount > 0,
        infrastructure: serverCount > 0,
        ssl: endpointCount > 0,
      },
    }));
  } catch (err) { next(err); }
});

// POST /organizations/me/onboarding-complete
organizationsRouter.post('/me/onboarding-complete', async (req, res, next) => {
  try {
    await prisma.organization.update({
      where: { id: req.auth!.orgId },
      data: { onboardingCompleted: true },
    });
    res.json(successEnvelope({ completed: true }));
  } catch (err) { next(err); }
});

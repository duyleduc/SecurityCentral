import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { corsMiddleware, requestIdMiddleware, requestLoggerMiddleware, apiRateLimit, errorHandler } from './middleware/index.js';
import { authRouter } from './modules/auth/index.js';
import { findingsRouter } from './modules/findings/index.js';
import { repositoriesRouter, serversRouter, certificatesRouter } from './modules/assets/index.js';
import { scansRouter } from './modules/scans/index.js';
import { dashboardRouter } from './modules/dashboard/index.js';
import { auditRouter } from './modules/audit/index.js';
import { agentsRouter, installTokensRouter } from './modules/agents/index.js';
import { integrationsRouter } from './modules/integrations/index.js';
import { notificationsRouter } from './modules/notifications/index.js';
import { monitoringRouter } from './modules/monitoring/index.js';
import { organizationsRouter } from './modules/organizations/index.js';
import { projectsRouter } from './modules/projects/index.js';
import { agentRateLimit } from './middleware/index.js';
import { setupSwagger } from './swagger.js';

export const app = express();

// Security & compression
app.use(helmet());
app.use(compression());
app.use(corsMiddleware);
app.use(express.json());
app.use(cookieParser());

// Request ID on every request
app.use(requestIdMiddleware);

// Request logging (after requestId is set)
app.use(requestLoggerMiddleware);

// Rate limiting on API routes (agent routes use agentRateLimit separately)
app.use('/api', apiRateLimit);

// Swagger UI at /docs
setupSwagger(app);

// Health check (no rate limiting)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Auth routes ---
app.use('/auth', authRouter);

// --- Findings routes ---
app.use('/api/v1/findings', findingsRouter);

// --- Assets routes ---
app.use('/api/v1/repositories', repositoriesRouter);
app.use('/api/v1/servers', serversRouter);
app.use('/api/v1/certificates', certificatesRouter);
app.use('/api/v1/scans', scansRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/audit-logs', auditRouter);
app.use('/api/v1/integrations', integrationsRouter);
app.use('/api/v1/notification-preferences', notificationsRouter);
app.use('/api/v1/monitoring', monitoringRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/organizations', organizationsRouter);

// --- Agent routes (separate rate limit) ---
app.use('/v1/agents', agentRateLimit, agentsRouter);
app.use('/api/v1/install-tokens', installTokensRouter);

// API routes placeholder
app.get('/api/v1', (_req, res) => {
  res.json({ name: 'SecurityCentral API', version: '0.0.1' });
});

// Global error handler — must be registered LAST
app.use(errorHandler);

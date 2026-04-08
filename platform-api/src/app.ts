import express from 'express';
import cookieParser from 'cookie-parser';

import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLoggerMiddleware } from './middleware/request-logger.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { errorHandler, successEnvelope } from './middleware/errors.js';
import { authRouter } from './modules/auth/auth.router.js';
import { projectsRouter } from './modules/projects/projects.router.js';
import { monitoringRouter } from './modules/monitoring/monitoring.router.js';

const app = express();

// ---------------------------------------------------------------------------
// Global middleware (order matters)
// ---------------------------------------------------------------------------
app.use(corsMiddleware);
app.use(express.json());
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);
app.use(apiRateLimit);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json(successEnvelope({ status: 'ok', timestamp: new Date().toISOString() }));
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/auth', authRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/monitoring/endpoints', monitoringRouter);

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

export { app };

import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { corsMiddleware, requestIdMiddleware, requestLoggerMiddleware, apiRateLimit, errorHandler } from './middleware/index.js';
import { authRouter } from './modules/auth/index.js';
import { findingsRouter } from './modules/findings/index.js';
import { repositoriesRouter } from './modules/assets/index.js';

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

// API routes placeholder
app.get('/api/v1', (_req, res) => {
  res.json({ name: 'SecurityCentral API', version: '0.0.1' });
});

// Global error handler — must be registered LAST
app.use(errorHandler);

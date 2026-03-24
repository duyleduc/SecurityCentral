import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from './lib/env.js';

export const app = express();

// Security & compression
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  }),
);
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes placeholder
app.get('/api/v1', (_req, res) => {
  res.json({ name: 'SecurityCentral API', version: '0.0.1' });
});

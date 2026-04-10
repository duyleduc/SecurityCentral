import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('mysql://securitycentral:securitycentral@localhost:3306/securitycentral'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('change-me-in-production'),
  JWT_REFRESH_SECRET: z.string().default('change-me-refresh-in-production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // GitHub App
  GITHUB_APP_ID: z.string().default(''),
  GITHUB_APP_PRIVATE_KEY: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().default(''),

  // sc-scan binary path (optional override)
  SC_SCAN_BINARY: z.string().default(''),

  // sc-monitor API key
  SC_MONITOR_API_KEY: z.string().default('sc-monitor-dev-key'),
});

export const env = envSchema.parse(process.env);

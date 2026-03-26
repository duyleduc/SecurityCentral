import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://securitycentral:securitycentral@localhost:5432/securitycentral'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('change-me-in-production'),
  JWT_REFRESH_SECRET: z.string().default('change-me-refresh-in-production'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AGENT_CA_CERT: z.string().optional(),  // PEM-encoded CA cert (loaded from env or auto-generated for dev)
  AGENT_CA_KEY: z.string().optional(),   // PEM-encoded CA private key
});

export const env = envSchema.parse(process.env);

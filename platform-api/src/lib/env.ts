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

  // ---------------------------------------------------------------------
  // Transactional email (invitations, alerts).
  //
  // Primary: generic SMTP — works with Resend, Postmark, SendGrid, SES, Mailgun.
  //   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
  //
  // Dev shortcut: GMAIL_USER + GMAIL_APP_PASSWORD is treated as
  //   SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<GMAIL_USER>, SMTP_PASSWORD=<GMAIL_APP_PASSWORD>.
  //
  // When nothing is configured the API logs a warning and continues — invites
  // still work, the admin just has to share the link manually.
  // ---------------------------------------------------------------------
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  /** Force TLS on connect. Default: true for 465, false otherwise (STARTTLS). */
  SMTP_SECURE: z
    .enum(['true', 'false', ''])
    .default('')
    .transform((v) => v === '' ? undefined : v === 'true'),

  // Gmail dev shortcut (optional)
  GMAIL_USER: z.string().default(''),
  GMAIL_APP_PASSWORD: z.string().default(''),

  /** Pretty From header, e.g. "SecurityCentral <no-reply@example.com>". Defaults to SMTP_USER/GMAIL_USER. */
  MAIL_FROM: z.string().default(''),

  /** Public URL of the dashboard — used to build links inside emails. */
  DASHBOARD_BASE_URL: z.string().default('http://localhost:5173'),
});

export const env = envSchema.parse(process.env);

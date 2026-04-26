/**
 * Shared mailer primitives — transport getter + from header.
 * Lives in its own file so notifications/* can import without circular deps.
 */

import nodemailer, { type Transporter } from 'nodemailer';

import { env } from './env.js';
import { logger } from './logger.js';

interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly pass: string;
}

function resolveSmtpConfig(): SmtpConfig | null {
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    return {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    };
  }
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    };
  }
  return null;
}

let cachedTransporter: Transporter | null | undefined;

export function getNotificationTransport(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const cfg = resolveSmtpConfig();
  if (!cfg) {
    logger.warn('[mailer] SMTP not configured — email disabled');
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  logger.info('[mailer] SMTP transport initialized', { host: cfg.host, port: cfg.port, secure: cfg.secure });
  return cachedTransporter;
}

export function isMailEnabled(): boolean {
  return resolveSmtpConfig() !== null;
}

export function getFromHeader(): string {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  const cfg = resolveSmtpConfig();
  return cfg ? `SecurityCentral <${cfg.user}>` : 'SecurityCentral';
}

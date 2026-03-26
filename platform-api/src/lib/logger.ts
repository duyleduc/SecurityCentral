import { env } from './env.js';

// ---------------------------------------------------------------------------
// Log levels (lower number = higher severity)
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  fatal(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  trace(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function shouldLog(messageLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] <= LOG_LEVELS[configuredLevel];
}

function createLogger(bindings: Record<string, unknown> = {}, configuredLevel?: LogLevel): Logger {
  const level = configuredLevel ?? (env.LOG_LEVEL as LogLevel);

  function log(messageLevel: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(messageLevel, level)) return;

    const entry: LogEntry = {
      level: messageLevel,
      message,
      timestamp: new Date().toISOString(),
      ...bindings,
      ...context,
    };

    const line = JSON.stringify(entry);

    if (LOG_LEVELS[messageLevel] <= LOG_LEVELS.error) {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    fatal: (msg, ctx?) => log('fatal', msg, ctx),
    error: (msg, ctx?) => log('error', msg, ctx),
    warn: (msg, ctx?) => log('warn', msg, ctx),
    info: (msg, ctx?) => log('info', msg, ctx),
    debug: (msg, ctx?) => log('debug', msg, ctx),
    trace: (msg, ctx?) => log('trace', msg, ctx),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }, level),
  };
}

/** Root application logger. */
export const logger: Logger = createLogger({ service: 'platform-api' });

/** Create a child logger with request_id bound. */
export function requestLogger(requestId: string): Logger {
  return logger.child({ request_id: requestId });
}

/** Create a child logger for BullMQ job processing. */
export function jobLogger(queueName: string, jobId: string, requestId?: string): Logger {
  return logger.child({
    component: 'worker',
    queue: queueName,
    job_id: jobId,
    ...(requestId ? { request_id: requestId } : {}),
  });
}

export { createLogger, LOG_LEVELS };

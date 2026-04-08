import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLogger, type LogLevel } from '../../src/lib/logger.js';

describe('Structured Logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function parseLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
    const call = spy.mock.calls[0]?.[0] as string;
    return JSON.parse(call);
  }

  it('outputs valid JSON with required fields', () => {
    const log = createLogger({}, 'info');
    log.info('test message');

    const entry = parseLine(stdoutSpy);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('test message');
    expect(entry.timestamp).toBeDefined();
  });

  it('includes bindings in every log line', () => {
    const log = createLogger({ service: 'test' }, 'info');
    log.info('hello');

    const entry = parseLine(stdoutSpy);
    expect(entry.service).toBe('test');
  });

  it('includes context fields', () => {
    const log = createLogger({}, 'info');
    log.info('req', { method: 'GET', path: '/' });

    const entry = parseLine(stdoutSpy);
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/');
  });

  it('respects log level — suppresses below threshold', () => {
    const log = createLogger({}, 'warn');
    log.info('should be suppressed');
    log.debug('also suppressed');

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('allows messages at or above threshold', () => {
    const log = createLogger({}, 'warn');
    log.warn('warning');
    log.error('error');

    // warn goes to stdout, error goes to stderr
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('writes error and fatal to stderr', () => {
    const log = createLogger({}, 'trace');
    log.error('err msg');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('child logger inherits bindings and adds new ones', () => {
    const parent = createLogger({ service: 'api' }, 'info');
    const child = parent.child({ request_id: 'abc-123' });
    child.info('child log');

    const entry = parseLine(stdoutSpy);
    expect(entry.service).toBe('api');
    expect(entry.request_id).toBe('abc-123');
  });

  it.each<[LogLevel, LogLevel, boolean]>([
    ['info', 'info', true],
    ['debug', 'info', false],
    ['error', 'info', true],
    ['trace', 'debug', false],
    ['warn', 'error', false],
  ])('level=%s with configured=%s → logged=%s', (msgLevel, cfgLevel, shouldLog) => {
    const log = createLogger({}, cfgLevel);
    (log[msgLevel] as (msg: string) => void)('test');

    const logged = stdoutSpy.mock.calls.length > 0 || stderrSpy.mock.calls.length > 0;
    expect(logged).toBe(shouldLog);
  });
});

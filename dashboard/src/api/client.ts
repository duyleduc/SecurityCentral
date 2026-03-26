// ---------------------------------------------------------------------------
// Typed API client with JWT auth, auto-refresh on 401, envelope format
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
const AUTH_BASE = import.meta.env.VITE_AUTH_URL ?? '/auth';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshToken(): Promise<void> {
  const res = await fetch(`${AUTH_BASE}/refresh`, {
    method: 'POST',
    credentials: 'include', // sends HttpOnly refresh_token cookie
  });

  if (!res.ok) {
    accessToken = null;
    throw new Error('Session expired');
  }

  const envelope = (await res.json()) as ApiEnvelope<{ accessToken: string }>;
  accessToken = envelope.data?.accessToken ?? null;
}

async function ensureToken(): Promise<void> {
  if (accessToken) return;
  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly meta: { page?: number; per_page?: number; total?: number } | null;
  readonly errors: ReadonlyArray<{ code: string; message: string; status: number }>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  await ensureToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    try {
      await refreshToken();
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch {
      throw new ApiError('AUTH_TOKEN_EXPIRED', 'Session expired, please log in again', 401);
    }
  }

  const envelope = (await res.json()) as ApiEnvelope<T>;

  if (envelope.errors && envelope.errors.length > 0) {
    const err = envelope.errors[0];
    throw new ApiError(err.code, err.message, err.status);
  }

  return envelope;
}

// ---------------------------------------------------------------------------
// Convenience methods
// ---------------------------------------------------------------------------

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<ApiEnvelope<T>> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<T>(`${path}${qs}`);
}

export async function apiPost<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  return apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function apiPut<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete(path: string): Promise<void> {
  await ensureToken();
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers });
}

// ---------------------------------------------------------------------------
// Auth-specific (no JWT needed)
// ---------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<{ accessToken: string; user: unknown }> {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });

  const envelope = (await res.json()) as ApiEnvelope<{ accessToken: string; user: unknown }>;
  if (envelope.errors?.length) throw new ApiError(envelope.errors[0].code, envelope.errors[0].message, envelope.errors[0].status);

  accessToken = envelope.data?.accessToken ?? null;
  return envelope.data!;
}

export async function register(data: { orgName: string; name: string; email: string; password: string }): Promise<{ accessToken: string; user: unknown; org: unknown }> {
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  const envelope = (await res.json()) as ApiEnvelope<{ accessToken: string; user: unknown; org: unknown }>;
  if (envelope.errors?.length) throw new ApiError(envelope.errors[0].code, envelope.errors[0].message, envelope.errors[0].status);

  accessToken = envelope.data?.accessToken ?? null;
  return envelope.data!;
}

export function logout(): void {
  accessToken = null;
}

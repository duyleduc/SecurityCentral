import { API_BASE } from '../config';

interface ApiEnvelope<T> {
  data: T | null;
  meta: Record<string, unknown> | null;
  errors: Array<{ code: string; message: string; status: number }>;
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = (await res.json()) as ApiEnvelope<{ accessToken: string }>;
  if (!res.ok || !body.data) {
    throw new Error('Token refresh failed');
  }
  accessToken = body.data.accessToken;
  return accessToken;
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    try {
      const newToken = await refreshToken();
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
    } catch {
      accessToken = null;
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  const body = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || body.errors.length > 0) {
    throw new Error(body.errors[0]?.message ?? 'Request failed');
  }

  return body.data as T;
}

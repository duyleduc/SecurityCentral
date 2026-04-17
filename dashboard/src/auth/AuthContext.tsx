import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { setAccessToken, getAccessToken } from '../api/client';
import { connectSocket, disconnectSocket } from '../ws/client';
import { API_BASE } from '../config';

interface User {
  id: string;
  email: string;
  role: string;
}

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface AuthState {
  user: User | null;
  org: Org | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (orgName: string, name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Try to restore session on mount
  useEffect(() => {
    const tryRefresh = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.data?.accessToken) {
            setAccessToken(body.data.accessToken);
            const stored = localStorage.getItem('sc_user');
            if (stored) {
              const parsed = JSON.parse(stored);
              setUser(parsed.user);
              setOrg(parsed.org);
            }
            try { connectSocket(); } catch {}
          }
        }
      } catch {
        // No valid session
      } finally {
        setIsLoading(false);
      }
    };
    tryRefresh();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.errors?.[0]?.message ?? 'Login failed');
    }
    setAccessToken(body.data.accessToken);
    setUser(body.data.user);
    localStorage.setItem('sc_user', JSON.stringify({ user: body.data.user, org: body.data.org }));
    try { connectSocket(); } catch {}
  }, []);

  const register = useCallback(async (orgName: string, name: string, email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName, name, email, password }),
      credentials: 'include',
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.errors?.[0]?.message ?? 'Registration failed');
    }
    setAccessToken(body.data.accessToken);
    setUser(body.data.user);
    setOrg(body.data.org);
    localStorage.setItem('sc_user', JSON.stringify({ user: body.data.user, org: body.data.org }));
    try { connectSocket(); } catch {}
  }, []);

  const logout = useCallback(() => {
    disconnectSocket();
    setAccessToken(null);
    setUser(null);
    setOrg(null);
    localStorage.removeItem('sc_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, org, isAuthenticated: !!getAccessToken(), isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { setAccessToken, getAccessToken, login as apiLogin, register as apiRegister, logout as apiLogout } from '../api/client.js';

interface User {
  id: string;
  email: string;
  role: string;
  orgId?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { orgName: string; name: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Try to restore session on mount via refresh token
  useEffect(() => {
    const restore = async () => {
      try {
        const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const envelope = await res.json();
          const token = envelope.data?.accessToken;
          if (token) {
            setAccessToken(token);
            // Decode user from token (JWT payload)
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUser({ id: payload.sub, email: '', role: payload.role, orgId: payload.org });
          }
        }
      } catch {
        // No active session
      } finally {
        setIsLoading(false);
      }
    };
    restore();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    const u = result.user as User;
    setUser(u);
  }, []);

  const register = useCallback(async (data: { orgName: string; name: string; email: string; password: string }) => {
    const result = await apiRegister(data);
    const u = result.user as User;
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

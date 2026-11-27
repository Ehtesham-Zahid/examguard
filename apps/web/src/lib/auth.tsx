import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken, setAccessToken, setLogoutHandler } from './api';
import { disconnectSocket } from './socket';
import type { Prefs, User } from './types';
import { applyPrefs, localPrefs, saveLocalPrefs } from './theme';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  updatePrefs: (p: Prefs) => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const setUser = useCallback((u: User) => {
    setUserState(u);
    const merged = { ...localPrefs(), ...(u.prefs ?? {}) };
    applyPrefs(merged);
    saveLocalPrefs(merged);
  }, []);

  useEffect(() => {
    applyPrefs(localPrefs());
    setLogoutHandler(() => {
      setAccessToken(null);
      setUserState(null);
      disconnectSocket();
      qc.clear();
    });
    (async () => {
      const t = await refreshAccessToken();
      if (t) {
        try {
          const { user } = await api<{ user: User }>('/auth/me');
          setUser(user);
        } catch {
          /* not signed in */
        }
      }
      setLoading(false);
    })();
  }, [setUser, qc]);

  const login = async (email: string, password: string) => {
    const r = await api<{ accessToken: string; user: User }>('/auth/login', { body: { email, password } });
    disconnectSocket();
    setAccessToken(r.accessToken);
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => null);
    setAccessToken(null);
    setUserState(null);
    disconnectSocket(); // a shared PC must not reuse the previous user's socket or cached data
    qc.clear();
  };
  const updatePrefs = async (p: Prefs) => {
    const merged = { ...localPrefs(), ...p };
    applyPrefs(merged);
    saveLocalPrefs(merged);
    if (user) {
      setUserState({ ...user, prefs: merged });
      await api('/auth/prefs', { method: 'PUT', body: p }).catch(() => null);
    }
  };
  return <Ctx.Provider value={{ user, loading, login, logout, setUser, updatePrefs }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
};

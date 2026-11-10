import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api';
import type { AuthEntity } from './types';

interface AuthCtx {
  me: AuthEntity | null;
  loading: boolean;
  login: (nexus_id: string, password: string) => Promise<void>;
  register: (p: { name: string; role: string; password: string; state_province?: string; country?: string }) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AuthEntity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) return setLoading(false);
    api<{ entity: AuthEntity }>('/entities/me')
      .then((d) => setMe(d.entity))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthCtx = {
    me,
    loading,
    async login(nexus_id, password) {
      const d = await api<{ token: string; entity: AuthEntity }>('/auth/login', { method: 'POST', body: { nexus_id, password } });
      setToken(d.token);
      setMe(d.entity);
    },
    async register(p) {
      await api('/auth/register', { method: 'POST', body: p });
    },
    logout() {
      setToken(null);
      setMe(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

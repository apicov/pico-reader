import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import type { Reader } from '@/services/types';

const READER_KEY = 'reader_profile';

interface AuthState {
  reader: Reader | null;
  loading: boolean;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Offline-tolerant, like the tracker's AuthContext: the signed-in reader is cached, so the app opens
 *  without a network. Only the server saying no (401/403) signs out; being offline, a timeout or a
 *  server error keeps the cached session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [reader, setReader] = useState<Reader | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await setToken(null);
    await setPref(READER_KEY, null);
    setReader(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      try {
        if (!(await getToken())) return;
        const cached = await getPref<Reader>(READER_KEY);
        if (cached) setReader(cached);
        if (!isOnline()) return;
        try {
          const fresh = await api<Reader>('/api/auth/me');
          setReader(fresh);
          await setPref(READER_KEY, fresh);
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          if (status === 401 || status === 403) await signOut();
          // anything else: keep the cached session
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [signOut]);

  const value = useMemo<AuthState>(() => ({
    reader,
    loading,
    signOut,
    sendCode: async (email) => {
      await api('/api/auth/send-code', { method: 'POST', body: { email }, auth: false });
    },
    verifyCode: async (email, code) => {
      const res = await api<{ access_token: string; reader: Reader }>('/api/auth/verify-code', {
        method: 'POST', body: { email, code }, auth: false,
      });
      await setToken(res.access_token);
      await setPref(READER_KEY, res.reader);
      setReader(res.reader);
    },
  }), [reader, loading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

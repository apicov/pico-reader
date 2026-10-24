import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPref, setPref } from '@/services/prefs';
import type { ReadingThemeName } from '@/theme/readingThemes';

export interface Settings {
  theme: ReadingThemeName;
  fontScale: number; // 1 = 18px body text
  lineHeight: number;
  margin: 'narrow' | 'normal' | 'wide';
  justify: boolean;
  targetLanguage: string; // translations go into this language (ISO 639-1)
  autoReview: boolean; // looked-up words become review cards
  markLookedUp: boolean; // dotted underline under words looked up before
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'paper', fontScale: 1, lineHeight: 1.6, margin: 'normal', justify: false, targetLanguage: 'es',
  autoReview: true, markLookedUp: true,
};

const KEY = 'settings';

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getPref<Partial<Settings>>(KEY).then((saved) => saved && setSettings({ ...DEFAULT_SETTINGS, ...saved }));
  }, []);

  const value = useMemo<SettingsState>(() => ({
    settings,
    update: (patch) => setSettings((s) => {
      const next = { ...s, ...patch };
      void setPref(KEY, next);
      return next;
    }),
  }), [settings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

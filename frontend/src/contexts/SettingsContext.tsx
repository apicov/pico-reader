import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  nightDim: number; // night theme brightness, 0.25–1
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'paper', fontScale: 1, lineHeight: 1.6, margin: 'normal', justify: false, targetLanguage: 'es',
  autoReview: true, markLookedUp: true, nightDim: 1,
};

const KEY = 'settings';

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // the reader's changes: saved, and kept over the saved settings when they load after a change
  const changes = useRef<Partial<Settings> | null>(null);

  useEffect(() => {
    void getPref<Partial<Settings>>(KEY).then((saved) => {
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved, ...changes.current });
    });
  }, []);
  useEffect(() => {
    if (changes.current) void setPref(KEY, settings);
  }, [settings]);

  const value = useMemo<SettingsState>(() => ({
    settings,
    update: (patch) => {
      changes.current = { ...changes.current, ...patch };
      setSettings((s) => ({ ...s, ...patch }));
    },
  }), [settings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

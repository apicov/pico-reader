import type React from 'react';
import { createTheme, type Theme } from '@mui/material';

export type ReadingThemeName = 'paper' | 'sepia' | 'dark' | 'black';

interface ReadingColors {
  label: string;
  mode: 'light' | 'dark';
  background: string; // page
  surface: string; // cards, bars, sheets
  text: string;
  muted: string;
  accent: string; // links, selection handles, primary buttons
  divider: string;
  code: { bg: string; kw: string; str: string; num: string; fn: string; type: string };
}

/** Quiet, low-contrast-glare palettes for long reading. The accent is a muted ink blue in every theme. */
export const READING_THEMES: Record<ReadingThemeName, ReadingColors> = {
  paper: { label: 'Paper', mode: 'light', background: '#faf8f3', surface: '#ffffff', text: '#2b2b2b',
    muted: '#6f6a61', accent: '#3d5a80', divider: '#e6e1d6',
    code: { bg: '#f1eee6', kw: '#7a3e9d', str: '#3f7a3a', num: '#a0522d', fn: '#2f5e8f', type: '#8a5a00' } },
  sepia: { label: 'Sepia', mode: 'light', background: '#f4ecd8', surface: '#f9f3e3', text: '#5b4636',
    muted: '#857060', accent: '#7a5a3a', divider: '#e2d6ba',
    code: { bg: '#ede2c8', kw: '#7a3e6d', str: '#4f6b2a', num: '#9a4a1d', fn: '#3d5a7a', type: '#7a5200' } },
  dark: { label: 'Dark', mode: 'dark', background: '#1e1e1e', surface: '#262626', text: '#d6d3cd',
    muted: '#9a968e', accent: '#8fb3d9', divider: '#363431',
    code: { bg: '#2a2a2a', kw: '#c59bd9', str: '#9ccc8a', num: '#e0a372', fn: '#8fb3d9', type: '#d9c27a' } },
  black: { label: 'Black', mode: 'dark', background: '#000000', surface: '#111111', text: '#c9c6c0',
    muted: '#8a877f', accent: '#8fb3d9', divider: '#262626',
    code: { bg: '#161616', kw: '#c59bd9', str: '#9ccc8a', num: '#e0a372', fn: '#8fb3d9', type: '#d9c27a' } },
};

export const READING_FONT = '"Literata", "Noto Serif", Georgia, serif';
export const UI_FONT = '"Inter", "Noto Sans", system-ui, sans-serif';

export function createAppTheme(name: ReadingThemeName): Theme {
  const c = READING_THEMES[name];
  return createTheme({
    palette: {
      mode: c.mode,
      primary: { main: c.accent },
      background: { default: c.background, paper: c.surface },
      text: { primary: c.text, secondary: c.muted },
      divider: c.divider,
    },
    typography: {
      fontFamily: UI_FONT,
      h1: { fontFamily: READING_FONT }, h2: { fontFamily: READING_FONT }, h3: { fontFamily: READING_FONT },
      h4: { fontFamily: READING_FONT }, h5: { fontFamily: READING_FONT }, h6: { fontFamily: READING_FONT },
      button: { textTransform: 'none', fontWeight: 500 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'inherit' },
        styleOverrides: { root: { backgroundColor: c.background, borderBottom: `1px solid ${c.divider}` } },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: { defaultProps: { variant: 'outlined' } },
    },
  });
}

const MARGINS = { narrow: '12px', normal: '20px', wide: '36px' } as const;

/** CSS variables for the book text (reflow.css, and later EPUB) from the reading settings. */
export function readingVars(s: { theme: ReadingThemeName; fontScale: number; lineHeight: number;
                                 margin: keyof typeof MARGINS }): React.CSSProperties {
  const c = READING_THEMES[s.theme];
  return {
    '--r-bg': c.background, '--r-text': c.text, '--r-muted': c.muted, '--r-accent': c.accent,
    '--r-divider': c.divider, '--r-code-bg': c.code.bg, '--r-code-kw': c.code.kw, '--r-code-str': c.code.str,
    '--r-code-num': c.code.num, '--r-code-fn': c.code.fn, '--r-code-type': c.code.type,
    '--r-font': READING_FONT, '--r-font-size': `${18 * s.fontScale}px`, '--r-line-height': String(s.lineHeight),
    '--r-margin': MARGINS[s.margin], '--r-measure': '42rem',
  } as React.CSSProperties;
}

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
}

/** Quiet, low-contrast-glare palettes for long reading. The accent is a muted ink blue in every theme. */
export const READING_THEMES: Record<ReadingThemeName, ReadingColors> = {
  paper: { label: 'Paper', mode: 'light', background: '#faf8f3', surface: '#ffffff', text: '#2b2b2b',
    muted: '#6f6a61', accent: '#3d5a80', divider: '#e6e1d6' },
  sepia: { label: 'Sepia', mode: 'light', background: '#f4ecd8', surface: '#f9f3e3', text: '#5b4636',
    muted: '#857060', accent: '#7a5a3a', divider: '#e2d6ba' },
  dark: { label: 'Dark', mode: 'dark', background: '#1e1e1e', surface: '#262626', text: '#d6d3cd',
    muted: '#9a968e', accent: '#8fb3d9', divider: '#363431' },
  black: { label: 'Black', mode: 'dark', background: '#000000', surface: '#111111', text: '#c9c6c0',
    muted: '#8a877f', accent: '#8fb3d9', divider: '#262626' },
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

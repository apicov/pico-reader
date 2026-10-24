import { lazy, Suspense, useMemo } from 'react';
import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import LibraryPage from '@/pages/LibraryPage';
import LoginPage from '@/pages/LoginPage';
import SettingsPage from '@/pages/SettingsPage';
import DictionariesPage from '@/pages/DictionariesPage';
import { createAppTheme } from '@/theme/readingThemes';

// The readers (pdf.js, foliate, KaTeX) load only when a book is opened
const ReaderPage = lazy(() => import('@/pages/ReaderPage'));

function Routed() {
  const { reader, loading } = useAuth();
  const spinner = <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  if (loading) return spinner;
  if (!reader) return <LoginPage />;
  return (
    <Routes>
      {/* The reader is full screen; everything else has the library's top bar */}
      <Route path="/read/:bookId" element={<Suspense fallback={spinner}><ReaderPage /></Suspense>} />
      <Route path="/" element={<AppShell><LibraryPage /></AppShell>} />
      <Route path="/settings" element={<AppShell><SettingsPage /></AppShell>} />
      <Route path="/dictionaries" element={<AppShell><DictionariesPage /></AppShell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Themed() {
  const { settings } = useSettings();
  const theme = useMemo(() => createAppTheme(settings.theme), [settings.theme]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        {/* Hash routes: work from the Android app's file origin and need no server rewrites */}
        <HashRouter>
          <Routed />
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <Themed />
    </SettingsProvider>
  );
}

import { useMemo } from 'react';
import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import LibraryPage from '@/pages/LibraryPage';
import LoginPage from '@/pages/LoginPage';
import ReaderPage from '@/pages/ReaderPage';
import SettingsPage from '@/pages/SettingsPage';
import { createAppTheme } from '@/theme/readingThemes';

function Routed() {
  const { reader, loading } = useAuth();
  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  if (!reader) return <LoginPage />;
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/read/:bookId" element={<ReaderPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
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

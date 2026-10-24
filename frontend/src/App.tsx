import { lazy, Suspense, useEffect, useMemo } from 'react';
import { flushEvents } from '@/services/events';
import { syncDictPrefs } from '@/dict/prefs';
import { subscribeOnline } from '@/services/connectivity';
import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import LibraryPage from '@/pages/LibraryPage';
import LoginPage from '@/pages/LoginPage';
import SettingsPage from '@/pages/SettingsPage';
import DictionariesPage from '@/pages/DictionariesPage';
import TranslationsPage from '@/pages/TranslationsPage';
import AskPage from '@/pages/AskPage';
import StatsPage from '@/pages/StatsPage';
import ReviewPage from '@/pages/ReviewPage';
import { createAppTheme } from '@/theme/readingThemes';

// The readers (pdf.js, foliate, KaTeX) load only when a book is opened
const ReaderPage = lazy(() => import('@/pages/ReaderPage'));
const UploadPage = lazy(() => import('@/pages/UploadPage'));
const CommunityPage = lazy(() => import('@/pages/CommunityPage'));
const PostPage = lazy(() => import('@/pages/PostPage'));
const PostEditorPage = lazy(() => import('@/pages/PostEditorPage'));
const BookCommunityPage = lazy(() => import('@/pages/BookCommunityPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const MyProfilePage = lazy(() => import('@/pages/MyProfilePage'));
const ListPage = lazy(() => import('@/pages/ListPage').then((m) => ({ default: m.ListPage })));
const ListEditorPage = lazy(() => import('@/pages/ListPage').then((m) => ({ default: m.ListEditorPage })));

function Routed() {
  const { reader, loading } = useAuth();
  // Send recorded reading and lookups: at start, every few minutes, and when the connection comes back
  useEffect(() => {
    if (!reader) return;
    const flush = () => {
      void flushEvents().catch(() => undefined);
      void syncDictPrefs();
    };
    flush();
    const timer = setInterval(flush, 180_000);
    const unsubscribe = subscribeOnline((online) => { if (online) flush(); });
    return () => { clearInterval(timer); unsubscribe(); };
  }, [reader]);
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
      <Route path="/translations" element={<AppShell><TranslationsPage /></AppShell>} />
      <Route path="/stats" element={<AppShell><StatsPage /></AppShell>} />
      <Route path="/review" element={<AppShell><ReviewPage /></AppShell>} />
      <Route path="/upload" element={<AppShell><Suspense fallback={spinner}><UploadPage /></Suspense></AppShell>} />
      {/* the community: online pages, loaded on first use */}
      {([
        ['/community', <CommunityPage />],
        ['/community/new', <PostEditorPage />],
        ['/community/post/:postId', <PostPage />],
        ['/community/post/:postId/edit', <PostEditorPage />],
        ['/book/:bookId', <BookCommunityPage />],
        ['/u/:handle', <ProfilePage />],
        ['/profile', <MyProfilePage />],
        ['/lists/new', <ListEditorPage />],
        ['/lists/:listId', <ListPage />],
        ['/lists/:listId/edit', <ListEditorPage />],
      ] as const).map(([path, page]) => (
        <Route key={path} path={path} element={<AppShell><Suspense fallback={spinner}>{page}</Suspense></AppShell>} />
      ))}
      {/* the chat has its own full-screen layout */}
      <Route path="/ask" element={<AskPage />} />
      <Route path="/ask/:conversationId" element={<AskPage />} />
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

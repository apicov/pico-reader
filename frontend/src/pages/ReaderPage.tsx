import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, IconButton, LinearProgress, Toolbar, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import TocIcon from '@mui/icons-material/Toc';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ensureFile, fileBlob, isCached } from '@/services/bookCache';
import type { BookFormat } from '@/services/types';
import { READING_THEMES, readingVars } from '@/theme/readingThemes';
import { flushPositions, loadPosition, savePosition } from '@/reader/position';
import { ReadingSettings } from '@/reader/ReadingSettings';
import { TocDrawer } from '@/reader/TocDrawer';
import { ReflowBundle } from '@/reader/reflow/bundle';
import { ReflowReader, type ReflowTarget } from '@/reader/reflow/ReflowReader';

// Formats the app can show, best reading experience first
const SUPPORTED: BookFormat[] = ['reflow'];

type Phase = { kind: 'loading' } | { kind: 'downloading'; fraction: number } | { kind: 'error'; message: string }
  | { kind: 'ready'; bundle: ReflowBundle; target: ReflowTarget };

function parseLocation(location: string | undefined): ReflowTarget {
  const m = /^c(\d+):([\d.]+)$/.exec(location ?? '');
  return m ? { chapter: Number(m[1]), fraction: Number(m[2]) } : { chapter: 0, fraction: 0 };
}

export default function ReaderPage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const { library } = useLibrary();
  const online = useOnlineStatus();
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const book = library?.books.find((b) => b.id === bookId);

  // Download (if needed) and open the book once
  const opened = useRef(false);
  useEffect(() => {
    if (!book || opened.current) return;
    opened.current = true;
    let bundle: ReflowBundle | null = null;
    void (async () => {
      try {
        const format = SUPPORTED.find((f) => book.formats[f]);
        if (!format) throw new Error(`This app can't show ${Object.keys(book.formats).join(', ')} books yet.`);
        if (!(await isCached(book.id, format, book.formats[format]!)) && !online) {
          throw new Error("This book isn't on this device yet; open it once while online.");
        }
        await ensureFile(book, format, (fraction) => setPhase({ kind: 'downloading', fraction }));
        bundle = await ReflowBundle.open(await fileBlob(book.id, format));
        const pos = await loadPosition(book.id);
        setPhase({ kind: 'ready', bundle, target: parseLocation(pos?.format === format ? pos.location : undefined) });
      } catch (e) {
        setPhase({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => bundle?.close();
  }, [book, online]);

  // Remember the place: on the device at once, on the server every so often and when leaving
  const lastSync = useRef(0);
  const onScroll = useCallback((chapter: number, fraction: number) => {
    if (phase.kind !== 'ready' || !book) return;
    const n = phase.bundle.meta.chapters.length;
    void savePosition({ book_id: book.id, format: 'reflow', location: `c${chapter}:${fraction.toFixed(4)}`,
      progress: Math.min(1, (chapter + fraction) / n) }).then(() => {
      if (Date.now() - lastSync.current > 15_000) {
        lastSync.current = Date.now();
        void flushPositions().catch(() => undefined);
      }
    });
  }, [phase, book]);
  useEffect(() => () => { void flushPositions().catch(() => undefined); }, []);

  const goTo = useCallback((target: ReflowTarget) => {
    setPhase((p) => (p.kind === 'ready' ? { ...p, target } : p));
    onScroll(target.chapter, target.fraction ?? 0);
  }, [onScroll]);

  const colors = READING_THEMES[settings.theme];
  return (
    <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex', flexDirection: 'column', bgcolor: colors.background }}>
      <AppBar position="static" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" aria-label="Back to the library" onClick={() => navigate('/')}><ArrowBackIcon /></IconButton>
          <Typography noWrap sx={{ flex: 1, mx: 1, fontSize: 15 }}>
            {phase.kind === 'ready' ? phase.bundle.meta.chapters[phase.target.chapter]?.title : book?.title}
          </Typography>
          {phase.kind === 'ready' && (
            <IconButton aria-label="Contents" onClick={() => setTocOpen(true)}><TocIcon /></IconButton>
          )}
          <IconButton edge="end" aria-label="Text settings" onClick={(e) => setSettingsAnchor(e.currentTarget)}>
            <FormatSizeIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {!book && library && <Alert severity="warning" sx={{ m: 2 }}>This book is no longer in the library.</Alert>}
        {phase.kind === 'loading' && <LinearProgress />}
        {phase.kind === 'downloading' && (
          <Box sx={{ p: 3, maxWidth: 420, mx: 'auto' }}>
            <Typography variant="body2" sx={{ mb: 1 }}>Downloading {book?.title} for offline reading…</Typography>
            <LinearProgress variant="determinate" value={phase.fraction * 100} />
          </Box>
        )}
        {phase.kind === 'error' && (
          <Alert severity="info" sx={{ m: 2 }} action={<Button onClick={() => navigate('/')}>Library</Button>}>{phase.message}</Alert>
        )}
        {phase.kind === 'ready' && (
          <ReflowReader bundle={phase.bundle} target={phase.target} onNavigate={goTo} onScroll={onScroll}
            style={readingVars(settings)} justify={settings.justify} dark={colors.mode === 'dark'} />
        )}
      </Box>
      {phase.kind === 'ready' && (
        <TocDrawer open={tocOpen} onClose={() => setTocOpen(false)} title={phase.bundle.meta.title}
          chapters={phase.bundle.meta.chapters} current={phase.target.chapter}
          onPick={(chapter) => goTo({ chapter, fraction: 0 })} />
      )}
      <ReadingSettings anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
    </Box>
  );
}

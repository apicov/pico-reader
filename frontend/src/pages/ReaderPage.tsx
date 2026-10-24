import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, IconButton, LinearProgress, ListItemText, Menu, MenuItem, Toolbar, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import TocIcon from '@mui/icons-material/Toc';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ensureFile, fileBlob, isCached } from '@/services/bookCache';
import { getPref, setPref } from '@/services/prefs';
import type { Book, BookFormat } from '@/services/types';
import { READING_THEMES, readingVars } from '@/theme/readingThemes';
import { flushPositions, loadPosition, savePosition, type Position } from '@/reader/position';
import { ReadingSettings } from '@/reader/ReadingSettings';
import { TocDrawer } from '@/reader/TocDrawer';
import { ReflowBundle } from '@/reader/reflow/bundle';
import { ReflowView } from '@/reader/reflow/ReflowView';
import { EpubView } from '@/reader/epub/EpubView';
import { PdfView } from '@/reader/pdf/PdfView';
import type { TocItem, ViewHandle } from '@/reader/types';

// Best reading experience first: text that reflows, then EPUB, then fixed PDF pages
const PREFERENCE: BookFormat[] = ['reflow', 'epub', 'pdf'];
const LABEL: Record<BookFormat, string> = { reflow: 'Text', epub: 'EPUB', pdf: 'PDF' };
const formatKey = (bookId: string) => `format:${bookId}`;

type Loaded = { format: 'reflow'; bundle: ReflowBundle } | { format: 'epub' | 'pdf'; blob: Blob };
type Phase = { kind: 'loading' } | { kind: 'downloading'; fraction: number } | { kind: 'error'; message: string }
  | { kind: 'ready'; loaded: Loaded; initial: { location?: string; progress?: number } };

async function openFormat(book: Book, format: BookFormat, online: boolean,
                          onProgress: (f: number) => void): Promise<Loaded> {
  if (!(await isCached(book.id, format, book.formats[format]!)) && !online) {
    throw new Error(`The ${LABEL[format]} version isn't on this device yet; open it once while online.`);
  }
  await ensureFile(book, format, onProgress);
  const blob = await fileBlob(book.id, format);
  return format === 'reflow' ? { format, bundle: await ReflowBundle.open(blob) } : { format, blob };
}

export default function ReaderPage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const { library } = useLibrary();
  const online = useOnlineStatus();
  const { settings } = useSettings();
  const book = library?.books.find((b) => b.id === bookId);
  const formats = PREFERENCE.filter((f) => book?.formats[f]);

  const [format, setFormat] = useState<BookFormat | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentToc, setCurrentToc] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [formatAnchor, setFormatAnchor] = useState<HTMLElement | null>(null);
  const viewRef = useRef<ViewHandle>(null);
  const lastPosition = useRef<Position | null>(null);

  // The format: the last one used for this book, else the best available
  useEffect(() => {
    if (!book || format) return;
    void getPref<BookFormat>(formatKey(book.id)).then((saved) =>
      setFormat(saved && book.formats[saved] ? saved : formats[0] ?? null));
  }, [book, format, formats]);

  // Download (if needed) and open the chosen format
  useEffect(() => {
    if (!book || !format) return;
    let cancelled = false;
    let opened: Loaded | null = null;
    setPhase({ kind: 'loading' });
    setToc([]);
    void (async () => {
      try {
        const loaded = await openFormat(book, format, online,
          (fraction) => !cancelled && setPhase({ kind: 'downloading', fraction }));
        opened = loaded;
        const pos = lastPosition.current ?? (await loadPosition(book.id));
        // The same format resumes exactly; another one starts at the same share of the book
        const initial = pos?.format === format ? { location: pos.location } : { progress: pos?.progress ?? 0 };
        if (!cancelled) setPhase({ kind: 'ready', loaded, initial });
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      if (opened?.format === 'reflow') opened.bundle.close();
    };
    // `online` only matters for the first open; a connection change mustn't reload the book
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, format]);

  // Remember the place: on the device at once, on the server every so often and when leaving
  const lastSync = useRef(0);
  const onLocation = useCallback((location: string, progress: number) => {
    if (!book || !format) return;
    const pos = { book_id: book.id, format, location, progress };
    lastPosition.current = { ...pos, updated_at: new Date().toISOString() };
    void savePosition(pos).then(() => {
      if (Date.now() - lastSync.current > 15_000) {
        lastSync.current = Date.now();
        void flushPositions().catch(() => undefined);
      }
    });
  }, [book, format]);
  useEffect(() => () => { void flushPositions().catch(() => undefined); }, []);

  const switchFormat = (f: BookFormat) => {
    setFormatAnchor(null);
    if (!book || f === format) return;
    void setPref(formatKey(book.id), f);
    setFormat(f);
  };

  const colors = READING_THEMES[settings.theme];
  const viewProps = {
    ref: viewRef, onLocation, onToc: setToc, onCurrentToc: setCurrentToc, settings,
    vars: readingVars(settings), dark: colors.mode === 'dark',
  };
  const title = toc.find((t) => t.id === currentToc)?.label ?? book?.title;

  return (
    <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex',
      flexDirection: 'column', bgcolor: colors.background }}>
      <AppBar position="static" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" aria-label="Back to the library" onClick={() => navigate('/')}><ArrowBackIcon /></IconButton>
          <Typography noWrap sx={{ flex: 1, mx: 1, fontSize: 15 }}>{title}</Typography>
          {formats.length > 1 && (
            <Button size="small" color="inherit" startIcon={<SwapHorizIcon />} aria-label="Switch format"
              onClick={(e) => setFormatAnchor(e.currentTarget)}>{format && LABEL[format]}</Button>
          )}
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
        {book && formats.length === 0 && <Alert severity="info" sx={{ m: 2 }}>This book has no format the app can show.</Alert>}
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
        {phase.kind === 'ready' && phase.loaded.format === 'reflow' && (
          <ReflowView key="reflow" bundle={phase.loaded.bundle} initial={phase.initial} {...viewProps} />
        )}
        {phase.kind === 'ready' && phase.loaded.format === 'epub' && book && (
          <EpubView key="epub" blob={phase.loaded.blob} language={book.language} initial={phase.initial} {...viewProps} />
        )}
        {phase.kind === 'ready' && phase.loaded.format === 'pdf' && (
          <PdfView key="pdf" blob={phase.loaded.blob} initial={phase.initial} {...viewProps} />
        )}
      </Box>
      <TocDrawer open={tocOpen} onClose={() => setTocOpen(false)} title={book?.title ?? ''} items={toc}
        current={currentToc} onPick={(id) => viewRef.current?.goToToc(id)} />
      <Menu anchorEl={formatAnchor} open={!!formatAnchor} onClose={() => setFormatAnchor(null)}>
        {formats.map((f) => (
          <MenuItem key={f} selected={f === format} onClick={() => switchFormat(f)}>
            <ListItemText primary={LABEL[f]}
              secondary={f === 'reflow' ? 'Text that fits the screen' : f === 'pdf' ? 'The printed pages' : 'E-book pages'} />
          </MenuItem>
        ))}
      </Menu>
      <ReadingSettings anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
    </Box>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, ListItemText, Menu, MenuItem, Snackbar, TextField, Toolbar, Typography } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { annotationsFor, deleteAnnotation, saveAnnotation, subscribeAnnotations, syncAnnotations, updateAnnotation, type Annotation } from '@/services/annotations';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import TocIcon from '@mui/icons-material/Toc';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ensureFile, ensureSearchFile, fileBlob, isCached } from '@/services/bookCache';
import { getPref, setPref } from '@/services/prefs';
import { isOnline } from '@/services/connectivity';
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
import { flushEvents, saveSession, SessionTracker } from '@/services/events';
import { lookedUpWords, wordsIn } from '@/services/words';
import { setShelfStatus } from '@/services/shelf';
import { offlineSearchEnabled } from '@/search/offlineSearch';
import type { TextSelection } from '@/reader/selection';
import { SelectionPanel } from '@/reader/SelectionPanel';
import { useSendToComputer } from '@/components/SendToComputer';

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
  // ?format=&location=&progress= opens the book at a place (a search result); used once, then dropped
  const [params, setParams] = useSearchParams();
  const jump = useRef<{ format: BookFormat | null; location: string; progress: number } | null>(
    params.get('format') || params.get('progress') ? {
      format: (params.get('format') || null) as BookFormat | null, location: params.get('location') ?? '',
      progress: Number(params.get('progress') ?? 0),
    } : null);
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
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [noteFor, setNoteFor] = useState<Annotation | null>(null);
  const [noteText, setNoteText] = useState('');
  const [position, setPosition] = useState<{ location: string; progress: number } | null>(null);
  const [looked, setLooked] = useState<Set<string> | null>(null);
  const [chapterWords, setChapterWords] = useState<{ word: string; count: number }[]>([]);
  const viewRef = useRef<ViewHandle>(null);
  const lastPosition = useRef<Position | null>(null);

  // The format: the last one used for this book, else the best available
  useEffect(() => {
    if (!book || format) return;
    if (jump.current?.format && book.formats[jump.current.format]) {
      setFormat(jump.current.format);
      return;
    }
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
        const target = jump.current && (!jump.current.format || jump.current.format === format) ? jump.current : null;
        jump.current = null;
        if (target) setParams({}, { replace: true });
        // A search result opens at its passage; the same format resumes exactly; another one starts at the
        // same share of the book
        const initial = target ? { location: target.location, progress: target.progress }
          : pos?.format === format ? { location: pos.location } : { progress: pos?.progress ?? 0 };
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

  // Opening a book puts it on the reader's "Currently reading" list (unless finished or removed before)
  useEffect(() => {
    if (book) void setShelfStatus(book.id, 'reading', true);
    // with offline search on, an opened book's search file comes along
    if (book?.search && online) void offlineSearchEnabled().then((on) => on && ensureSearchFile(book).catch(() => undefined));
  }, [book?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Words looked up before in this book's language (underlined, and the "Words" tab)
  useEffect(() => {
    if (!book) return;
    void lookedUpWords(book.language).then(setLooked);
  }, [book?.language]);  // eslint-disable-line react-hooks/exhaustive-deps
  const seenWords = settings.markLookedUp ? looked : null;
  const openToc = () => {
    setTocOpen(true);
    const text = viewRef.current?.currentText() ?? '';
    setChapterWords(looked ? wordsIn(text, looked) : []);
  };

  // Highlights and bookmarks of this book (synced with the other devices)
  useEffect(() => {
    if (!bookId) return;
    const load = () => void annotationsFor(bookId).then(setAnnotations);
    load();
    void syncAnnotations().catch(() => undefined);
    return subscribeAnnotations(load);
  }, [bookId]);
  const highlights = useMemo(() => annotations.filter((a) => a.kind === 'highlight' && a.format === format)
    .map((a) => ({ id: a.id, location: a.location, text: a.text, color: a.color })), [annotations, format]);
  const bookmarkHere = position && annotations.find((a) => a.kind === 'bookmark' && a.format === format
    && Math.abs(a.progress - position.progress) < 0.004);

  const toggleBookmark = () => {
    if (!book || !format || !position) return;
    if (bookmarkHere) void deleteAnnotation(bookmarkHere.id);
    else void saveAnnotation({ book_id: book.id, kind: 'bookmark', format, location: position.location,
      progress: position.progress, text: toc.find((t) => t.id === currentToc)?.label ?? '' });
  };

  const highlightSelection = () => {
    if (!book || !format || !selection?.anchor) return;
    void saveAnnotation({ book_id: book.id, kind: 'highlight', format, location: selection.anchor.location,
      progress: selection.anchor.progress, text: selection.text });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // Sending to the study computer: code as a snippet (its language kept), anything else as a highlight
  const { send, ui: sendUi } = useSendToComputer();
  const meta = (place?: { location: string; progress: number }) => ({ book_id: book?.id, book_title: book?.title,
    heading: toc.find((t) => t.id === currentToc)?.label ?? '', location: place?.location, progress: place?.progress });
  const sendSelection = () => {
    if (!selection) return;
    send(selection.code
      ? { kind: 'snippet', language: selection.code.language, body: selection.code.text, meta: meta(selection.anchor) }
      : { kind: 'highlight', body: selection.text, meta: meta(selection.anchor) });
  };

  /** Opens the post editor with this passage as a quote (it jumps back here from the post). */
  const quoteInPost = (q: { format: string; location: string; progress: number; text: string }) => {
    if (!book) return;
    navigate('/community/new', { state: { quote: { book_id: book.id, text: q.text, format: q.format,
      location: q.location, progress: q.progress } } });
  };

  const openAnnotation = (a: Annotation) => {
    if (a.format === format) viewRef.current?.goTo(a.location, a.progress);
    else if (book?.formats[a.format as BookFormat]) {
      jump.current = { format: a.format as BookFormat, location: a.location, progress: a.progress };
      setFormat(a.format as BookFormat);
    }
  };

  // Reading time for the statistics: a session per stretch of reading, saved as it grows
  const tracker = useRef<SessionTracker | null>(null);
  useEffect(() => {
    if (!book || !format) return;
    const t = new SessionTracker(book.id, format);
    tracker.current = t;
    const finish = () => { const s = t.end(); if (s) void saveSession(s).then(() => flushEvents().catch(() => undefined)); };
    const onVisibility = () => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); finish(); tracker.current = null; };
  }, [book?.id, format]);  // eslint-disable-line react-hooks/exhaustive-deps
  const lastSessionSave = useRef(0);
  const readingActivity = useCallback((progress?: number) => {
    const s = tracker.current?.activity(progress);
    if (s && Date.now() - lastSessionSave.current > 15_000) {
      lastSessionSave.current = Date.now();
      void saveSession(s);
    }
  }, []);

  // Remember the place: on the device at once, on the server every so often and when leaving
  const lastSync = useRef(0);
  // Reaching the end of a book that wasn't finished when opened: offer to rate it (once per book)
  const startProgress = useRef<number | null>(null);
  const [ratePrompt, setRatePrompt] = useState(false);
  const onLocation = useCallback((location: string, progress: number) => {
    if (!book || !format) return;
    if (startProgress.current === null) startProgress.current = progress;
    else if (progress >= 0.98 && startProgress.current < 0.98) {
      startProgress.current = 1;
      const key = `rate_prompted_${book.id}`;
      void getPref<boolean>(key).then((asked) => {
        if (!asked && isOnline()) { setRatePrompt(true); void setPref(key, true); }
      });
    }
    const pos = { book_id: book.id, format, location, progress };
    setPosition({ location, progress });
    readingActivity(progress);
    lastPosition.current = { ...pos, updated_at: new Date().toISOString() };
    void savePosition(pos).then(() => {
      if (Date.now() - lastSync.current > 15_000) {
        lastSync.current = Date.now();
        void flushPositions().catch(() => undefined);
      }
    });
  }, [book, format, readingActivity]);
  useEffect(() => () => { void flushPositions().catch(() => undefined); }, []);
  const onSelection = useCallback((s: TextSelection | null) => {
    setSelection(s);
    if (s) readingActivity();
  }, [readingActivity]);

  const switchFormat = (f: BookFormat) => {
    setFormatAnchor(null);
    if (!book || f === format) return;
    void setPref(formatKey(book.id), f);
    setFormat(f);
  };

  const colors = READING_THEMES[settings.theme];
  const viewProps = {
    ref: viewRef, onLocation, onToc: setToc, onCurrentToc: setCurrentToc, onSelection, settings,
    vars: readingVars(settings), dark: colors.mode === 'dark', highlights, seenWords,
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
            <IconButton aria-label={bookmarkHere ? 'Remove bookmark' : 'Bookmark this place'} onClick={toggleBookmark}
              disabled={!position}>
              {bookmarkHere ? <BookmarkIcon /> : <BookmarkBorderIcon />}
            </IconButton>
          )}
          {phase.kind === 'ready' && (
            <IconButton aria-label="Contents" onClick={openToc}><TocIcon /></IconButton>
          )}
          <IconButton edge="end" aria-label="Text settings" onClick={(e) => setSettingsAnchor(e.currentTarget)}>
            <FormatSizeIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
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
        {selection && book && (
          <SelectionPanel selection={selection} language={book.language} dark={colors.mode === 'dark'}
            bookId={book.id} location={lastPosition.current?.location ?? ''}
            onHighlight={selection.anchor ? highlightSelection : undefined} onSend={sendSelection}
            onQuote={selection.anchor && format ? () => quoteInPost({ format, location: selection.anchor!.location,
              progress: selection.anchor!.progress, text: selection.text }) : undefined}
            onClose={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }} />
        )}
      </Box>
      <TocDrawer open={tocOpen} onClose={() => setTocOpen(false)} title={book?.title ?? ''} items={toc}
        current={currentToc} onPick={(id) => viewRef.current?.goToToc(id)}
        annotations={annotations} onAnnotation={openAnnotation} onShare={quoteInPost}
        onSend={(a) => send({ kind: 'highlight', body: a.text, meta: { ...meta(a), heading: '' } })}
        words={chapterWords} onWord={(word) => setSelection({ text: word, context: '' })}
        onEditNote={(a) => { setNoteFor(a); setNoteText(a.note); }} onDelete={(a) => void deleteAnnotation(a.id)} />
      {sendUi}
      <Snackbar open={ratePrompt} autoHideDuration={12_000} onClose={() => setRatePrompt(false)}
        message="Finished! Tell the others what you thought?"
        action={<Button color="primary" size="small" onClick={() => book && navigate(`/book/${encodeURIComponent(book.id)}`)}>Rate it</Button>} />
      <Dialog open={!!noteFor} onClose={() => setNoteFor(null)} fullWidth maxWidth="sm">
        <DialogTitle>Note</DialogTitle>
        <DialogContent>
          {noteFor?.kind === 'highlight' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontStyle: 'italic' }}>“{noteFor.text}”</Typography>
          )}
          <TextField autoFocus fullWidth multiline minRows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteFor(null)}>Cancel</Button>
          <Button onClick={() => { if (noteFor) void updateAnnotation(noteFor.id, { note: noteText.trim() }); setNoteFor(null); }}>Save</Button>
        </DialogActions>
      </Dialog>
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

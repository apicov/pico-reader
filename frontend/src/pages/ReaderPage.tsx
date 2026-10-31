import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, LinearProgress, Snackbar, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ImageViewer, type ViewedImage } from '@/components/ImageViewer';
import { useSendToComputer } from '@/components/SendToComputer';
import { TopBar } from '@/components/TopBar';
import { useSettings } from '@/contexts/SettingsContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { AnnotationNoteDialog } from '@/reader/AnnotationNoteDialog';
import { FormatMenu } from '@/reader/FormatMenu';
import { FORMATS } from '@/reader/formats';
import { useAnnotations } from '@/reader/hooks/useAnnotations';
import { useBookFormat } from '@/reader/hooks/useBookFormat';
import { useFinishPrompt } from '@/reader/hooks/useFinishPrompt';
import { useLookedUpWords } from '@/reader/hooks/useLookedUpWords';
import { useOpenedBook, type Initial } from '@/reader/hooks/useOpenedBook';
import { usePlace } from '@/reader/hooks/usePlace';
import { useReadingSession } from '@/reader/hooks/useReadingSession';
import { jumpFromParams, type Jump } from '@/reader/jump';
import { loadPosition } from '@/reader/position';
import { ReaderToolbar } from '@/reader/ReaderToolbar';
import { ReadingSettings } from '@/reader/ReadingSettings';
import { setReadingNow } from '@/reader/readingNow';
import type { TextSelection } from '@/reader/selection';
import { SelectionPanel } from '@/reader/SelectionPanel';
import { TocDrawer } from '@/reader/TocDrawer';
import type { TocItem, ViewHandle } from '@/reader/types';
import { offlineSearchEnabled } from '@/search/offlineSearch';
import { deleteAnnotation, saveAnnotation, type Annotation } from '@/services/annotations';
import { ensureSearchFile } from '@/services/bookCache';
import { setShelfStatus } from '@/services/shelf';
import type { BookFormat } from '@/services/types';
import { wordsIn } from '@/reader/seenWords';
import { READING_THEMES, readingVars } from '@/theme/readingThemes';

/** A bookmark this close (in progress through the book) to the place is the place's bookmark */
const BOOKMARK_NEAR = 0.004;

/** `active`: shown; when another page is, the book stays open behind it (ReaderHost) and comes back as it was */
export default function ReaderPage({ bookId, active }: { bookId: string; active: boolean }) {
  // ?format=&location=&progress= opens the book at a place (a search result); used once, then dropped
  const [params, setParams] = useSearchParams();
  const jump = useRef<Jump | null>(jumpFromParams(params));
  const navigate = useNavigate();
  const { library } = useLibrary();
  const online = useOnlineStatus();
  const { settings } = useSettings();
  const book = library?.books.find((b) => b.id === bookId);
  // the other pages offer the way back here ("Continue reading")
  useEffect(() => { if (book) setReadingNow(book); }, [book]);

  const { formats, format, choose: chooseFormat, openIn } = useBookFormat(book, jump.current?.format ?? null);
  const readingActivity = useReadingSession(book?.id, format, active);
  const finishPrompt = useFinishPrompt(book?.id);
  const checkFinished = finishPrompt.check;
  const onMove = useCallback((progress: number) => {
    checkFinished(progress);
    readingActivity(progress);
  }, [checkFinished, readingActivity]);
  const place = usePlace(book?.id, format, onMove);

  // A link to a place opens there; the same format resumes exactly; another one starts at the same share of the book
  const startAt = async (f: BookFormat): Promise<Initial> => {
    const pos = place.last.current ?? (book ? await loadPosition(book.id) : null);
    const target = jump.current && (!jump.current.format || jump.current.format === f) ? jump.current : null;
    jump.current = null;
    if (target) setParams({}, { replace: true });
    if (target) return { location: target.location, progress: target.progress };
    return pos?.format === f ? { location: pos.location } : { progress: pos?.progress ?? 0 };
  };
  const phase = useOpenedBook(book, format, online, startAt);
  const viewRef = useRef<ViewHandle>(null);

  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentToc, setCurrentToc] = useState<string | null>(null);
  useEffect(() => { setToc([]); setCurrentToc(null); }, [book?.id, format]);
  const heading = toc.find((t) => t.id === currentToc)?.label;

  const [tocOpen, setTocOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [formatAnchor, setFormatAnchor] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [noteFor, setNoteFor] = useState<Annotation | null>(null);
  const [picture, setPicture] = useState<ViewedImage | null>(null); // a picture tapped in the book, shown large
  const [chapterWords, setChapterWords] = useState<{ word: string; count: number }[]>([]);

  // Hidden behind another page: what floats over the book closes (menus and panels would show over that page)
  useEffect(() => {
    if (active) return;
    setSelection(null);
    setTocOpen(false);
    setSettingsAnchor(null);
    setFormatAnchor(null);
    setPicture(null);
  }, [active]);

  // Opened again at a place (a citation, a quote, a search result) while it was open behind another page
  const target = active ? params.get('location') ?? params.get('progress') : null;
  useEffect(() => {
    if (!target || phase.kind !== 'ready' || jump.current) return;
    const to = jumpFromParams(params);
    setParams({}, { replace: true });
    if (to) goToPlace(to);
  }, [target, phase.kind]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a book puts it on the reader's "Currently reading" list (unless finished or removed before);
  // with offline search on, its search file comes along
  useEffect(() => {
    if (!book) return;
    void setShelfStatus(book.id, 'reading', true);
    if (book.search && online) void offlineSearchEnabled().then((on) => on && ensureSearchFile(book).catch(() => undefined));
  }, [book?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const looked = useLookedUpWords(book?.language);
  const openToc = () => {
    setTocOpen(true);
    const text = viewRef.current?.currentText() ?? '';
    setChapterWords(looked ? wordsIn(text, looked) : []);
  };

  const { annotations, highlights } = useAnnotations(bookId, format);
  const bookmarkHere = place.place && annotations.find((a) => a.kind === 'bookmark' && a.format === format
    && Math.abs(a.progress - place.place!.progress) < BOOKMARK_NEAR);
  const toggleBookmark = () => {
    if (!book || !format || !place.place) return;
    if (bookmarkHere) void deleteAnnotation(bookmarkHere.id);
    else void saveAnnotation({ book_id: book.id, kind: 'bookmark', format, location: place.place.location,
      progress: place.place.progress, text: heading ?? '' });
  };

  const clearSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const highlightSelection = () => {
    if (!book || !format || !selection?.anchor) return;
    void saveAnnotation({ book_id: book.id, kind: 'highlight', format, location: selection.anchor.location,
      progress: selection.anchor.progress, text: selection.text });
    clearSelection();
  };
  const onSelection = useCallback((s: TextSelection | null) => {
    setSelection(s);
    if (s) readingActivity();
  }, [readingActivity]);

  // Sending to the study computer: code as a snippet (its language kept), anything else as a highlight
  const { send, ui: sendUi } = useSendToComputer();
  const meta = (at?: { location: string; progress: number }) => ({ book_id: book?.id, book_title: book?.title,
    heading: heading ?? '', location: at?.location, progress: at?.progress });
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

  /** To a place: in the format it's in when the book has it (opened there), else at its progress in the open one */
  const goToPlace = (to: Jump) => {
    if (to.format && to.format !== format && book?.formats[to.format]) {
      jump.current = to;
      openIn(to.format);
    } else {
      viewRef.current?.goTo(to.location, to.progress);
    }
  };
  const openAnnotation = (a: Annotation) => goToPlace({ format: a.format as BookFormat, location: a.location, progress: a.progress });

  const colors = READING_THEMES[settings.theme];
  const dark = colors.mode === 'dark';
  const viewProps = {
    onLocation: place.report, onToc: setToc, onCurrentToc: setCurrentToc, onSelection, settings,
    vars: readingVars(settings), dark, highlights, seenWords: settings.markLookedUp ? looked : null,
    onImage: setPicture, active,
  };

  return (
    <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex',
      flexDirection: 'column', bgcolor: colors.background }}>
      <AppBar position="static" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <TopBar bookId={book?.id} />
        <ReaderToolbar title={heading ?? book?.title} ready={phase.kind === 'ready'}
          formatLabel={formats.length > 1 && format ? FORMATS[format].label : undefined} onFormats={setFormatAnchor}
          bookmarked={!!bookmarkHere} canBookmark={!!place.place} onBookmark={toggleBookmark}
          onContents={openToc} onSettings={setSettingsAnchor} />
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
        {phase.kind === 'ready' && phase.opened.render({ ...viewProps, initial: phase.initial }, viewRef)}
        {selection && book && (
          <SelectionPanel selection={selection} language={book.language} dark={dark}
            bookId={book.id} location={selection.anchor?.location ?? place.place?.location ?? ''}
            onHighlight={selection.anchor ? highlightSelection : undefined} onSend={sendSelection}
            onQuote={selection.anchor && format
              ? () => quoteInPost({ format, ...selection.anchor!, text: selection.text }) : undefined}
            onClose={clearSelection} />
        )}
      </Box>
      <TocDrawer open={tocOpen} onClose={() => setTocOpen(false)} title={book?.title ?? ''} items={toc}
        current={currentToc} onPick={(id) => viewRef.current?.goToToc(id)}
        annotations={annotations} onAnnotation={openAnnotation} onShare={quoteInPost}
        onSend={(a) => send({ kind: 'highlight', body: a.text, meta: { ...meta(a), heading: '' } })}
        words={chapterWords} onWord={(word) => setSelection({ text: word, context: '' })}
        onEditNote={setNoteFor} onDelete={(a) => void deleteAnnotation(a.id)} />
      {sendUi}
      <ImageViewer image={picture} onClose={() => setPicture(null)} />
      <Snackbar open={finishPrompt.open} autoHideDuration={12_000} onClose={finishPrompt.close}
        message="Finished! Tell the others what you thought?"
        action={<Button color="primary" size="small" onClick={() => book && navigate(`/book/${encodeURIComponent(book.id)}`)}>Rate it</Button>} />
      <AnnotationNoteDialog annotation={noteFor} onClose={() => setNoteFor(null)} />
      <FormatMenu anchor={formatAnchor} formats={formats} current={format} onPick={chooseFormat}
        onClose={() => setFormatAnchor(null)} />
      <ReadingSettings anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
    </Box>
  );
}

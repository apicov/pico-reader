import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, IconButton, LinearProgress, Toolbar, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import TocIcon from '@mui/icons-material/Toc';
import { Navigate, useNavigate } from 'react-router-dom';
import { ImageViewer, type ViewedImage } from '@/components/ImageViewer';
import { useSettings } from '@/contexts/SettingsContext';
import { OPEN, type OpenedBook } from '@/reader/formatViews';
import { useLookedUpWords } from '@/reader/hooks/useLookedUpWords';
import { ReadingSettings } from '@/reader/ReadingSettings';
import { wordsIn } from '@/reader/seenWords';
import type { TextSelection } from '@/reader/selection';
import { SelectionPanel } from '@/reader/SelectionPanel';
import { TocDrawer } from '@/reader/TocDrawer';
import type { TocItem, ViewHandle } from '@/reader/types';
import { forgetViewedFile, viewedFile } from '@/reader/viewedFile';
import { LANGUAGES } from '@/services/languages';
import { READING_THEMES, readingVars } from '@/theme/readingThemes';
import { guessLanguage, nameToMeta, type BookSource } from '@/upload/books';
import { buildReflowBundle } from '@/upload/markdown';
import { epubMeta } from '@/upload/metadata';

type Phase = { kind: 'loading' } | { kind: 'error'; message: string }
  | { kind: 'ready'; opened: OpenedBook; title: string; language: string };

/** A file opened just to read (docs/19-viewing-a-file.md): an EPUB, PDF or Markdown file from the device, shown from
 *  memory. It isn't added to the library, nor indexed; its place, highlights or tabs aren't kept. Closing it (or
 *  leaving the page, or the app) lets it go. Looking words up and translating work as in a book. */
export default function ViewFilePage() {
  const [source] = useState(viewedFile);
  useEffect(() => () => forgetViewedFile(), []);
  if (!source) return <Navigate to="/upload" replace />; // the app was started again: the file is gone
  return <Viewer source={source} />;
}

/** What the file says about itself, enough to show it: a title, and the language for looking words up */
async function aboutFile(source: BookSource): Promise<{ title: string; language: string; author: string }> {
  const { title, author } = nameToMeta(source.file.name);
  if (source.kind === 'markdown') {
    const text = await source.file.text();
    return { title: title || /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || 'Untitled', author, language: guessLanguage(text) };
  }
  if (source.kind === 'epub') {
    const m = await epubMeta(source.file);
    return { title: m.title || title, author: m.author || author, language: m.language in LANGUAGES ? m.language : '' };
  }
  return { title, author, language: '' }; // a PDF: guessed from its text once it's open
}

async function open(source: BookSource): Promise<Phase> {
  const about = await aboutFile(source);
  if (source.kind === 'markdown') {
    const { zip } = await buildReflowBundle(await source.file.text(), source.images, about);
    return { kind: 'ready', opened: await OPEN.reflow(zip, about), ...about };
  }
  return { kind: 'ready', opened: await OPEN[source.kind](source.file, about), ...about };
}

function Viewer({ source }: { source: BookSource }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    let opened: OpenedBook | null = null;
    void open(source).then((p) => {
      if (p.kind === 'ready') opened = p.opened;
      if (cancelled) opened?.close();
      else setPhase(p);
    }, (e: Error) => !cancelled && setPhase({ kind: 'error', message: `This file can't be opened: ${e.message}` }));
    return () => { cancelled = true; opened?.close(); };
  }, [source]);

  const viewRef = useRef<ViewHandle>(null);
  const [language, setLanguage] = useState('');
  useEffect(() => { if (phase.kind === 'ready') setLanguage(phase.language); }, [phase]);
  const [place, setPlace] = useState('');
  const onLocation = useCallback((location: string) => {
    setPlace(location);
    // no language in the file (a PDF): the text tells, once there is some
    setLanguage((l) => l || guessLanguage(viewRef.current?.currentText() ?? ''));
  }, []);

  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentToc, setCurrentToc] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [picture, setPicture] = useState<ViewedImage | null>(null);
  const [chapterWords, setChapterWords] = useState<{ word: string; count: number }[]>([]);
  const looked = useLookedUpWords(language || undefined);
  const openToc = () => {
    setTocOpen(true);
    setChapterWords(looked ? wordsIn(viewRef.current?.currentText() ?? '', looked) : []);
  };
  const clearSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const close = () => navigate(-1);

  const colors = READING_THEMES[settings.theme];
  const dark = colors.mode === 'dark';
  const title = phase.kind === 'ready' ? phase.title : source.file.name;
  const heading = toc.find((t) => t.id === currentToc)?.label;

  return (
    <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex',
      flexDirection: 'column', bgcolor: colors.background }}>
      <AppBar position="static" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <Toolbar variant="dense" sx={{ gap: 0.5, px: { xs: 1, sm: 2 } }}>
          <Tooltip title="Close (the file isn't kept)">
            <IconButton edge="start" aria-label="Close the file" onClick={close}><CloseIcon /></IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>{heading ?? title}</Typography>
            <Typography noWrap variant="caption" color="text.secondary" component="div">
              Just reading: not in the library
            </Typography>
          </Box>
          {phase.kind === 'ready' && <IconButton aria-label="Contents" onClick={openToc}><TocIcon /></IconButton>}
          <IconButton edge="end" aria-label="Text settings" onClick={(e) => setSettingsAnchor(e.currentTarget)}>
            <FormatSizeIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {phase.kind === 'loading' && <LinearProgress />}
        {phase.kind === 'error' && (
          <Alert severity="info" sx={{ m: 2 }} action={<Button onClick={close}>Back</Button>}>{phase.message}</Alert>
        )}
        {phase.kind === 'ready' && phase.opened.render({
          initial: {}, onLocation, onToc: setToc, onCurrentToc: setCurrentToc, onSelection: setSelection, settings,
          vars: readingVars(settings), dark, highlights: [], seenWords: settings.markLookedUp ? looked : null,
          onImage: setPicture, active: true,
        }, viewRef)}
        {selection && (
          <SelectionPanel selection={selection} language={language} dark={dark} bookId={null}
            location={selection.anchor?.location ?? place} onClose={clearSelection} />
        )}
      </Box>
      <TocDrawer open={tocOpen} onClose={() => setTocOpen(false)} title={title} items={toc} current={currentToc}
        onPick={(id) => viewRef.current?.goToToc(id)} annotations={[]} onAnnotation={() => undefined}
        onEditNote={() => undefined} onDelete={() => undefined} onShare={() => undefined} onSend={() => undefined}
        words={chapterWords} onWord={(word) => setSelection({ text: word, context: '', picked: true })} />
      <ImageViewer image={picture} onClose={() => setPicture(null)} />
      <ReadingSettings anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
    </Box>
  );
}

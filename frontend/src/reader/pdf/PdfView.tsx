import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Paper, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import './pdf.css';
import { openExternal } from '../links';
import { fractionDown, pagePlace, type Place, placeAt, progressAt } from '../locations';
import { watchSelection } from '../selection';
import type { ViewHandle, ViewProps } from '../types';
import { useThrottledScroll } from '../useThrottledScroll';
import { NO_HIGHLIGHTS, type PageHighlight } from './markSpans';
import { destPage, type Dest, entryAt, entryPages, type Outline, type OutlineNode, readOutline } from './outline';
import { type PageLink, PdfPage, type Size } from './PdfPage';
import { usePinchZoom } from './usePinchZoom';

// The legacy build runs in older Android WebViews too
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_FIT_WIDTH = 900; // on a wide screen "fit" stops at a readable width
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25; // the + and − buttons
const TOP_GAP = 12; // px above the first page (and between pages): a page "at the top" starts this far down
const REPORT_EVERY_MS = 400;

/** PDF as a column of pages; location `p<page>:<fraction down the page>`. */
export const PdfView = forwardRef<ViewHandle, ViewProps & { blob: Blob }>(function PdfView(
  { blob, initial, onLocation, onToc, onCurrentToc, onSelection, settings, vars, highlights }, ref) {
  const callbacks = useRef({ onCurrentToc });
  callbacks.current = { onCurrentToc };
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const outline = useRef<Outline>({ items: [], dests: new Map() });
  const tocPages = useRef<{ id: string; page: number }[]>([]); // each contents entry's page
  const restore = useRef<Place | null>(null);
  const current = useRef<Place>({ index: 0, fraction: 0 }); // the page at the top of the screen

  // Open the document and measure every page (the layout needs all heights to scroll to a place)
  useEffect(() => {
    let loaded: PDFDocumentProxy | null = null;
    let cancelled = false;
    void (async () => {
      try {
        loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (cancelled) return;
        // every page taken as big as the first one, to show the PDF at once; measured below
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        const all: Size[] = Array.from({ length: loaded.numPages }, () => ({ w: first.width, h: first.height }));
        const place = pagePlace.parse(initial.location) ?? placeAt(initial.progress ?? 0, all.length);
        restore.current = { index: Math.min(place.index, all.length - 1), fraction: place.fraction };
        setSizes(all);
        setDoc(loaded);
        outline.current = readOutline((await loaded.getOutline()) as OutlineNode[] | null);
        onToc(outline.current.items);
        void entryPages(loaded, outline.current).then((pages) => {
          tocPages.current = pages;
          if (!cancelled) callbacks.current.onCurrentToc(entryAt(pages, current.current.index));
        }).catch(() => undefined); // the contents still work, without showing where the reader is
        // the real sizes, in the background; only pages of another size change the layout (and the place is kept)
        const measured: Size[] = [];
        for (let i = 1; i <= loaded.numPages && !cancelled; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 });
          measured.push({ w: vp.width, h: vp.height });
        }
        if (!cancelled && measured.some((m, i) => m.w !== all[i].w || m.h !== all[i].h)) setSizes(measured);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; void loaded?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // Fit width follows the window
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseW = sizes[0]?.w ?? 600;
  const scale = (Math.min(width - 16, MAX_FIT_WIDTH) / baseW) * zoom;

  // Which pages are near the screen
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !doc) return;
    const io = new IntersectionObserver((entries) => {
      setVisible((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          if (e.isIntersecting) next.add(i); else next.delete(i);
        }
        return next;
      });
    }, { root, rootMargin: '150% 0px' });
    pagesRef.current?.querySelectorAll('.pdf-page').forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, [doc, sizes, scale]);

  const pageTop = useCallback((index: number) =>
    (pagesRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.offsetTop ?? 0), []);

  const scrollTo = useCallback(({ index, fraction }: Place) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = pageTop(index) - TOP_GAP + fraction * (sizes[index]?.h ?? 0) * scale;
  }, [pageTop, sizes, scale]);

  // After opening and after a zoom change, go back to the page being read
  useLayoutEffect(() => {
    if (!doc || !width) return;
    const target = restore.current ?? current.current;
    restore.current = null;
    scrollTo(target);
    current.current = target;  // the place until the reader scrolls (the measured sizes can come first)
  }, [doc, width, scale, scrollTo]);

  // Report the place: the page at the top of the screen and how far down it is
  useThrottledScroll(scrollRef, REPORT_EVERY_MS, (el) => {
    const y = el.scrollTop + TOP_GAP;
    let index = 0;
    while (index < sizes.length - 1 && pageTop(index + 1) <= y) index++;
    const place = { index, fraction: Math.max(0, Math.min(1, (y - pageTop(index)) / (sizes[index].h * scale))) };
    const entry = entryAt(tocPages.current, index);
    if (entry !== entryAt(tocPages.current, current.current.index)) onCurrentToc(entry);
    current.current = place;
    onLocation(pagePlace.format(place), progressAt(place, sizes.length));
  }, !!doc);

  // The selection, with the page and how far down it is (for highlights)
  useEffect(() => watchSelection(document, (sel) => {
    const range = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0) : null;
    const node = range?.startContainer;
    const pageEl = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.pdf-page');
    if (sel && range && pageEl) {
      const place = { index: Number(pageEl.dataset.index), fraction: fractionDown(range, pageEl.getBoundingClientRect()) };
      sel.anchor = { location: pagePlace.format(place), progress: progressAt(place, sizes.length) };
    }
    onSelection(sel);
  }, () => pagesRef.current), [onSelection, sizes.length]);

  const pageHighlights = useMemo(() => {
    const byPage = new Map<number, PageHighlight[]>();
    for (const h of highlights) {
      const place = pagePlace.parse(h.location);
      if (place) byPage.set(place.index, [...(byPage.get(place.index) ?? []), { text: h.text, color: h.color, fraction: place.fraction }]);
    }
    return byPage;
  }, [highlights]);

  // Pinch to zoom: the page column scales while the fingers move, the pages render again once at the end
  usePinchZoom(scrollRef, pagesRef, zoom, setZoom, MIN_ZOOM, MAX_ZOOM);

  const goToDest = useCallback(async (dest: Dest) => {
    const index = doc ? await destPage(doc, dest).catch(() => null) : null;
    if (index !== null) scrollTo({ index, fraction: 0 });
  }, [doc, scrollTo]);
  const onLink = useCallback((link: PageLink) => {
    if (link.url) openExternal(link.url);
    else void goToDest(link.dest ?? null);
  }, [goToDest]);

  useImperativeHandle(ref, () => ({
    currentText: () => [...(pagesRef.current?.querySelectorAll('.textLayer') ?? [])].map((l) => l.textContent ?? '').join('\n'),
    goTo: (location, progress) => {
      const place = pagePlace.parse(location) ?? (sizes.length ? placeAt(progress, sizes.length) : null);
      if (place) scrollTo(place);
    },
    goToToc: (id) => void goToDest(outline.current.dests.get(id) ?? null),
  }), [scrollTo, sizes.length, goToDest]);

  const themeClass = ['dark', 'black', 'night'].includes(settings.theme) ? 'pdf-dark' : settings.theme === 'sepia' ? 'pdf-sepia' : '';
  if (error) return <Typography color="error" sx={{ p: 3 }}>This PDF can't be opened: {error}</Typography>;
  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <div ref={scrollRef} className={`pdf-scroll ${themeClass}`} style={vars}>
        <div ref={pagesRef} className="pdf-pages">
          {doc && sizes.map((size, i) => (
            <PdfPage key={i} doc={doc} index={i} size={size} scale={scale} visible={visible.has(i)}
              highlights={pageHighlights.get(i) ?? NO_HIGHLIGHTS} onLink={onLink} />
          ))}
        </div>
      </div>
      <Paper elevation={2} sx={{ position: 'absolute', right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))',
        display: 'flex', borderRadius: 5 }}>
        <IconButton aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP))}><RemoveIcon /></IconButton>
        <IconButton aria-label="Fit width" onClick={() => setZoom(1)}><FitScreenIcon /></IconButton>
        <IconButton aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP))}><AddIcon /></IconButton>
      </Paper>
    </Box>
  );
});

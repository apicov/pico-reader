import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Paper, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import './pdf.css';
import type { TocItem, ViewHandle, ViewProps } from '../types';
import { watchSelection } from '../selection';

// The legacy build runs in older Android WebViews too
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_FIT_WIDTH = 900; // on a wide screen "fit" stops at a readable width
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const MAX_CANVAS_PIXELS = 12_000_000; // mobile WebViews refuse bigger canvases

interface Size { w: number; h: number }

const NO_HIGHLIGHTS: { text: string; color: string }[] = [];

/** Tint the text-layer spans that hold a highlight's text (pdf.js spans are runs of a line, so this
 *  marks whole runs: close enough to see what was highlighted). */
function markSpans(layer: HTMLElement, highlights: { text: string; color: string }[]) {
  const spans = [...layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')];
  let text = '';
  const bounds = spans.map((span) => {
    const start = text.length;
    text += `${(span.textContent ?? '').replace(/\s+/g, ' ')} `;
    return [start, text.length] as const;
  });
  const flat = text.replace(/\s+/g, ' ');
  for (const h of highlights) {
    const needle = h.text.replace(/\s+/g, ' ').trim();
    const at = flat.indexOf(needle);
    if (at < 0 || !needle) continue;
    spans.forEach((span, i) => {
      if (bounds[i][0] < at + needle.length && bounds[i][1] > at) span.classList.add('hl', `hl-${h.color || 'yellow'}`);
    });
  }
}

/** A link on a page: where (CSS px on the page) and to what (a web address, or a place in the PDF) */
interface PageLink { left: number; top: number; width: number; height: number; url?: string; dest?: OutlineNode['dest'] }

function Page({ doc, index, size, scale, visible, highlights, onLink }: {
  doc: PDFDocumentProxy; index: number; size: Size; scale: number; visible: boolean;
  highlights: { text: string; color: string }[]; onLink: (link: PageLink) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PageLink[]>([]);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let textLayer: { cancel: () => void } | null = null;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    void (async () => {
      page = await doc.getPage(index + 1);
      if (cancelled || !canvasRef.current || !textRef.current) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1,
        Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: page.getViewport({ scale: scale * dpr }) });
      const textDiv = textRef.current;
      textDiv.replaceChildren();
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      textLayer = layer;
      await Promise.all([task.promise, layer.render()]).catch(() => undefined);
      if (!cancelled) markSpans(textDiv, highlightsRef.current);
      const annotations = await page.getAnnotations().catch(() => []);
      if (cancelled) return;
      setLinks(annotations.filter((a) => a.subtype === 'Link' && (a.url || a.dest)).map((a) => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect) as number[];
        return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
          url: a.url as string | undefined, dest: a.dest as OutlineNode['dest'] };
      }));
    })();
    // a page that scrolls away gives its memory back (a long PDF would otherwise keep every page's resources)
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
      void Promise.resolve(task?.promise).catch(() => undefined).finally(() => page?.cleanup());
    };
  }, [doc, index, scale, visible]);

  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const highlightKey = highlights.map((h) => `${h.color}:${h.text}`).join('\u0000');
  useEffect(() => {
    const layer = textRef.current;
    if (!layer || !visible) return;
    layer.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl', 'hl-yellow', 'hl-green', 'hl-blue'));
    markSpans(layer, highlightsRef.current);
  }, [highlightKey, visible]);

  return (
    <div className="pdf-page" data-index={index}
      style={{ width: size.w * scale, height: size.h * scale, '--scale-factor': scale } as React.CSSProperties}>
      {visible && <canvas ref={canvasRef} />}
      {visible && <div ref={textRef} className="textLayer" />}
      {visible && links.map((l, i) => (
        <a key={i} className="pdf-link" href={l.url ?? '#'} aria-label={l.url ?? 'Link'}
          style={{ left: l.left, top: l.top, width: l.width, height: l.height }}
          onClick={(e) => { e.preventDefault(); onLink(l); }} />
      ))}
    </div>
  );
}

interface OutlineNode { title: string; dest: string | unknown[] | null; items: OutlineNode[] }

/** PDF as a column of pages; location `p<page>:<fraction down the page>`. */
export const PdfView = forwardRef<ViewHandle, ViewProps & { blob: Blob }>(function PdfView(
  { blob, initial, onLocation, onToc, onCurrentToc, onSelection, settings, vars, highlights }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const outlineDests = useRef(new Map<string, OutlineNode['dest']>());
  const restore = useRef<{ page: number; fraction: number } | null>(null);
  const current = useRef({ page: 0, fraction: 0 });

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
        const m = /^p(\d+):([\d.]+)$/.exec(initial.location ?? '');
        if (m) restore.current = { page: Math.min(Number(m[1]) - 1, all.length - 1), fraction: Number(m[2]) };
        else if (initial.progress) {
          const exact = initial.progress * all.length;
          restore.current = { page: Math.min(Math.floor(exact), all.length - 1), fraction: exact % 1 };
        } else restore.current = { page: 0, fraction: 0 };
        setSizes(all);
        setDoc(loaded);
        const outline = (await loaded.getOutline()) as OutlineNode[] | null;
        const items: TocItem[] = [];
        const walk = (nodes: OutlineNode[], depth: number) => nodes.forEach((n) => {
          const id = `o${items.length}`;
          outlineDests.current.set(id, n.dest);
          items.push({ id, label: n.title, depth });
          walk(n.items ?? [], depth + 1);
        });
        walk(outline ?? [], 0);
        onToc(items);
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

  const scrollTo = useCallback((page: number, fraction: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = pageTop(page) - 12 + fraction * (sizes[page]?.h ?? 0) * scale;
  }, [pageTop, sizes, scale]);

  // After opening and after a zoom change, go back to the page being read
  useLayoutEffect(() => {
    if (!doc || !width) return;
    const target = restore.current ?? current.current;
    restore.current = null;
    scrollTo(target.page, target.fraction);
    current.current = target;  // the place until the reader scrolls (the measured sizes can come first)
  }, [doc, width, scale, scrollTo]);

  // Report the place: the page at the top of the screen and how far down it is
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc) return;
    let timer = 0;
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        const y = el.scrollTop + 12;
        let page = 0;
        while (page < sizes.length - 1 && pageTop(page + 1) <= y) page++;
        const fraction = Math.max(0, Math.min(1, (y - pageTop(page)) / (sizes[page].h * scale)));
        current.current = { page, fraction };
        onLocation(`p${page + 1}:${fraction.toFixed(4)}`, (page + fraction) / sizes.length);
      }, 400);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, [doc, sizes, scale, pageTop, onLocation]);

  useEffect(() => onCurrentToc(null), [onCurrentToc]);
  // The selection, with the page and how far down it is (for highlights)
  useEffect(() => watchSelection(document, (sel) => {
    const range = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0) : null;
    const node = range?.startContainer;
    const pageEl = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.pdf-page');
    if (sel && range && pageEl) {
      const index = Number(pageEl.dataset.index);
      const box = pageEl.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (range.getBoundingClientRect().top - box.top) / Math.max(1, box.height)));
      sel.anchor = { location: `p${index + 1}:${fraction.toFixed(4)}`, progress: (index + fraction) / Math.max(1, sizes.length) };
    }
    onSelection(sel);
  }, () => pagesRef.current), [onSelection, sizes.length]);

  const pageHighlights = useMemo(() => {
    const byPage = new Map<number, { text: string; color: string }[]>();
    for (const h of highlights) {
      const m = /^p(\d+):/.exec(h.location);
      if (m) byPage.set(Number(m[1]) - 1, [...(byPage.get(Number(m[1]) - 1) ?? []), { text: h.text, color: h.color }]);
    }
    return byPage;
  }, [highlights]);

  // Pinch to zoom: scale the page column while the fingers move, re-render once at the end
  useEffect(() => {
    const el = scrollRef.current;
    const inner = pagesRef.current;
    if (!el || !inner) return;
    let startDist = 0;
    let ratio = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) { startDist = dist(e.touches); ratio = 1; } };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      ratio = Math.max(MIN_ZOOM / zoom, Math.min(MAX_ZOOM / zoom, dist(e.touches) / startDist));
      inner.style.transform = `scale(${ratio})`;
    };
    const end = () => {
      if (!startDist) return;
      startDist = 0;
      inner.style.transform = '';
      if (Math.abs(ratio - 1) > 0.02) setZoom((z) => z * ratio);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); };
  }, [zoom]);

  const goToDest = useCallback(async (dest: OutlineNode['dest']) => {
    if (!doc) return;
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit[0]) return;
    const index = typeof explicit[0] === 'number' ? explicit[0] : await doc.getPageIndex(explicit[0] as never);
    scrollTo(index, 0);
  }, [doc, scrollTo]);
  const onLink = useCallback((link: PageLink) => {
    if (link.url) { if (/^(https?|mailto):/i.test(link.url)) window.open(link.url, '_blank', 'noopener'); }
    else void goToDest(link.dest ?? null);
  }, [goToDest]);

  useImperativeHandle(ref, () => ({
    currentText: () => [...(pagesRef.current?.querySelectorAll('.textLayer') ?? [])].map((l) => l.textContent ?? '').join('\n'),
    goTo: (location, progress) => {
      const m = /^p(\d+):([\d.]+)$/.exec(location);
      if (m) scrollTo(Number(m[1]) - 1, Number(m[2]));
      else if (sizes.length) scrollTo(Math.min(sizes.length - 1, Math.floor(progress * sizes.length)), (progress * sizes.length) % 1);
    },
    goToToc: (id) => void goToDest(outlineDests.current.get(id) ?? null),
  }), [scrollTo, sizes.length, goToDest]);

  const themeClass = ['dark', 'black', 'night'].includes(settings.theme) ? 'pdf-dark' : settings.theme === 'sepia' ? 'pdf-sepia' : '';
  if (error) return <Typography color="error" sx={{ p: 3 }}>This PDF can't be opened: {error}</Typography>;
  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <div ref={scrollRef} className={`pdf-scroll ${themeClass}`} style={vars}>
        <div ref={pagesRef} className="pdf-pages">
          {doc && sizes.map((size, i) => (
            <Page key={i} doc={doc} index={i} size={size} scale={scale} visible={visible.has(i)}
              highlights={pageHighlights.get(i) ?? NO_HIGHLIGHTS} onLink={onLink} />
          ))}
        </div>
      </div>
      <Paper elevation={2} sx={{ position: 'absolute', right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))',
        display: 'flex', borderRadius: 5 }}>
        <IconButton aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}><RemoveIcon /></IconButton>
        <IconButton aria-label="Fit width" onClick={() => setZoom(1)}><FitScreenIcon /></IconButton>
        <IconButton aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}><AddIcon /></IconButton>
      </Paper>
    </Box>
  );
});

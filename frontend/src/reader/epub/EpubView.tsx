import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogContent } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import 'katex/dist/katex.min.css'; // math in a note's popup (the note is shown in the app's page)
import DOMPurify from 'dompurify';
import 'foliate-js/view.js';
import type { FoliateRelocate, FoliateTocItem, FoliateView } from 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { READING_FONT, READING_THEMES } from '@/theme/readingThemes';
import { tappedImage } from '../images';
import type { Settings } from '@/contexts/SettingsContext';
import type { TocItem, ViewHandle, ViewProps } from '../types';
import { watchSelection } from '../selection';
import { seenWordRanges } from '@/services/words';

/** The app's @font-face rules with absolute URLs: the book's sections are separate documents (blob URLs),
 *  so they neither inherit the app's fonts nor resolve its relative font paths. */
let fontFaces: string | null = null;
function appFontFaces(): string {
  if (fontFaces !== null) return fontFaces;
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule && /Literata/.test(rule.style.getPropertyValue('font-family'))) {
        rules.push(rule.cssText.replace(/url\("?([^")]+)"?\)/g,
          (_, u: string) => `url("${new URL(u, sheet.href ?? location.href).href}")`));
      }
    }
  }
  fontFaces = rules.join('\n');
  return fontFaces;
}

/** The book's text styled by the reading settings (foliate injects this into each section). */
function bookCss(s: Settings): string {
  const c = READING_THEMES[s.theme];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${appFontFaces()}
    /* foliate paints the page background itself, from --theme-bg-color (also on a theme change) */
    html { color-scheme: ${c.mode}; --theme-bg-color: ${c.background}; background: ${c.background} !important;
      -webkit-tap-highlight-color: ${c.tap}; }
    body { background: transparent !important; color: ${c.text} !important; font-size: ${18 * s.fontScale}px !important; }
    /* the reading font and colours win over the book's own (dark themes need it), except for code and math, which
       keep their own fonts (KaTeX places glyphs by its fonts' metrics) and colours (syntax highlighting, \\color);
       the exceptions sit in :where() so the rules' specificity, and so which book rules beat them, stays the same */
    body, body *:where(:not(.katex, .katex *, math, math *, mjx-container, mjx-container *)) {
      font-family: ${READING_FONT} !important; }
    pre, code, kbd, samp, pre *, code * { font-family: ui-monospace, monospace !important; }
    body *:not(a):where(:not(pre *, code *, .katex *, math *, mjx-container *)) { color: inherit !important; }
    p, li, blockquote, dd { line-height: ${s.lineHeight} !important; text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    a:link { color: ${c.accent} !important; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    /* a wide table fits its column (the page is in columns: wider, it ran over the next pages) */
    table { max-width: 100% !important; }
    td, th { overflow-wrap: anywhere; }
    ${c.mode === 'dark' ? 'img { filter: brightness(0.9); }' : ''}
    ::highlight(seen) { text-decoration: underline dotted ${c.accent} 1.5px; text-underline-offset: 3px; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

/** Underline the looked-up words (a CSS highlight: the DOM stays as it is, so EPUB positions don't move).
 *  WebViews without the Custom Highlight API (Chromium < 105) show no underlines. */
function markSeen(doc: Document, words: Set<string> | null) {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const registry = win?.CSS?.highlights;
  if (!win || !registry) return;
  if (words?.size) registry.set('seen', new win.Highlight(...seenWordRanges(doc.body, words)));
  else registry.delete('seen');
}

/** The element an anchor resolved to (anchors can also be ranges or offsets); tag checks, not instanceof:
 *  the book's pages are documents of their own */
const asElement = (x: unknown) => (x && typeof x === 'object' && 'closest' in x ? x as Element : null);

/** Display math wider than its column is scaled down to fit (it ran into the next column or was cut off); again
 *  whenever the column's width or the text size changes. Math can't wrap, and scrolling sideways fights page turns. */
const refits = new WeakMap<Document, () => void>();
function fitDisplayMath(doc: Document) {
  const win = doc.defaultView;
  if (!win) return;
  const fit = () => doc.querySelectorAll<HTMLElement>('.katex-display, math[display="block"], mjx-container[display="true"]')
    .forEach((el) => {
      el.style.fontSize = '';
      el.style.overflowX = '';
      const ratio = el.clientWidth / el.scrollWidth;
      if (ratio >= 1) return;
      el.style.fontSize = `${Math.max(0.5, ratio * 0.98)}em`;
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowX = 'auto';  // too wide even at half size: it scrolls
    });
  // foliate widens the page as it adds columns: only the column's width and the text size matter
  let last = '';
  const check = () => {
    const now = `${getComputedStyle(doc.documentElement).columnWidth}|${getComputedStyle(doc.body).fontSize}`;
    if (now !== last) { last = now; win.requestAnimationFrame(fit); }
  };
  new win.ResizeObserver(check).observe(doc.documentElement);
  refits.set(doc, check);
  void doc.fonts?.ready.then(() => win.requestAnimationFrame(fit));  // the math fonts change the widths
}

const EPUB_NS = 'http://www.idpf.org/2007/ops';
const NOTE_TYPES = /\b(footnote|endnote|rearnote)\b/;
const isNoteRef = (a: Element) => /\bnoteref\b/.test(a.getAttributeNS(EPUB_NS, 'type') ?? '')
  || a.getAttribute('role') === 'doc-noteref';
/** A note hidden by bookCss (asides typed as notes) */
const hiddenNote = (el: Element) => {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.localName === 'aside' && NOTE_TYPES.test(e.getAttributeNS(EPUB_NS, 'type') ?? '')) return e;
  }
  return null;
};

/** A note's content for the popup: its element (or the block around the anchor it starts with), without the
 *  link back to the text, sanitized; null when there's nothing to show. */
function noteHtml(target: Element): string | null {
  const note = (hiddenNote(target) ?? target.closest('aside, li, dd, p, div') ?? target).cloneNode(true) as Element;
  note.querySelectorAll('a').forEach((a) => {
    if (/\bbacklink\b/.test(a.getAttributeNS(EPUB_NS, 'type') ?? '') || a.getAttribute('role') === 'doc-backlink'
      || a.classList.contains('footnote-back')) a.remove();
  });
  if (!note.textContent?.trim()) return null;
  return DOMPurify.sanitize(note.innerHTML, { FORBID_TAGS: ['style', 'form', 'input'] });
}

const HIGHLIGHT_COLORS: Record<string, string> = { yellow: 'rgba(255, 210, 0, 0.45)', green: 'rgba(80, 200, 120, 0.4)', blue: 'rgba(80, 150, 255, 0.38)' };

const MARGIN_PX = { narrow: '0px', normal: '8px', wide: '32px' } as const;

function flatten(items: FoliateTocItem[] | null | undefined, depth = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    // an entry without a link is a heading; one without text (only a picture) has an empty label
    const label = (item.label ?? '').trim();
    out.push(item.href ? { id: item.href, label, depth } : { id: `header:${out.length}`, label, depth, header: true });
    flatten(item.subitems, depth + 1, out);
  }
  return out;
}

/** EPUB in pages (foliate-js). Location: the EPUB CFI. */
export const EpubView = forwardRef<ViewHandle, ViewProps & { blob: Blob; language: string }>(function EpubView(
  { blob, language, initial, onLocation, onToc, onCurrentToc, onSelection, onImage, settings, highlights, seenWords,
    active = true }, ref) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const callbacks = useRef({ onLocation, onToc, onCurrentToc, onSelection, onImage });
  callbacks.current = { onLocation, onToc, onCurrentToc, onSelection, onImage };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const fraction = useRef(0);
  const seenRef = useRef(seenWords);
  seenRef.current = seenWords;
  const drawn = useRef(new Map<string, string>()); // cfi → color
  const [note, setNote] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false); // after following a link: back to where it was

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:100%;height:100%';
    host.append(view);
    viewRef.current = view;
    let closed = false;
    const sectionOf = new WeakMap<Document, number>();

    view.addEventListener('relocate', (e) => {
      const d = (e as CustomEvent<FoliateRelocate>).detail;
      fraction.current = d.fraction;
      callbacks.current.onLocation(d.cfi, d.fraction);
      callbacks.current.onCurrentToc(d.tocItem?.href ?? null);
    });
    view.addEventListener('external-link', (e) => {
      e.preventDefault();
      window.open((e as CustomEvent<{ href: string }>).detail.href, '_blank', 'noopener');
    });
    view.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
      if (!doc.documentElement.lang) doc.documentElement.lang = language;
      sectionOf.set(doc, index);
      doc.addEventListener('keydown', onKey);
      doc.addEventListener('click', (ev) => {
        const src = tappedImage(ev.target);
        if (src && !doc.getSelection()?.toString()) callbacks.current.onImage?.(src);
      });
      markSeen(doc, seenRef.current);
      fitDisplayMath(doc);
      // the selection, with its CFI (for highlights)
      watchSelection(doc, (sel) => {
        const s = doc.getSelection();
        if (sel && s?.rangeCount) {
          try {
            sel.anchor = { location: view.getCFI(index, s.getRangeAt(0)), progress: fraction.current };
          } catch { /* no CFI: the selection can still be looked up and translated */ }
        }
        callbacks.current.onSelection(sel);
      });
    });
    // a link to a note opens it in a popup (notes in asides are hidden in the text); other links: foliate goes there
    view.addEventListener('link', (e) => {
      const { a, href } = (e as CustomEvent<{ a: Element; href: string }>).detail;
      const target = view.book.resolveHref?.(href);
      if (!target) return;
      const here = sectionOf.get(a.ownerDocument) === target.index ? asElement(target.anchor(a.ownerDocument)) : null;
      if (!(here && hiddenNote(here)) && !isNoteRef(a)) { setCanGoBack(true); return; } // foliate goes there
      e.preventDefault();
      void (async () => {
        const doc = here ? null : await view.book.sections[target.index]?.createDocument?.().catch(() => null);
        const el = here ?? (doc ? asElement(target.anchor(doc)) : null);
        const html = el ? noteHtml(el) : null;
        if (html) setNote(html);
        else void view.goTo(href);
      })();
    });
    // highlights: drawn by foliate's overlayer, again whenever a section is laid out
    view.addEventListener('create-overlay', () => {
      for (const h of highlightsRef.current) {
        if (h.location.startsWith('epubcfi(')) void view.addAnnotation({ value: h.location, color: h.color });
      }
    });
    view.addEventListener('draw-annotation', (e) => {
      const { draw, annotation } = (e as CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color?: string } }>).detail;
      draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[annotation.color ?? 'yellow'] ?? HIGHLIGHT_COLORS.yellow });
    });

    void (async () => {
      // foliate tells formats apart by file name and type
      await view.open(new File([blob], 'book.epub', { type: 'application/epub+zip' }));
      if (closed) return;
      const s = settingsRef.current;
      view.renderer.setAttribute('flow', 'paginated');
      view.renderer.setAttribute('max-inline-size', '720px');
      view.renderer.setAttribute('margin', '40px');
      view.renderer.setAttribute('gap', '6%');
      view.renderer.style.setProperty('padding-inline', MARGIN_PX[s.margin]);
      view.renderer.setStyles?.(bookCss(s));
      view.renderer.style.background = READING_THEMES[s.theme].background;
      callbacks.current.onToc(flatten(view.book.toc));
      if (initial.location?.startsWith('epubcfi(')) await view.init({ lastLocation: initial.location });
      else if (initial.progress) await view.goToFraction(initial.progress);
      else await view.init({ showTextStart: true });
    })();
    return () => {
      closed = true;
      view.close?.();
      view.remove();
      viewRef.current = null;
    };
    // open once per file; later settings changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer?.setStyles) return;
    view.renderer.setStyles(bookCss(settings));
    view.renderer.style.background = READING_THEMES[settings.theme].background;
    view.renderer.style.setProperty('padding-inline', MARGIN_PX[settings.margin]);
    const contents = (view.renderer as unknown as { getContents?: () => { doc?: Document }[] }).getContents?.() ?? [];
    requestAnimationFrame(() => contents.forEach((c) => c.doc && refits.get(c.doc)?.()));  // a new text size
  }, [settings]);

  // Left/right follow the screen (the book's direction decides which is forward); PageDown/Space always go on
  const onKey = (e: KeyboardEvent) => {
    if (!activeRef.current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.isContentEditable || t?.closest?.('input, textarea, select, [role="dialog"]')) return; // typing, a dialog
    const view = viewRef.current;
    if (e.key === 'ArrowLeft') void view?.goLeft();
    else if (e.key === 'ArrowRight') void view?.goRight();
    else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) void view?.prev();
    else if (e.key === 'PageDown' || e.key === ' ') void view?.next();
  };
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Add new highlights, remove deleted ones (before the book is open, create-overlay draws them)
  useEffect(() => {
    const view = viewRef.current;
    const now = new Map(highlights.filter((h) => h.location.startsWith('epubcfi(')).map((h) => [h.location, h.color]));
    if (!view?.book) { drawn.current = now; return; }
    for (const [cfi] of drawn.current) if (!now.has(cfi)) void view.deleteAnnotation({ value: cfi });
    for (const [cfi, color] of now) if (drawn.current.get(cfi) !== color) void view.addAnnotation({ value: cfi, color });
    drawn.current = now;
  }, [highlights]);

  // The underlines follow the looked-up words (and the setting) on the open pages too
  useEffect(() => {
    const contents = (viewRef.current?.renderer as unknown as { getContents?: () => { doc?: Document }[] })?.getContents?.() ?? [];
    for (const c of contents) if (c.doc?.body) markSeen(c.doc, seenWords);
  }, [seenWords]);

  useImperativeHandle(ref, () => ({
    goToToc: (href) => { setCanGoBack(false); void viewRef.current?.goTo(href); },
    goTo: (location, progress) => {
      setCanGoBack(false);
      if (location.startsWith('epubcfi(')) void viewRef.current?.goTo(location);
      else void viewRef.current?.goToFraction(progress);
    },
    currentText: () => {
      const contents = (viewRef.current?.renderer as unknown as { getContents?: () => { doc?: Document }[] })?.getContents?.() ?? [];
      return contents.map((c) => c.doc?.body?.textContent ?? '').join('\n');
    },
  }), []);

  const zone = { position: 'absolute', top: 0, bottom: 0, width: '12%', zIndex: 1, cursor: 'pointer' } as const;
  return (
    <Box sx={{ position: 'relative', height: '100%', bgcolor: READING_THEMES[settings.theme].background }}>
      <div ref={hostRef} style={{ height: '100%' }} />
      {/* tap the page edges to turn pages (the middle stays free for selecting text) */}
      <Box sx={{ ...zone, left: 0 }} onClick={() => void viewRef.current?.goLeft()} aria-label="Previous page" />
      <Box sx={{ ...zone, right: 0 }} onClick={() => void viewRef.current?.goRight()} aria-label="Next page" />
      {canGoBack && (
        <Button variant="contained" size="small" startIcon={<ArrowBackIcon />}
          onClick={() => { setCanGoBack(false); viewRef.current?.history.back(); }}
          sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 2 }}>
          Back
        </Button>
      )}
      <Dialog open={note !== null} onClose={() => setNote(null)} fullWidth maxWidth="sm"
        slotProps={{ paper: { 'aria-label': 'Note', sx: { bgcolor: READING_THEMES[settings.theme].surface,
          color: READING_THEMES[settings.theme].text, backgroundImage: 'none' } } }}>
        <DialogContent onClick={(e) => e.preventDefault()} dangerouslySetInnerHTML={{ __html: note ?? '' }}
          sx={{ fontFamily: READING_FONT, lineHeight: 1.5, '& p': { my: 1 }, '& a': { color: 'inherit' },
            '& img': { maxWidth: '100%', height: 'auto' } }} />
      </Dialog>
    </Box>
  );
});

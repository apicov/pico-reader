import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Dialog, DialogContent } from '@mui/material';
import 'katex/dist/katex.min.css'; // math in a note's popup (the note is shown in the app's page)
import 'foliate-js/view.js';
import type { FoliateRelocate, FoliateTocItem, FoliateView } from 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { READING_FONT, READING_THEMES } from '@/theme/readingThemes';
import { seenWordRanges } from '@/services/words';
import { highlightColor } from '../highlightColors';
import { tappedImage } from '../images';
import { LinkBackButton } from '../LinkBackButton';
import { openExternal } from '../links';
import { isCfi } from '../locations';
import { watchSelection } from '../selection';
import type { TocItem, ViewHandle, ViewProps } from '../types';
import { bookCss, MARGIN_PX } from './bookCss';
import { fitDisplayMath, refitDisplayMath } from './math';
import { asElement, hiddenNote, isNoteRef, noteHtml } from './notes';

/** foliate's page layout: a column at most this wide, this much space above and below, this gap between columns */
const PAGE = { maxInlineSize: '720px', margin: '40px', gap: '6%' };

/** Underline the looked-up words (a CSS highlight: the DOM stays as it is, so EPUB positions don't move).
 *  WebViews without the Custom Highlight API (Chromium < 105) show no underlines. */
function markSeen(doc: Document, words: Set<string> | null) {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const registry = win?.CSS?.highlights;
  if (!win || !registry) return;
  if (words?.size) registry.set('seen', new win.Highlight(...seenWordRanges(doc.body, words)));
  else registry.delete('seen');
}

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
  // Left/right follow the screen (the book's direction decides which is forward); PageDown/Space always go on.
  // One function for the page and every section (keys in a section don't reach the page); it reads only refs.
  const onKey = useRef((e: KeyboardEvent) => {
    if (!activeRef.current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.isContentEditable || t?.closest?.('input, textarea, select, [role="dialog"]')) return; // typing, a dialog
    const view = viewRef.current;
    if (e.key === 'ArrowLeft') void view?.goLeft();
    else if (e.key === 'ArrowRight') void view?.goRight();
    else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) void view?.prev();
    else if (e.key === 'PageDown' || e.key === ' ') void view?.next();
  }).current;
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
    // per section: what stops its observers and timers, when the view closes or foliate has dropped the section
    const stops = new Map<Document, (() => void)[]>();
    const stop = (doc: Document) => { stops.get(doc)?.forEach((f) => f()); stops.delete(doc); };

    view.addEventListener('relocate', (e) => {
      const d = (e as CustomEvent<FoliateRelocate>).detail;
      fraction.current = d.fraction;
      callbacks.current.onLocation(d.cfi, d.fraction);
      callbacks.current.onCurrentToc(d.tocItem?.href ?? null);
    });
    view.addEventListener('external-link', (e) => {
      e.preventDefault();
      openExternal((e as CustomEvent<{ href: string }>).detail.href);
    });
    view.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
      if (!doc.documentElement.lang) doc.documentElement.lang = language;
      sectionOf.set(doc, index);
      for (const old of stops.keys()) if (!old.defaultView) stop(old);
      doc.addEventListener('keydown', onKey);
      doc.addEventListener('click', (ev) => {
        const src = tappedImage(ev.target);
        if (src && !doc.getSelection()?.toString()) callbacks.current.onImage?.(src);
      });
      markSeen(doc, seenRef.current);
      const stopFitting = fitDisplayMath(doc);
      // the selection, with its CFI (for highlights)
      const stopWatching = watchSelection(doc, (sel) => {
        const s = doc.getSelection();
        if (sel && s?.rangeCount) {
          try {
            sel.anchor = { location: view.getCFI(index, s.getRangeAt(0)), progress: fraction.current };
          } catch { /* no CFI: the selection can still be looked up and translated */ }
        }
        callbacks.current.onSelection(sel);
      });
      stops.set(doc, [stopFitting, stopWatching]);
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
        if (isCfi(h.location)) void view.addAnnotation({ value: h.location, color: h.color });
      }
    });
    view.addEventListener('draw-annotation', (e) => {
      const { draw, annotation } = (e as CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color?: string } }>).detail;
      draw(Overlayer.highlight, { color: highlightColor(annotation.color ?? 'yellow') });
    });

    void (async () => {
      // foliate tells formats apart by file name and type
      await view.open(new File([blob], 'book.epub', { type: 'application/epub+zip' }));
      if (closed) return;
      const s = settingsRef.current;
      view.renderer.setAttribute('flow', 'paginated');
      view.renderer.setAttribute('max-inline-size', PAGE.maxInlineSize);
      view.renderer.setAttribute('margin', PAGE.margin);
      view.renderer.setAttribute('gap', PAGE.gap);
      view.renderer.style.setProperty('padding-inline', MARGIN_PX[s.margin]);
      view.renderer.setStyles?.(bookCss(s));
      view.renderer.style.background = READING_THEMES[s.theme].background;
      callbacks.current.onToc(flatten(view.book.toc));
      if (isCfi(initial.location)) await view.init({ lastLocation: initial.location });
      else if (initial.progress) await view.goToFraction(initial.progress);
      else await view.init({ showTextStart: true });
    })();
    return () => {
      closed = true;
      [...stops.keys()].forEach(stop);
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
    const contents = view.renderer.getContents?.() ?? [];
    requestAnimationFrame(() => contents.forEach((c) => c.doc && refitDisplayMath(c.doc)));  // a new text size
  }, [settings]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  // Add new highlights, remove deleted ones (before the book is open, create-overlay draws them)
  useEffect(() => {
    const view = viewRef.current;
    const now = new Map(highlights.filter((h) => isCfi(h.location)).map((h) => [h.location, h.color]));
    if (!view?.book) { drawn.current = now; return; }
    for (const [cfi] of drawn.current) if (!now.has(cfi)) void view.deleteAnnotation({ value: cfi });
    for (const [cfi, color] of now) if (drawn.current.get(cfi) !== color) void view.addAnnotation({ value: cfi, color });
    drawn.current = now;
  }, [highlights]);

  // The underlines follow the looked-up words (and the setting) on the open pages too
  useEffect(() => {
    for (const c of viewRef.current?.renderer?.getContents?.() ?? []) if (c.doc?.body) markSeen(c.doc, seenWords);
  }, [seenWords]);

  useImperativeHandle(ref, () => ({
    goToToc: (href) => { setCanGoBack(false); void viewRef.current?.goTo(href); },
    goTo: (location, progress) => {
      setCanGoBack(false);
      if (isCfi(location)) void viewRef.current?.goTo(location);
      else void viewRef.current?.goToFraction(progress);
    },
    currentText: () => {
      const contents = viewRef.current?.renderer?.getContents?.() ?? [];
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
        <LinkBackButton onClick={() => { setCanGoBack(false); viewRef.current?.history.back(); }}
          sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 2 }} />
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

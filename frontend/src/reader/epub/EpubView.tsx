import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Box } from '@mui/material';
import 'foliate-js/view.js';
import type { FoliateRelocate, FoliateTocItem, FoliateView } from 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { READING_FONT, READING_THEMES } from '@/theme/readingThemes';
import type { Settings } from '@/contexts/SettingsContext';
import type { TocItem, ViewHandle, ViewProps } from '../types';
import { watchSelection } from '../selection';
import { markSeenWords } from '@/services/words';

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
    html { color-scheme: ${c.mode}; --theme-bg-color: ${c.background}; background: ${c.background} !important; }
    body { background: transparent !important; color: ${c.text} !important; font-size: ${18 * s.fontScale}px !important; }
    /* the reading font and colours win over the book's own (dark themes need it), except for code */
    body, body * { font-family: ${READING_FONT} !important; }
    pre, code, kbd, samp, pre *, code * { font-family: ui-monospace, monospace !important; }
    body *:not(a) { color: inherit !important; }
    p, li, blockquote, dd { line-height: ${s.lineHeight} !important; text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    a:link { color: ${c.accent} !important; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    ${c.mode === 'dark' ? 'img { filter: brightness(0.9); }' : ''}
.seen { text-decoration: underline dotted ${c.accent}; text-underline-offset: 3px; text-decoration-thickness: 1.5px; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

const HIGHLIGHT_COLORS: Record<string, string> = { yellow: 'rgba(255, 210, 0, 0.45)', green: 'rgba(80, 200, 120, 0.4)', blue: 'rgba(80, 150, 255, 0.38)' };

const MARGIN_PX = { narrow: '0px', normal: '8px', wide: '32px' } as const;

function flatten(items: FoliateTocItem[] | undefined, depth = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    out.push({ id: item.href, label: item.label.trim(), depth });
    flatten(item.subitems, depth + 1, out);
  }
  return out;
}

/** EPUB in pages (foliate-js). Location: the EPUB CFI. */
export const EpubView = forwardRef<ViewHandle, ViewProps & { blob: Blob; language: string }>(function EpubView(
  { blob, language, initial, onLocation, onToc, onCurrentToc, onSelection, settings, highlights, seenWords }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const callbacks = useRef({ onLocation, onToc, onCurrentToc, onSelection });
  callbacks.current = { onLocation, onToc, onCurrentToc, onSelection };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const fraction = useRef(0);
  const seenRef = useRef(seenWords);
  seenRef.current = seenWords;
  const drawn = useRef(new Map<string, string>()); // cfi → color

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:100%;height:100%';
    host.append(view);
    viewRef.current = view;
    let closed = false;

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
      doc.addEventListener('keydown', onKey);
      if (seenRef.current) markSeenWords(doc.body, seenRef.current);
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
    // highlights: drawn by foliate's overlayer, again whenever a section is laid out
    view.addEventListener('create-overlay', () => {
      for (const h of highlightsRef.current) void view.addAnnotation({ value: h.location, color: h.color });
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
  }, [settings]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') void viewRef.current?.goLeft();
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') void viewRef.current?.goRight();
  };
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Add new highlights, remove deleted ones
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.book) return;
    const now = new Map(highlights.filter((h) => h.location.startsWith('epubcfi(')).map((h) => [h.location, h.color]));
    for (const [cfi] of drawn.current) if (!now.has(cfi)) void view.deleteAnnotation({ value: cfi });
    for (const [cfi, color] of now) if (drawn.current.get(cfi) !== color) void view.addAnnotation({ value: cfi, color });
    drawn.current = now;
  }, [highlights]);

  useImperativeHandle(ref, () => ({
    goToToc: (href) => void viewRef.current?.goTo(href),
    goTo: (location, progress) => {
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
    </Box>
  );
});

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Box } from '@mui/material';
import 'foliate-js/view.js';
import type { FoliateRelocate, FoliateTocItem, FoliateView } from 'foliate-js/view.js';
import { READING_FONT, READING_THEMES } from '@/theme/readingThemes';
import type { Settings } from '@/contexts/SettingsContext';
import type { TocItem, ViewHandle, ViewProps } from '../types';

/** The book's text styled by the reading settings (foliate injects this into each section). */
function bookCss(s: Settings): string {
  const c = READING_THEMES[s.theme];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${c.mode}; }
    html, body { background: ${c.background} !important; color: ${c.text} !important; }
    body { font-family: ${READING_FONT} !important; font-size: ${18 * s.fontScale}px !important; }
    p, li, blockquote, dd { line-height: ${s.lineHeight} !important; text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    a:link { color: ${c.accent} !important; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    ${c.mode === 'dark' ? 'img { filter: brightness(0.9); }' : ''}
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

const MARGIN_PX = { narrow: '16px', normal: '32px', wide: '56px' } as const;

function flatten(items: FoliateTocItem[] | undefined, depth = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    out.push({ id: item.href, label: item.label.trim(), depth });
    flatten(item.subitems, depth + 1, out);
  }
  return out;
}

/** EPUB in pages (foliate-js). Location: the EPUB CFI. */
export const EpubView = forwardRef<ViewHandle, ViewProps & { blob: Blob; language: string }>(function EpubView(
  { blob, language, initial, onLocation, onToc, onCurrentToc, settings }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const callbacks = useRef({ onLocation, onToc, onCurrentToc });
  callbacks.current = { onLocation, onToc, onCurrentToc };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      callbacks.current.onLocation(d.cfi, d.fraction);
      callbacks.current.onCurrentToc(d.tocItem?.href ?? null);
    });
    view.addEventListener('external-link', (e) => {
      e.preventDefault();
      window.open((e as CustomEvent<{ href: string }>).detail.href, '_blank', 'noopener');
    });
    view.addEventListener('load', (e) => {
      const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
      if (!doc.documentElement.lang) doc.documentElement.lang = language;
      doc.addEventListener('keydown', onKey);
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

  useImperativeHandle(ref, () => ({ goToToc: (href) => void viewRef.current?.goTo(href) }), []);

  const zone = { position: 'absolute', top: 0, bottom: 0, width: '12%', zIndex: 1, cursor: 'pointer' } as const;
  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <div ref={hostRef} style={{ height: '100%' }} />
      {/* tap the page edges to turn pages (the middle stays free for selecting text) */}
      <Box sx={{ ...zone, left: 0 }} onClick={() => void viewRef.current?.goLeft()} aria-label="Previous page" />
      <Box sx={{ ...zone, right: 0 }} onClick={() => void viewRef.current?.goRight()} aria-label="Next page" />
    </Box>
  );
});

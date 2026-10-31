import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import { HIGHLIGHT_CLASSES } from '../highlightColors';
import { markSpans, type PageHighlight } from './markSpans';
import type { Dest } from './outline';

const MAX_CANVAS_PIXELS = 12_000_000; // mobile WebViews refuse bigger canvases

export interface Size { w: number; h: number }

/** A link on a page: where (CSS px on the page) and to what (a web address, or a place in the PDF) */
export interface PageLink { left: number; top: number; width: number; height: number; url?: string; dest?: Dest }

/** One page: drawn (canvas), its text selectable over it (pdf.js text layer, with the highlights), its links;
 *  only while `visible` (near the screen), else an empty box of its size. */
export function PdfPage({ doc, index, size, scale, visible, highlights, onLink }: {
  doc: PDFDocumentProxy; index: number; size: Size; scale: number; visible: boolean;
  highlights: PageHighlight[]; onLink: (link: PageLink) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

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
          url: a.url as string | undefined, dest: a.dest as Dest };
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

  const highlightKey = highlights.map((h) => `${h.color}:${h.fraction}:${h.text}`).join('\u0000');
  useEffect(() => {
    const layer = textRef.current;
    if (!layer || !visible) return;
    layer.querySelectorAll('.hl').forEach((el) => el.classList.remove(...HIGHLIGHT_CLASSES));
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

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box, Button, Stack } from '@mui/material';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './reflow.css';
import { resolvePath, type ReflowBundle } from './bundle';
import { watchSelection, type TextSelection } from '../selection';
import { markHighlights } from '../highlightText';
import { tappedImage } from '../images';
import { markSeenWords } from '@/services/words';

export interface ReflowTarget {
  chapter: number;
  fraction?: number; // 0..1 down the chapter
  anchor?: string; // element id
}

interface Props {
  bundle: ReflowBundle;
  target: ReflowTarget;
  onNavigate: (target: ReflowTarget) => void;
  /** Called while reading: chapter, fraction down the chapter */
  onScroll: (chapter: number, fraction: number) => void;
  onSelection: (selection: TextSelection | null) => void;
  onImage?: (image: { src: string; alt: string }) => void;
  /** Highlights of this chapter; fraction = where in the chapter it was made */
  highlights: { id: string; text: string; fraction: number; color: string }[];
  seenWords: Set<string> | null;
  style: React.CSSProperties; // CSS variables from the reading settings
  justify: boolean;
  dark: boolean;
}

function renderMath(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('span.math').forEach((el) => {
    // pandoc's other math methods wrap the TeX in \( \) or \[ \]
    const tex = (el.textContent ?? '').trim().replace(/^\\[([]/, '').replace(/\\[)\]]$/, '');
    try {
      katex.render(tex, el, { displayMode: el.classList.contains('display'), throwOnError: false, output: 'html' });
    } catch {
      // leave the TeX as text
    }
  });
}

/** The book's own CSS (book.json "styles"), applied while the book is open. */
function useBookStyles(bundle: ReflowBundle, dark: boolean) {
  useEffect(() => {
    const names = (bundle.meta.styles ?? []).filter((n) => n !== 'book-dark.css' || dark);
    const els = names.map((n) => {
      const el = document.createElement('style');
      el.textContent = bundle.text(n) ?? '';
      document.head.appendChild(el);
      return el;
    });
    return () => els.forEach((el) => el.remove());
  }, [bundle, dark]);
}

export function ReflowReader({ bundle, target, onNavigate, onScroll, onSelection, onImage, highlights, seenWords, style, justify, dark }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chapters = bundle.meta.chapters;
  const html = useMemo(() => bundle.chapterHtml(target.chapter), [bundle, target.chapter]);
  useBookStyles(bundle, dark);

  // Put the chapter in, typeset its math, then go to the target place in it
  useLayoutEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    content.innerHTML = html;
    renderMath(content);
    content.querySelectorAll<HTMLAnchorElement>('a[href^="file:"]').forEach((a) => a.classList.add('disabled-link'));
    markHighlights(content, highlights);
    if (seenWords) markSeenWords(content, seenWords);
  }, [html, highlights, seenWords]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const go = () => {
      if (target.anchor) {
        const el = contentRef.current?.querySelector(`[id="${CSS.escape(target.anchor)}"]`);
        if (el) { el.scrollIntoView({ block: 'start' }); return; }
      }
      scroller.scrollTop = (target.fraction ?? 0) * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    };
    go();
    // images load lazily and change the height: settle the fraction once more
    const t = setTimeout(go, 300);
    return () => clearTimeout(t);
  }, [html, target]);

  // Report the reading place
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let pending = 0;
    const onScrollEvt = () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        const max = scroller.scrollHeight - scroller.clientHeight;
        onScroll(target.chapter, max > 0 ? scroller.scrollTop / max : 0);
      }, 500);
    };
    scroller.addEventListener('scroll', onScrollEvt, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScrollEvt); clearTimeout(pending); };
  }, [target.chapter, onScroll]);

  // The selection, with where it is in the chapter (for highlights)
  useEffect(() => watchSelection(document, (sel) => {
    const content = contentRef.current;
    const range = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0) : null;
    if (sel && content && range) {
      const box = content.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (range.getBoundingClientRect().top - box.top) / Math.max(1, box.height)));
      const n = chapters.length;
      sel.anchor = { location: `c${target.chapter}:${fraction.toFixed(4)}`, progress: Math.min(1, (target.chapter + fraction) / n) };
    }
    onSelection(sel);
  }, () => contentRef.current), [onSelection, target.chapter, chapters.length]);

  // Pictures open large; links: same-chapter anchors, other chapters, the web
  const onClick = (e: React.MouseEvent) => {
    const image = tappedImage(e.target);
    if (image && onImage && !window.getSelection()?.toString()) {
      e.preventDefault();
      onImage(image);
      return;
    }
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (/^https?:/.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
      return;
    }
    e.preventDefault();
    if (href.startsWith('file:') || !href) return;
    const [path, anchor] = href.split('#');
    if (!path) {
      onNavigate({ chapter: target.chapter, anchor });
      return;
    }
    const index = bundle.chapterIndex(resolvePath(chapters[target.chapter].file, path));
    if (index >= 0) onNavigate({ chapter: index, anchor });
  };

  return (
    <div ref={scrollRef} className="reflow-scroll" style={style}>
      <div ref={contentRef} className={`reflow${justify ? ' justify' : ''}`} lang={bundle.meta.language} onClick={onClick} />
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', maxWidth: 'var(--r-measure)', mx: 'auto',
        px: 'var(--r-margin)', pb: 6 }}>
        <Box>
          {target.chapter > 0 && (
            <Button onClick={() => onNavigate({ chapter: target.chapter - 1, fraction: 0 })}>← {chapters[target.chapter - 1].title}</Button>
          )}
        </Box>
        <Box>
          {target.chapter < chapters.length - 1 && (
            <Button onClick={() => onNavigate({ chapter: target.chapter + 1, fraction: 0 })}>{chapters[target.chapter + 1].title} →</Button>
          )}
        </Box>
      </Stack>
    </div>
  );
}

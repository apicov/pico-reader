import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { ReflowBundle } from './bundle';
import { ReflowReader, type ReflowTarget } from './ReflowReader';
import type { TocItem, ViewHandle, ViewProps } from '../types';

/** Location: `c<chapter>:<fraction down the chapter>` */
function startTarget(bundle: ReflowBundle, initial: ViewProps['initial']): ReflowTarget {
  const m = /^c(\d+):([\d.]+)$/.exec(initial.location ?? '');
  if (m) return { chapter: Math.min(Number(m[1]), bundle.meta.chapters.length - 1), fraction: Number(m[2]) };
  const exact = (initial.progress ?? 0) * bundle.meta.chapters.length;
  const chapter = Math.min(Math.floor(exact), bundle.meta.chapters.length - 1);
  return { chapter, fraction: exact - chapter };
}

export const ReflowView = forwardRef<ViewHandle, ViewProps & { bundle: ReflowBundle }>(function ReflowView(
  { bundle, initial, onLocation, onToc, onCurrentToc, onSelection, settings, vars, dark, highlights }, ref) {
  const [target, setTarget] = useState<ReflowTarget>(() => startTarget(bundle, initial));
  const n = bundle.meta.chapters.length;

  useEffect(() => {
    const items: TocItem[] = [];
    let part = '';
    bundle.meta.chapters.forEach((c, i) => {
      if (c.part && c.part !== part) items.push({ id: `part:${i}`, label: c.part, depth: 0, header: true });
      part = c.part;
      items.push({ id: `c${i}`, label: c.title, depth: 0 });
    });
    onToc(items);
  }, [bundle, onToc]);

  useEffect(() => onCurrentToc(`c${target.chapter}`), [target.chapter, onCurrentToc]);

  const onScroll = useCallback((chapter: number, fraction: number) => {
    onLocation(`c${chapter}:${fraction.toFixed(4)}`, Math.min(1, (chapter + fraction) / n));
  }, [onLocation, n]);

  const navigate = useCallback((t: ReflowTarget) => {
    setTarget(t);
    onScroll(t.chapter, t.fraction ?? 0);
  }, [onScroll]);

  useImperativeHandle(ref, () => ({
    goToToc: (id) => { const m = /^c(\d+)$/.exec(id); if (m) navigate({ chapter: Number(m[1]), fraction: 0 }); },
    goTo: (location, progress) => navigate(startTarget(bundle, { location, progress })),
  }), [navigate, bundle]);

  const chapterHighlights = useMemo(() => highlights.flatMap((h) => {
    const m = /^c(\d+):([\d.]+)$/.exec(h.location);
    return m && Number(m[1]) === target.chapter ? [{ id: h.id, text: h.text, fraction: Number(m[2]), color: h.color }] : [];
  }), [highlights, target.chapter]);

  return <ReflowReader bundle={bundle} target={target} onNavigate={navigate} onScroll={onScroll}
    onSelection={onSelection} highlights={chapterHighlights} style={vars} justify={settings.justify} dark={dark} />;
});

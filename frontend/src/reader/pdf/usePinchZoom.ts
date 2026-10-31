import { useEffect, type RefObject } from 'react';

/** Pinch to zoom: `inner` is scaled while the fingers move (cheap), and `setZoom` gets the new zoom once at the end
 *  (the pages render again then), kept within `min`..`max`. */
export function usePinchZoom(scrollRef: RefObject<HTMLElement | null>, innerRef: RefObject<HTMLElement | null>,
                             zoom: number, setZoom: (change: (zoom: number) => number) => void, min: number, max: number) {
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    let startDist = 0;
    let ratio = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) { startDist = dist(e.touches); ratio = 1; } };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      ratio = Math.max(min / zoom, Math.min(max / zoom, dist(e.touches) / startDist));
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
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
    };
  }, [scrollRef, innerRef, zoom, setZoom, min, max]);
}

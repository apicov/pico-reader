import { useEffect, useRef, type RefObject } from 'react';

/** Calls `report` at most every `ms` while `ref`'s element scrolls (the reading place, saved as it changes).
 *  The latest `report` is used; a new one doesn't restart the timer. */
export function useThrottledScroll(ref: RefObject<HTMLElement | null>, ms: number, report: (el: HTMLElement) => void,
                                   enabled = true) {
  const latest = useRef(report);
  latest.current = report;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let timer = 0;
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => { timer = 0; latest.current(el); }, ms);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, [ref, ms, enabled]);
}

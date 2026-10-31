import { useCallback, useEffect, useRef } from 'react';
import { flushEvents, saveSession, SessionTracker } from '@/services/events';
import type { BookFormat } from '@/services/types';

const SAVE_EVERY_MS = 15_000;

/** Reading time for the statistics: a session per stretch of reading, only while the book is shown. Returns what
 *  the view calls on each sign of reading (a scroll, a page turn, a selection); the session is saved as it grows. */
export function useReadingSession(bookId: string | undefined, format: BookFormat | null, active: boolean) {
  const tracker = useRef<SessionTracker | null>(null);
  useEffect(() => {
    if (!bookId || !format || !active) return;
    const t = new SessionTracker(bookId, format);
    tracker.current = t;
    const finish = () => { const s = t.end(); if (s) void saveSession(s).then(() => flushEvents().catch(() => undefined)); };
    const onVisibility = () => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); finish(); tracker.current = null; };
  }, [bookId, format, active]);

  const lastSave = useRef(0);
  return useCallback((progress?: number) => {
    const s = tracker.current?.activity(progress);
    if (s && Date.now() - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = Date.now();
      void saveSession(s);
    }
  }, []);
}

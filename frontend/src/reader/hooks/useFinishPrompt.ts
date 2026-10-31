import { useCallback, useRef, useState } from 'react';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

const FINISHED = 0.98; // this far through counts as the end

/** Reaching the end of a book that wasn't finished when it was opened: offer to rate it (once per book).
 *  `check` gets every new progress. */
export function useFinishPrompt(bookId: string | undefined) {
  const [open, setOpen] = useState(false);
  const startProgress = useRef<number | null>(null);
  const check = useCallback((progress: number) => {
    if (!bookId) return;
    if (startProgress.current === null) {
      startProgress.current = progress;
      return;
    }
    if (progress < FINISHED || startProgress.current >= FINISHED) return;
    startProgress.current = 1;
    const key = `rate_prompted_${bookId}`;
    void getPref<boolean>(key).then((asked) => {
      if (!asked && isOnline()) { setOpen(true); void setPref(key, true); }
    });
  }, [bookId]);
  return { open, close: () => setOpen(false), check };
}

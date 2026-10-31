import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookFormat } from '@/services/types';
import { flushPositions, savePosition, type Position } from '../position';

const SYNC_EVERY_MS = 15_000;

/** The reading place: kept on the device at once, sent to the server every so often and when the book closes.
 *  `report` is what the view calls; `onMove` also gets the progress (reading time, the end of the book). */
export function usePlace(bookId: string | undefined, format: BookFormat | null, onMove: (progress: number) => void) {
  const [place, setPlace] = useState<{ location: string; progress: number } | null>(null);
  // the latest place, also of a format left since (a format opened next starts at its progress)
  const last = useRef<Position | null>(null);
  const lastSync = useRef(0);

  const report = useCallback((location: string, progress: number) => {
    if (!bookId || !format) return;
    onMove(progress);
    const pos = { book_id: bookId, format, location, progress };
    setPlace({ location, progress });
    last.current = { ...pos, updated_at: new Date().toISOString() };
    void savePosition(pos).then(() => {
      if (Date.now() - lastSync.current > SYNC_EVERY_MS) {
        lastSync.current = Date.now();
        void flushPositions().catch(() => undefined);
      }
    });
  }, [bookId, format, onMove]);

  useEffect(() => () => { void flushPositions().catch(() => undefined); }, []);
  return { place, last, report };
}

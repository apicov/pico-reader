import { useEffect, useRef, useState } from 'react';
import { ensureFile, fileBlob, isCached } from '@/services/bookCache';
import type { Book, BookFormat } from '@/services/types';
import { FORMATS } from '../formats';
import { OPEN, type OpenedBook } from '../formatViews';

/** Where a view opens: a location it wrote, or (from another format) only the progress */
export type Initial = { location?: string; progress?: number };

export type Phase = { kind: 'loading' } | { kind: 'downloading'; fraction: number } | { kind: 'error'; message: string }
  | { kind: 'ready'; opened: OpenedBook; initial: Initial };

async function download(book: Book, format: BookFormat, online: boolean, onProgress: (fraction: number) => void): Promise<Blob> {
  if (!(await isCached(book.id, format, book.formats[format]!)) && !online) {
    throw new Error(`The ${FORMATS[format].label} version isn't on this device yet; open it once while online.`);
  }
  await ensureFile(book, format, onProgress);
  return fileBlob(book.id, format);
}

/** Downloads the format if needed and opens it, at the place `startAt` gives once it's open. Opened once per book and
 *  format: a change of connection or of `startAt` doesn't open it again. */
export function useOpenedBook(book: Book | undefined, format: BookFormat | null, online: boolean,
                              startAt: (format: BookFormat) => Promise<Initial>): Phase {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const latest = useRef({ book, online, startAt });
  latest.current = { book, online, startAt };
  const bookId = book?.id;

  useEffect(() => {
    const { book, online, startAt } = latest.current;
    if (!book || !format) return;
    let cancelled = false;
    let opened: OpenedBook | null = null;
    setPhase({ kind: 'loading' });
    void (async () => {
      try {
        const file = await download(book, format, online, (fraction) => !cancelled && setPhase({ kind: 'downloading', fraction }));
        opened = await OPEN[format](file, book);
        const initial = await startAt(format);
        if (!cancelled) setPhase({ kind: 'ready', opened, initial });
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [bookId, format]);

  return phase;
}

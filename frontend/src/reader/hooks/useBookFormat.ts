import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPref, setPref } from '@/services/prefs';
import type { Book, BookFormat } from '@/services/types';
import { FORMAT_PREFERENCE } from '../formats';

const formatKey = (bookId: string) => `format:${bookId}`;

/** The format the book is read in: `asked` (a link to a place in it), else the last one the reader chose for this
 *  book, else the best it has. `choose` is the reader's choice (remembered); `openIn` opens another format without
 *  remembering it (to show a highlight made there). */
export function useBookFormat(book: Book | undefined, asked: BookFormat | null) {
  const formats = useMemo(() => FORMAT_PREFERENCE.filter((f) => book?.formats[f]), [book]);
  const [format, setFormat] = useState<BookFormat | null>(null);

  useEffect(() => {
    if (!book || format) return;
    if (asked && book.formats[asked]) {
      setFormat(asked);
      return;
    }
    void getPref<BookFormat>(formatKey(book.id)).then((saved) =>
      setFormat(saved && book.formats[saved] ? saved : formats[0] ?? null));
  }, [book, format, formats, asked]);

  const choose = useCallback((f: BookFormat) => {
    if (!book || f === format) return;
    void setPref(formatKey(book.id), f);
    setFormat(f);
  }, [book, format]);

  return { formats, format, choose, openIn: setFormat };
}

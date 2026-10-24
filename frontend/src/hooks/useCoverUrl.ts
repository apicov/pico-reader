import { useEffect, useState } from 'react';
import { ensureCover, fileUrl } from '@/services/bookCache';
import type { CachedFile } from '@/services/bookCache';
import type { Book } from '@/services/types';

/** The cover from the device; fetched into the cache the first time it's shown online. */
export function useCoverUrl(book: Book, cached: CachedFile | undefined, online: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  const current = cached && book.cover && cached.sha256 === book.cover.sha256;
  useEffect(() => {
    let cancelled = false;
    if (current) void fileUrl(book.id, 'cover').then((u) => !cancelled && setUrl(u)).catch(() => undefined);
    else if (book.cover && online) void ensureCover(book).catch(() => undefined);
    return () => { cancelled = true; };
  }, [book, current, online]);
  return url;
}

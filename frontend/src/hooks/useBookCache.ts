import { useEffect, useState } from 'react';
import { cachedFiles, subscribeCache, type CachedFile } from '@/services/bookCache';

/** What is on this device, keyed `${bookId}/${kind}`; re-renders after downloads and removals. */
export function useBookCache(): Record<string, CachedFile> {
  const [files, setFiles] = useState<Record<string, CachedFile>>({});
  useEffect(() => {
    const load = () => void cachedFiles().then((list) =>
      setFiles(Object.fromEntries(list.map((f) => [`${f.bookId}/${f.kind}`, f]))));
    load();
    return subscribeCache(load);
  }, []);
  return files;
}

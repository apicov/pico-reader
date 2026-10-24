import { useCallback, useEffect, useState } from 'react';
import { cachedLibrary, fetchLibrary } from '@/services/library';
import type { Library } from '@/services/types';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** Shows the cached library at once, then refreshes it from the server when online. */
export function useLibrary() {
  const online = useOnlineStatus();
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setLibrary(await fetchLibrary());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void cachedLibrary().then((cached) => {
      if (cancelled) return;
      if (cached) setLibrary(cached);
      if (online) void refresh();
      else setLoading(false);
    });
    return () => { cancelled = true; };
  }, [online, refresh]);

  return { library, loading, error, refresh };
}

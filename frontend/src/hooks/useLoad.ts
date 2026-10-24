import { useCallback, useEffect, useState, type DependencyList } from 'react';

/** Loads something from the server: the data, an error message, and reload() (also used after changes). */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    setError('');
    return run().then(setData, (e: Error) => setError(e.message));
  }, [run]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  return { data, setData, error, reload };
}

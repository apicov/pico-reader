import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';

const POLL_EVERY_MS = 15_000;

/** The server's background jobs at `path` (books being indexed, dictionaries being converted), polled while any
 *  is waiting or running; `onFinished` when one finishes. `path` null: not polled (offline, not allowed).
 *  `pollNow` starts again at once (after queuing one). */
export function usePolledJobs<J extends { status: string }>(path: string | null, onFinished: () => void) {
  const [jobs, setJobs] = useState<J[]>([]);
  const [round, setRound] = useState(0);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    if (!path) return;
    let timer = 0;
    let cancelled = false;
    let waiting = 0;
    const poll = () => void api<J[]>(path).then((list) => {
      if (cancelled) return;
      const busy = list.filter((j) => j.status !== 'failed').length;
      if (busy < waiting) finished.current();
      waiting = busy;
      setJobs(list);
      if (busy) timer = window.setTimeout(poll, POLL_EVERY_MS);
    }).catch(() => undefined);
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [path, round]);

  return { jobs, pollNow: useCallback(() => setRound((r) => r + 1), []) };
}

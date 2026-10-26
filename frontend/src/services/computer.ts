/** Sending things to the reader's study computer: they wait on the server until the desktop tool there
 *  (`reader sync`) writes them into its inbox folder. Made offline too: queued here, sent when online. */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import { dropRejected, rejectedForGood } from '@/services/syncQueue';

export interface Drop {
  kind: 'highlight' | 'snippet' | 'note' | 'text';
  title?: string;
  language?: string; // a snippet's programming language
  body: string;
  meta?: { book_id?: string; book_title?: string; heading?: string; location?: string; progress?: number };
  project_id?: string | null; // into that project's inbox/ instead of ~/pico/inbox
}

export interface ComputerStatus {
  seen_at: string | null; // when the computer last synced; null: never
  waiting: number;
}

const PENDING = 'computer_pending';
const MAX_BODY = 200_000; // what the server takes

let flushing: Promise<void> | null = null;

/** Send what's queued, in order (one flush at a time). */
export function flushComputer(): Promise<void> {
  if (!isOnline()) return Promise.resolve();
  flushing ??= (async () => {
    try {
      for (;;) {
        const queue = (await getPref<(Drop & { id: string })[]>(PENDING)) ?? [];
        if (!queue.length) return;
        await api('/api/drops', { method: 'POST', body: queue[0] }).catch((e) => {
          if (!rejectedForGood(e)) throw e;
          dropRejected('item for the computer', queue[0].id, e);
        });
        await setPref(PENDING, ((await getPref<(Drop & { id: string })[]>(PENDING)) ?? []).slice(1));
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** 'sent' when it reached the server, 'queued' when it waits for a connection */
export async function sendToComputer(d: Drop): Promise<'sent' | 'queued'> {
  const item = { ...d, body: d.body.slice(0, MAX_BODY), title: d.title?.slice(0, 200), id: `drop-${crypto.randomUUID()}` };
  await setPref(PENDING, [...((await getPref<(Drop & { id: string })[]>(PENDING)) ?? []), item]);
  if (!isOnline()) return 'queued';
  try {
    await flushComputer();
  } catch {
    return 'queued';
  }
  return ((await getPref<unknown[]>(PENDING)) ?? []).length ? 'queued' : 'sent';
}

export async function computerStatus(): Promise<ComputerStatus> {
  return api<ComputerStatus>('/api/computer');
}

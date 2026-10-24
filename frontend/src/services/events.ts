/**
 * Reading sessions and dictionary lookups for the statistics: recorded on the device (offline too), sent in
 * batches when online. The server upserts by id, so sending again after a lost reply is harmless.
 */
import Dexie, { type Table } from 'dexie';
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';

export interface ReadingSession {
  id: string;
  book_id: string;
  format: string;
  started_at: string;
  ended_at: string;
  seconds: number;
  progress_start: number;
  progress_end: number;
  sent: 0 | 1;
}

export interface LookupEvent {
  id: string;
  book_id: string | null;
  language: string;
  word: string;
  matched: string;
  dictionaries: string[];
  found: boolean;
  location: string;
  context: string; // the sentence it was in
  created_at: string;
}

class EventsDb extends Dexie {
  sessions!: Table<ReadingSession, string>;
  lookups!: Table<LookupEvent, string>;
  constructor() {
    super('pico-reader-events');
    this.version(1).stores({ sessions: 'id, sent, ended_at', lookups: 'id' });
  }
}

const db = new EventsDb();
const KEEP_SENT_DAYS = 30;

export async function saveSession(s: Omit<ReadingSession, 'sent'>): Promise<void> {
  await db.sessions.put({ ...s, sent: 0 });
}

export async function recordLookup(l: Omit<LookupEvent, 'id' | 'created_at'>): Promise<void> {
  await db.lookups.put({ ...l, id: crypto.randomUUID(), created_at: new Date().toISOString() });
}

let flushing: Promise<void> | null = null;

/** Send what hasn't been sent (one flush at a time). */
export function flushEvents(): Promise<void> {
  if (!isOnline()) return Promise.resolve();
  flushing ??= (async () => {
    try {
      const sessions = await db.sessions.where('sent').equals(0).toArray();
      const lookups = await db.lookups.toArray();
      if (!sessions.length && !lookups.length) return;
      await api('/api/events', {
        method: 'POST',
        body: { sessions: sessions.map(({ sent: _, ...s }) => s), lookups },
      });
      // a session that grew meanwhile stays unsent (its new length goes next time)
      await db.transaction('rw', db.sessions, db.lookups, async () => {
        for (const s of sessions) {
          const now = await db.sessions.get(s.id);
          if (now && now.ended_at === s.ended_at) await db.sessions.update(s.id, { sent: 1 });
        }
        await db.lookups.bulkDelete(lookups.map((l) => l.id));
        const old = new Date(Date.now() - KEEP_SENT_DAYS * 86_400_000).toISOString();
        await db.sessions.where('ended_at').below(old).filter((s) => s.sent === 1).delete();
      });
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Reading time for one book. Time counts between signs of reading (scrolling, page turns, selections), each gap
 * at most `idleMs`: a long look at one page counts, a phone left on the table doesn't. After `breakMs` without
 * reading, or when the app is hidden, the session ends; the next sign of reading starts a new one.
 */
export class SessionTracker {
  private current: Omit<ReadingSession, 'sent'> | null = null;
  private last = 0;
  private activeMs = 0;

  constructor(private bookId: string, private format: string,
              private opts = { idleMs: 120_000, breakMs: 600_000, minMs: 15_000 },
              private now: () => number = () => Date.now(),
              private newId: () => string = () => crypto.randomUUID()) {}

  /** A sign of reading; `progress` (0..1) when the place changed. Returns the session to save, if any. */
  activity(progress?: number): Omit<ReadingSession, 'sent'> | null {
    const t = this.now();
    if (this.current && t - this.last > this.opts.breakMs) this.end();
    if (!this.current) {
      this.current = { id: this.newId(), book_id: this.bookId, format: this.format,
        started_at: new Date(t).toISOString(), ended_at: new Date(t).toISOString(), seconds: 0,
        progress_start: progress ?? 0, progress_end: progress ?? 0 };
      this.activeMs = 0;
      this.last = t;
      return null;
    }
    this.activeMs += Math.min(t - this.last, this.opts.idleMs);
    this.last = t;
    if (progress !== undefined) {
      if (!this.current.progress_start && !this.activeMs) this.current.progress_start = progress;
      this.current.progress_end = progress;
    }
    this.current.ended_at = new Date(t).toISOString();
    this.current.seconds = Math.round(this.activeMs / 1000);
    return this.activeMs >= this.opts.minMs ? { ...this.current } : null;
  }

  /** The app was hidden or the reader closed: the session (if long enough) is final. */
  end(): Omit<ReadingSession, 'sent'> | null {
    const s = this.current && this.activeMs >= this.opts.minMs ? { ...this.current } : null;
    this.current = null;
    this.activeMs = 0;
    return s;
  }
}

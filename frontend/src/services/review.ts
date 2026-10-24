/**
 * Spaced-repetition review of looked-up words and translation vocabulary. Cards are scheduled on the device
 * with FSRS (ts-fsrs) and synced with the server like annotations: own ids, newest edit wins, tombstones.
 */
import Dexie, { type Table } from 'dexie';
import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

export interface ReviewCard {
  id: string;
  language: string;
  term: string;
  meaning: string;
  example: string;
  source: 'lookup' | 'translation' | 'manual';
  book_id: string | null;
  state: Record<string, unknown>; // the FSRS card, dates as ISO strings
  due: string;
  deleted: boolean;
  client_updated_at: string;
  dirty?: 0 | 1;
}

class ReviewDb extends Dexie {
  cards!: Table<ReviewCard, string>;
  constructor() {
    super('pico-reader-review');
    this.version(1).stores({ cards: 'id, language, due, dirty' });
  }
}

const db = new ReviewDb();
const scheduler = fsrs({ enable_fuzz: true });
const CURSOR = 'review_cursor';
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function subscribeReview(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function toFsrs(state: Record<string, unknown>): FsrsCard {
  if (!state || !('stability' in state)) return createEmptyCard(new Date());
  return { ...(state as unknown as FsrsCard), due: new Date(state.due as string),
    last_review: state.last_review ? new Date(state.last_review as string) : undefined };
}

function fromFsrs(card: FsrsCard): Record<string, unknown> {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

async function put(card: ReviewCard): Promise<void> {
  await db.cards.put({ ...card, client_updated_at: new Date().toISOString(), dirty: 1 });
  changed();
  void syncReview().catch(() => undefined);
}

const sameTerm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A new card, unless the term already has one (then nothing changes). Returns whether it was added. */
export async function addCard(c: Pick<ReviewCard, 'language' | 'term' | 'meaning' | 'example' | 'source' | 'book_id'>): Promise<boolean> {
  const existing = await db.cards.where('language').equals(c.language).filter((x) => !x.deleted && sameTerm(x.term, c.term)).first();
  if (existing) return false;
  const fresh = createEmptyCard(new Date());
  await put({ ...c, id: crypto.randomUUID(), state: fromFsrs(fresh), due: fresh.due.toISOString(), deleted: false,
    client_updated_at: '' });
  return true;
}

export async function dueCards(language?: string): Promise<ReviewCard[]> {
  const now = new Date().toISOString();
  return (await db.cards.where('due').belowOrEqual(now).toArray())
    .filter((c) => !c.deleted && (!language || c.language === language))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export async function allCards(): Promise<ReviewCard[]> {
  return (await db.cards.toArray()).filter((c) => !c.deleted);
}

/** When each answer would bring the card back ("10 min", "3 days"…) */
export function previews(card: ReviewCard): Record<Grade, Date> {
  const p = scheduler.repeat(toFsrs(card.state), new Date());
  return { [Rating.Again]: p[Rating.Again].card.due, [Rating.Hard]: p[Rating.Hard].card.due,
    [Rating.Good]: p[Rating.Good].card.due, [Rating.Easy]: p[Rating.Easy].card.due } as Record<Grade, Date>;
}

export async function rate(card: ReviewCard, grade: Grade): Promise<void> {
  const next = scheduler.next(toFsrs(card.state), new Date(), grade).card;
  await put({ ...card, state: fromFsrs(next), due: next.due.toISOString() });
}

export async function deleteCardsFor(language: string, term: string): Promise<void> {
  const cards = await db.cards.where('language').equals(language).filter((c) => !c.deleted && sameTerm(c.term, term)).toArray();
  for (const c of cards) await put({ ...c, deleted: true });
}

let syncing: Promise<void> | null = null;

export function syncReview(): Promise<void> {
  if (!isOnline()) return Promise.resolve();
  syncing ??= (async () => {
    try {
      for (const c of await db.cards.where('dirty').equals(1).toArray()) {
        const { id, dirty: _, ...body } = c;
        const saved = await api<ReviewCard>(`/api/review-cards/${encodeURIComponent(id)}`, { method: 'PUT', body });
        const now = await db.cards.get(id);
        if (now && now.client_updated_at === c.client_updated_at) await db.cards.put({ ...saved, dirty: 0 });
      }
      const cursor = await getPref<string>(CURSOR);
      const res = await api<{ cards: ReviewCard[]; cursor: string | null }>(
        `/api/review-cards${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`);
      for (const remote of res.cards) {
        const local = await db.cards.get(remote.id);
        if (!local || remote.client_updated_at > local.client_updated_at || (!local.dirty && local.client_updated_at <= remote.client_updated_at)) {
          await db.cards.put({ ...remote, dirty: 0 });
        }
      }
      if (res.cursor) await setPref(CURSOR, res.cursor);
      if (res.cards.length) changed();
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export { Rating };

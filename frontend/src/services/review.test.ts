import 'fake-indexeddb/auto';
import { addCard, allCards, deleteCardsFor, dueCards, previews, rate, Rating } from './review';

vi.mock('@/services/api', () => ({ api: vi.fn(async () => { throw new Error('offline in tests'); }) }));

describe('review cards', () => {
  it('adds a card once per term and language, due now', async () => {
    expect(await addCard({ language: 'de', term: 'die Mühe', meaning: 'el esfuerzo', example: 'Sie hatten Mühe.', source: 'lookup', book_id: null })).toBe(true);
    expect(await addCard({ language: 'de', term: 'Die Mühe', meaning: 'x', example: '', source: 'translation', book_id: null })).toBe(false);
    expect((await dueCards('de')).map((c) => c.term)).toEqual(['die Mühe']);
  });

  it('a good answer schedules the card later; again sooner', async () => {
    const [card] = await dueCards('de');
    const p = previews(card);
    expect(p[Rating.Good].getTime()).toBeGreaterThan(p[Rating.Again].getTime());
    await rate(card, Rating.Good);
    expect(await dueCards('de')).toEqual([]);
  });

  it('marking a word known removes its cards', async () => {
    await deleteCardsFor('de', 'DIE MÜHE');
    expect(await allCards()).toEqual([]);
  });
});

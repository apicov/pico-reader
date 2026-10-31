import { addLookedUp, cachedLookedUpWords, markKnown } from './words';

vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async () => null),
}));
vi.mock('@/services/review', () => ({ deleteCardsFor: vi.fn(async () => undefined) }));

describe('markKnown', () => {
  it('takes the word off the looked-up list however its accents were composed', async () => {
    localStorage.clear();
    await addLookedUp('de', ['Mu\u0308he']); // u + combining diaeresis, as some books spell it
    await markKnown('de', 'Mu\u0308he');
    expect([...await cachedLookedUpWords('de')]).toEqual([]);
  });
});

import { addLookedUp, cachedLookedUpWords, markKnown, markSeenWords, seenWordRanges, wordsIn } from './words';

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

describe('markSeenWords', () => {
  it('marks whole words, case-insensitively, not inside code', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Der Wagen und die Wagenfenster.</p><code>Wagen</code>';
    markSeenWords(root, new Set(['wagen']));
    expect([...root.querySelectorAll('.seen')].map((s) => s.textContent)).toEqual(['Wagen']);
    expect(root.textContent).toBe('Der Wagen und die Wagenfenster.Wagen');
  });
});

describe('wordsIn', () => {
  it('counts the looked-up words of a text', () => {
    expect(wordsIn('Mühe, Mühe und Straße. Die Straße.', new Set(['mühe', 'straße', 'haus']))).toEqual([
      { word: 'mühe', count: 2 }, { word: 'straße', count: 2 }]);
  });
});

describe('seenWordRanges', () => {
  it('finds the words as ranges and leaves the DOM as it is, not inside code or math', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Max und <em>max</em>.</p><math><mi>max</mi></math><span class="katex">max</span><code>max</code>';
    const before = root.innerHTML;
    expect(seenWordRanges(root, new Set(['max'])).map((r) => r.toString())).toEqual(['Max', 'max']);
    expect(root.innerHTML).toBe(before);
  });
});

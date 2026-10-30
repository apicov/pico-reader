import { markSeenWords, seenWordRanges, wordsIn } from './words';

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

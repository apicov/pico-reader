import { markSpans } from './markSpans';

/** A text layer as pdf.js makes it: one span per run of a line */
function layer(lines: string[]): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
  return el;
}

const marked = (el: HTMLElement) => [...el.querySelectorAll('span')].map((s) => s.classList.contains('hl'));

describe('markSpans', () => {
  it('marks the occurrence nearest to where the highlight was made', () => {
    const lines = ['the same words', 'something else', 'more text here', 'the same words'];
    const top = layer(lines);
    markSpans(top, [{ text: 'the same words', color: 'yellow', fraction: 0.05 }]);
    expect(marked(top)).toEqual([true, false, false, false]);
    const bottom = layer(lines);
    markSpans(bottom, [{ text: 'the same words', color: 'yellow', fraction: 0.9 }]);
    expect(marked(bottom)).toEqual([false, false, false, true]);
  });

  it('marks text across runs, with the colour', () => {
    const el = layer(['first half', 'second half']);
    markSpans(el, [{ text: 'half second', color: 'green', fraction: 0 }]);
    expect([...el.querySelectorAll('.hl-green')].map((s) => s.textContent)).toEqual(['first half', 'second half']);
  });
});

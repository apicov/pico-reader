import { describe, expect, it } from 'vitest';
import { citeButtons, withSpoilers } from './Markdown';

describe('withSpoilers', () => {
  it('wraps ||text|| in a spoiler span', () => {
    expect(withSpoilers('Uli ||dies|| at the end')).toBe('Uli <span class="spoiler" tabindex="0">dies</span> at the end');
  });
  it('leaves code and lone bars alone', () => {
    expect(withSpoilers('`a || b` and a | b')).toBe('`a || b` and a | b');
    expect(withSpoilers('||one|| and `||two||`')).toBe('<span class="spoiler" tabindex="0">one</span> and `||two||`');
  });
});

describe('citeButtons', () => {
  it('turns [n] into buttons outside code only', () => {
    expect(citeButtons('<p>Small weights [12].</p>')).toBe('<p>Small weights <button type="button" class="cite" data-n="12">12</button>.</p>');
    const diagram = '<pre><code class="language-mermaid">flowchart LR\n  A[1] --> B[2]</code></pre>';
    expect(citeButtons(diagram)).toBe(diagram);
    expect(citeButtons('<p><code>a[1]</code> [1]</p>')).toBe('<p><code>a[1]</code> <button type="button" class="cite" data-n="1">1</button></p>');
  });
});

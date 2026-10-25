import { readSelection } from './selection';

function select(html: string, selector: string) {
  document.body.innerHTML = html;
  const node = document.querySelector(selector)!;
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return readSelection(sel)!;
}

describe('readSelection', () => {
  it('in a code block: keeps lines and indentation, and the language', () => {
    const s = select('<pre class="sourceCode python"><code class="sourceCode python">def f(x):\n    return x * x\n</code></pre>', 'code');
    expect(s.code).toEqual({ text: 'def f(x):\n    return x * x', language: 'python' });
    const md = select('<pre><code class="language-rust">fn main() {}</code></pre>', 'code');
    expect(md.code?.language).toBe('rust');
    const plain = select('<pre>ls -la</pre>', 'pre');
    expect(plain.code).toEqual({ text: 'ls -la', language: '' });
  });

  it('prose and inline code in a sentence are not code blocks', () => {
    expect(select('<p>Der Alarm kam. Am <b>Vormittag</b> war es still.</p>', 'b').code).toBeUndefined();
    expect(select('<p>Call <code>len(x)</code> here.</p>', 'code').code).toBeUndefined();
  });
});

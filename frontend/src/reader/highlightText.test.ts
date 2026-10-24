import { markHighlights } from './highlightText';

describe('markHighlights', () => {
  it('marks text across elements, ignoring whitespace differences', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Sie hatten <em>Mühe</em>,\n die Straße zu überqueren.</p>';
    markHighlights(root, [{ id: 'h1', text: 'hatten Mühe, die Straße', fraction: 0, color: 'yellow' }]);
    const marked = [...root.querySelectorAll('mark')].map((m) => m.textContent).join('');
    expect(marked.replace(/\s+/g, ' ')).toBe('hatten Mühe, die Straße');
    expect(root.textContent).toBe('Sie hatten Mühe,\n die Straße zu überqueren.');
  });

  it('picks the occurrence nearest to where the highlight was made', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>der Wagen</p><p>Mitte</p><p>der Wagen</p>';
    markHighlights(root, [{ id: 'h2', text: 'der Wagen', fraction: 0.9, color: 'yellow' }]);
    expect(root.querySelectorAll('p')[2].querySelector('mark')).not.toBeNull();
    expect(root.querySelectorAll('p')[0].querySelector('mark')).toBeNull();
  });
});

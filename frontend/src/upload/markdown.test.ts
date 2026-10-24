import { markdownToHtml, splitChapters } from './markdown';

describe('markdown → reflow', () => {
  it('keeps math as TeX for KaTeX, untouched by emphasis rules', () => {
    const html = markdownToHtml('Die Größe $a_i * b_i$ ist\n\n$$\\sum_{i=1}^n x_i$$\n\nPreis: 5 $ und 6 $.');
    expect(html).toContain('<span class="math inline">\\(a_i * b_i\\)</span>');
    expect(html).toContain('<span class="math display">\\[\\sum_{i=1}^n x_i\\]</span>');
    expect(html).toContain('5 $ und 6 $');
    expect(html).toContain('Größe');
  });

  it('splits chapters at top-level headings', () => {
    const chapters = splitChapters(markdownToHtml('# Eins\n\nText\n\n# Zwei\n\nMehr'), 'Buch');
    expect(chapters.map((c) => c.title)).toEqual(['Eins', 'Zwei']);
  });
});

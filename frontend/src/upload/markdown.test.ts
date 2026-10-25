import { unzipSync } from 'fflate';
import { buildReflowBundle, cleanMarker, linkAcrossChapters, markdownToHtml, splitChapters } from './markdown';

const para = (n: number, word = 'Text') => Array.from({ length: n }, (_, i) => `${word} ${i} `.repeat(30)).join('\n\n');

describe('markdown → reflow', () => {
  it('keeps math as TeX for KaTeX, untouched by emphasis rules', () => {
    const html = markdownToHtml('Die Größe $a_i * b_i$ ist\n\n$$\\sum_{i=1}^n x_i$$\n\nPreis: 5 $ und 6 $.');
    expect(html).toContain('<span class="math inline">\\(a_i * b_i\\)</span>');
    expect(html).toContain('<span class="math display">\\[\\sum_{i=1}^n x_i\\]</span>');
    expect(html).toContain('5 $ und 6 $');
    expect(html).toContain('Größe');
  });

  it("doesn't let a stray $$ turn the paragraphs after it into one formula", () => {
    const html = markdownToHtml('Costs $$5 here.\n\nNext paragraph.\n\nAnd $$x$$ works.');
    expect(html).toContain('<p>Next paragraph.</p>');
    expect(html).toContain('<span class="math display">\\[x\\]</span>');
  });

  it('splits chapters at top-level headings', () => {
    const chapters = splitChapters(markdownToHtml(`# Eins\n\n${para(3)}\n\n# Zwei\n\n${para(3)}`), 'Buch');
    expect(chapters.map((c) => c.title)).toEqual(['Eins', 'Zwei']);
  });

  it('joins a title page with the chapter after it', () => {
    const chapters = splitChapters(markdownToHtml(`# THE ART OF\n\nVOLUME 4B\n\n# Preface\n\n${para(3)}\n\n# One\n\n${para(3)}`), 'Buch');
    expect(chapters.map((c) => c.title)).toEqual(['THE ART OF', 'One']);
    expect(chapters[0].html).toContain('Preface');
  });

  it('splits a huge chapter at its sections, with the chapter as their part', () => {
    const big = Array.from({ length: 6 }, (_, i) => `## Section ${i}\n\n${para(120)}`).join('\n\n');
    const chapters = splitChapters(markdownToHtml(`# Small\n\n${para(3)}\n\n# Big\n\n${big}`), 'Buch');
    expect(chapters[0]).toMatchObject({ title: 'Small', part: '' });
    expect(chapters.slice(1).map((c) => c.part)).toEqual(Array(chapters.length - 1).fill('Big'));
    expect(chapters.map((c) => c.title)).toContain('Section 3');
    expect(Math.max(...chapters.map((c) => c.html.length))).toBeLessThanOrEqual(130_000);
  });

  it('joins small chapters when headings come every few lines (bold lines marker made headings of)', () => {
    const md = Array.from({ length: 300 }, (_, i) => `# Heading ${i}\n\n${para(2)}`).join('\n\n');
    const chapters = splitChapters(markdownToHtml(md), 'Buch');
    expect(chapters.length).toBeLessThan(60);
    expect(chapters.every((c) => c.html.length <= 31_000)).toBe(true);
    expect(chapters.map((c) => c.html).join('')).toContain('Heading 299');
  });

  it('removes the page lines marker writes between PDF pages', () => {
    expect(markdownToHtml(cleanMarker('Ende der Seite.\n\n{12}------------------------------------------------\n\nNächste.')))
      .toBe('<p>Ende der Seite.</p>\n<p>Nächste.</p>\n');
  });

  it('shows unknown or unclosed tags from the text as text, so they cannot swallow the rest of the book', () => {
    const html = markdownToHtml('<packt>\n\nThe <s> token starts it.\n\n<div> tag (read: container)\n\nUse <sub>2</sub> and <span id="page-3-0"></span>here.\n\n<script>alert(1)</script>');
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    expect([...doc.body.children].map((e) => e.tagName)).toEqual(['P', 'P', 'P', 'P']); // nothing nested in another
    expect(doc.body.textContent).toContain('<packt>');
    expect(doc.body.textContent).toContain('The <s> token');
    expect(doc.body.textContent).toContain('<div> tag');
    expect(doc.querySelector('sub')?.textContent).toBe('2');
    expect(doc.getElementById('page-3-0')).not.toBeNull();
    expect(doc.querySelector('script')).toBeNull();
  });

  it('points links to another chapter at its file', () => {
    const chapters = [{ title: 'A', part: '', html: '<p><a href="#page-9-0">see</a> <a href="#here">here</a><span id="here"></span></p>' },
                      { title: 'B', part: '', html: '<p><span id="page-9-0"></span>Target</p>' }];
    const [a] = linkAcrossChapters(chapters, (i) => `ch${i}.html`);
    expect(a).toContain('href="ch1.html#page-9-0"');
    expect(a).toContain('href="#here"');
  });

  it('bundles the chapters with their parts and the images they use', async () => {
    const big = Array.from({ length: 4 }, (_, i) => `## S${i}\n\n${para(200)}\n\n![](_page_${i}_Figure_1.jpeg)`).join('\n\n');
    const images = new Map([0, 1, 2, 3, 7].map((i) => [`_page_${i}_Figure_1.jpeg`, new Blob([`img${i}`])]));
    const bundle = await buildReflowBundle(`# Intro\n\n${para(3)} [to S2](#s2)\n\n# Main\n\n${big.replace('## S2', '<span id="s2"></span>\n\n## S2')}`,
      images, { title: 'Buch', author: 'A', language: 'de' });
    expect(bundle.images).toBe(4);
    expect(bundle.missing).toEqual([]);
    const files = unzipSync(new Uint8Array(await bundle.zip.arrayBuffer()));
    const meta = JSON.parse(new TextDecoder().decode(files['book.json']));
    expect(meta.chapters[0]).toEqual({ file: 'ch000.html', title: 'Intro', part: '' });
    expect(meta.chapters.slice(1).every((c: { part: string }) => c.part === 'Main')).toBe(true);
    expect(new TextDecoder().decode(files['ch000.html'])).toMatch(/href="ch00\d\.html#s2"/);
    expect(files['_page_7_Figure_1.jpeg']).toBeUndefined(); // not used by the text
  });
});

import { strToU8, zipSync } from 'fflate';
import { ReflowBundle, resolvePath } from './bundle';

function bundleBlob(files: Record<string, string | Uint8Array>): Blob {
  const entries = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(typeof v === 'string' ? strToU8(v) : v)]));
  // fflate tells files from folders with instanceof: keep every array in this realm
  return new Blob([zipSync(entries) as BlobPart]);
}

const META = {
  format: 1, title: 'Der Prozess', author: 'Franz Kafka', language: 'de',
  chapters: [
    { file: 'index.html', title: 'Vorwort', part: '' },
    { file: 'chapters/01.html', title: '1 Verhaftung', part: 'Erster Teil' },
  ],
};

describe('resolvePath', () => {
  it('resolves relative to the chapter file', () => {
    expect(resolvePath('chapters/01.html', '01_files/fig.png')).toBe('chapters/01_files/fig.png');
    expect(resolvePath('chapters/01.html', '../figures/a.png')).toBe('figures/a.png');
    expect(resolvePath('index.html', './chapters/02.html')).toBe('chapters/02.html');
  });
});

describe('ReflowBundle', () => {
  it('reads book.json and keeps umlauts intact', async () => {
    const b = await ReflowBundle.open(bundleBlob({ 'book.json': JSON.stringify(META), 'index.html': '<p>Größe</p>' }));
    expect(b.meta.title).toBe('Der Prozess');
    expect(b.chapterHtml(0)).toContain('Größe');
  });

  it('points images at the bundle and strips scripts', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const b = await ReflowBundle.open(bundleBlob({
      'book.json': JSON.stringify(META),
      'index.html': '',
      'chapters/01.html': '<p onclick="x()">Text</p><img src="../figures/k.png"><script>alert(1)</script>',
      'figures/k.png': png,
    }));
    const html = b.chapterHtml(1);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toMatch(/<img src="blob:/);
  });

  it('finds chapters by file', async () => {
    const b = await ReflowBundle.open(bundleBlob({ 'book.json': JSON.stringify(META) }));
    expect(b.chapterIndex('chapters/01.html')).toBe(1);
    expect(b.chapterIndex('nope.html')).toBe(-1);
  });

  it('refuses a zip without book.json', async () => {
    await expect(ReflowBundle.open(bundleBlob({ 'x.txt': 'x' }))).rejects.toThrow('book.json');
  });
});

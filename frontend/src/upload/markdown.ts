/**
 * Markdown (with its images) → a reflow bundle, on the device: the same layout as the desktop tool's
 * (tools/readertool/markdown.py, there with pandoc): book.json + ch000.html… + images, math kept as TeX in
 * <span class="math inline|display">\( \)</span> for KaTeX, chapters split at # (or ##) headings.
 */
import MarkdownIt from 'markdown-it';
import { strToU8, zipSync } from 'fflate';

const PART_CHARS = 60_000;

/** $$…$$ and $…$ out of markdown-it's way (it would mangle _ and *), back in as math spans afterwards. */
function protectMath(md: string): { text: string; math: string[] } {
  const math: string[] = [];
  const keep = (html: string) => { math.push(html); return `MATHPLACEHOLDER${math.length - 1}X`; };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let text = md.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(`<span class="math display">\\[${esc(tex.trim())}\\]</span>`));
  text = text.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g,
    (_, pre: string, tex: string) => pre + keep(`<span class="math inline">\\(${esc(tex)}\\)</span>`));
  return { text, math };
}

export function markdownToHtml(md: string): string {
  const { text, math } = protectMath(md);
  const html = new MarkdownIt({ html: true, linkify: true }).render(text);
  return html.replace(/MATHPLACEHOLDER(\d+)X/g, (_, i: string) => math[Number(i)]);
}

export function splitChapters(html: string, fallbackTitle: string): { title: string; html: string }[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const nodes = [...doc.body.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
  const outer = (n: ChildNode) => (n instanceof Element ? n.outerHTML : n.textContent ?? '');
  for (const level of ['H1', 'H2']) {
    if (nodes.filter((n) => n instanceof Element && n.tagName === level).length >= 2) {
      const chapters: { title: string; parts: string[] }[] = [{ title: '', parts: [] }];
      for (const n of nodes) {
        if (n instanceof Element && n.tagName === level) chapters.push({ title: (n.textContent ?? '').trim().replace(/\s+/g, ' '), parts: [outer(n)] });
        else chapters[chapters.length - 1].parts.push(outer(n));
      }
      if (!chapters[0].parts.join('').trim()) chapters.shift();
      else if (!chapters[0].title) chapters[0].title = fallbackTitle;
      return chapters.map((c) => ({ title: c.title || fallbackTitle, html: c.parts.join('') }));
    }
  }
  const parts: string[][] = [[]];
  let size = 0;
  for (const n of nodes) {
    const h = outer(n);
    parts[parts.length - 1].push(h);
    size += h.length;
    if (size >= PART_CHARS) { parts.push([]); size = 0; }
  }
  const filled = parts.filter((p) => p.length);
  return filled.map((p, i) => ({ title: filled.length > 1 ? `${fallbackTitle} (${i + 1}/${filled.length})` : fallbackTitle, html: p.join('') }));
}

/** `images`: the files chosen with the Markdown, by their path relative to it (or just their name). */
export async function buildReflowBundle(md: string, images: Map<string, Blob>, meta: { title: string; author: string; language: string }):
  Promise<{ zip: Blob; chapters: number; images: number; missing: string[] }> {
  const html = markdownToHtml(md);
  const chapters = splitChapters(html, meta.title);
  const files: Record<string, Uint8Array> = {
    'book.json': strToU8(JSON.stringify({ format: 1, ...meta,
      chapters: chapters.map((c, i) => ({ file: `ch${String(i).padStart(3, '0')}.html`, title: c.title, part: '' })) }, null, 1)),
  };
  chapters.forEach((c, i) => { files[`ch${String(i).padStart(3, '0')}.html`] = strToU8(c.html); });
  const missing: string[] = [];
  let added = 0;
  for (const src of new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]))) {
    if (/^(data:|https?:|\/\/)/.test(src)) continue;
    const path = decodeURIComponent(src).replace(/^\.\//, '');
    const blob = images.get(path) ?? images.get(path.split('/').pop()!);
    if (!blob) { missing.push(path); continue; }
    files[path] = new Uint8Array(await blob.arrayBuffer());
    added++;
  }
  const zipped = zipSync(files, { level: 6 });
  return { zip: new Blob([zipped as BlobPart], { type: 'application/zip' }), chapters: chapters.length, images: added, missing };
}

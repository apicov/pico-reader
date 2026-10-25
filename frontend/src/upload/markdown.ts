/**
 * Markdown (with its images) → a reflow bundle, on the device: the same layout as the desktop tool's
 * (tools/readertool/markdown.py, there with pandoc): book.json + ch000.html… + images, math kept as TeX in
 * <span class="math inline|display">\( \)</span> for KaTeX, chapters split at # (or ##) headings.
 */
import MarkdownIt from 'markdown-it';
import { strToU8 as encode, zipSync } from 'fflate';

/** As this realm's Uint8Array (in tests TextEncoder's comes from another, which fflate would take for a folder). */
const strToU8 = (s: string) => new Uint8Array(encode(s));

const PART_CHARS = 60_000;

/** $$…$$ and $…$ out of markdown-it's way (it would mangle _ and *), back in as math spans afterwards. */
function protectMath(md: string): { text: string; math: string[] } {
  const math: string[] = [];
  const keep = (html: string) => { math.push(html); return `MATHPLACEHOLDER${math.length - 1}X`; };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let text = md.replace(/\$\$((?:(?!\n[ \t]*\n)[\s\S])+?)\$\$/g, (_, tex: string) => keep(`<span class="math display">\\[${esc(tex.trim())}\\]</span>`));
  text = text.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g,
    (_, pre: string, tex: string) => pre + keep(`<span class="math inline">\\(${esc(tex)}\\)</span>`));
  return { text, math };
}

/** HTML a book may carry; anything else (`<packt>` copied from a PDF's text, a script) is shown as text. Unknown
 *  tags matter: the browser nests everything after an unclosed `<packt>` inside it, the whole book in one element. */
const ALLOWED = new Set(('a abbr b big blockquote br caption center cite code col colgroup dd del details dfn div dl dt em '
  + 'figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark math mi mn mo mrow msub msup mfrac ol p picture '
  + 'pre q s samp section small source span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var').split(' '));

export function tameHtml(html: string): string {
  return html.replace(/<(\/?)([a-zA-Z][\w:-]*)/g, (whole, slash: string, tag: string) =>
    (ALLOWED.has(tag.toLowerCase()) ? whole : `&lt;${slash}${tag}`));
}

const VOID = new Set(['br', 'hr', 'img', 'col', 'source']);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Tags opened and closed in order: `<s>` as a word in the text ("the <s> token") isn't, and would swallow the rest. */
function balanced(tags: string[]): boolean[] {
  const ok = tags.map(() => false);
  const open: { name: string; at: number }[] = [];
  tags.forEach((t, i) => {
    const m = /^<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>$/.exec(t.trim());
    if (!m) { ok[i] = true; return; } // a comment or the like
    const name = m[2].toLowerCase();
    if (VOID.has(name) || m[3]) ok[i] = !m[1];
    else if (!m[1]) open.push({ name, at: i });
    else {
      const k = open.map((o) => o.name).lastIndexOf(name);
      if (k >= 0) { ok[i] = ok[open[k].at] = true; open.splice(k); }
    }
  });
  return ok;
}

export function markdownToHtml(md: string): string {
  const { text, math } = protectMath(md);
  const it = new MarkdownIt({ html: true, linkify: true });
  it.core.ruler.push('balanced_html', (state) => {
    for (const block of state.tokens) {
      if (block.type === 'html_block') {
        const tags = block.content.match(/<[^>]+>/g) ?? [];
        if (!balanced(tags).every(Boolean)) Object.assign(block, { type: 'paragraph_text', content: block.content });
      }
      const inline = (block.children ?? []).filter((t) => t.type === 'html_inline');
      balanced(inline.map((t) => t.content)).forEach((ok, i) => {
        if (!ok) Object.assign(inline[i], { type: 'text' });
      });
    }
  });
  it.renderer.rules.paragraph_text = (tokens, i) => `<p>${escapeHtml(tokens[i].content.trim())}</p>\n`;
  for (const rule of ['html_block', 'html_inline'] as const) {
    it.renderer.rules[rule] = (tokens, i) => tameHtml(tokens[i].content);
  }
  const html = it.render(text);
  return html.replace(/MATHPLACEHOLDER(\d+)X/g, (_, i: string) => math[Number(i)]);
}

/** Marker (https://github.com/datalab-to/marker) writes a `{12}------…` line between PDF pages: not text. */
export function cleanMarker(md: string): string {
  return md.replace(/^\{\d+\}-{8,}[ \t]*$/gm, '');
}

export interface Chapter { title: string; part: string; html: string }

const MAX_CHARS = 120_000; // a chapter bigger than this is split at its next heading level, then in parts
const TINY_TEXT = 200;     // a title page or a part divider: joined with the next chapter
const SMALL_CHARS = 4_000; // with very many chapters (headings made from bold lines), small ones are joined too
const MANY_CHAPTERS = 150;
const JOINED_CHARS = 30_000; // …up to about this size

interface Item { tag: string; html: string; text: string }

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const size = (items: Item[]) => items.reduce((n, i) => n + i.html.length, 0);

/** Groups at each heading of `level`; what comes before the first one has no title. */
function groupAt(items: Item[], level: string): { title: string; items: Item[] }[] {
  const groups: { title: string; items: Item[] }[] = [{ title: '', items: [] }];
  for (const i of items) {
    if (i.tag === level) groups.push({ title: clean(i.text), items: [i] });
    else groups[groups.length - 1].items.push(i);
  }
  return groups.filter((g) => g.items.length && (g.title || g.items.some((i) => i.text.trim() || /<img/.test(i.html))));
}

function inParts(items: Item[], title: string, part: string): Chapter[] {
  const parts: Item[][] = [[]];
  let n = 0;
  for (const i of items) {
    parts[parts.length - 1].push(i);
    n += i.html.length;
    if (n >= PART_CHARS) { parts.push([]); n = 0; }
  }
  const filled = parts.filter((p) => p.length);
  return filled.map((p, k) => ({ title: filled.length > 1 ? `${title} (${k + 1}/${filled.length})` : title, part,
                                 html: p.map((i) => i.html).join('') }));
}

/** A chapter too big to read comfortably: at its next heading level (the chapter's title as the part), else in parts. */
function fit(items: Item[], title: string, part: string, below: number): Chapter[] {
  if (size(items) <= MAX_CHARS) return [{ title, part, html: items.map((i) => i.html).join('') }];
  for (let level = below; level <= 4; level++) {
    const groups = groupAt(items, `H${level}`);
    if (groups.length < 2) continue;
    return groups.flatMap((g) => fit(g.items, g.title || title, part || title, level + 1));
  }
  return inParts(items, title, part);
}

/** Title pages and dividers join the next chapter; with very many chapters, small ones join the one before. */
function join(chapters: Chapter[]): Chapter[] {
  const many = chapters.length > MANY_CHAPTERS;
  const textOf = (html: string) => html.replace(/<[^>]+>/g, '').trim().length;
  const out: Chapter[] = [];
  let carry: Chapter | null = null;
  for (const c of chapters) {
    const cur: Chapter = carry ? { ...carry, html: carry.html + c.html, part: c.part } : c;
    carry = null;
    const last = out[out.length - 1];
    if (many && last && last.part === cur.part && (cur.html.length < SMALL_CHARS || last.html.length < SMALL_CHARS)
        && last.html.length + cur.html.length <= JOINED_CHARS) {
      last.html += cur.html;
    } else if (textOf(cur.html) < TINY_TEXT && !/<img/.test(cur.html)) {
      carry = cur;
    } else {
      out.push(cur);
    }
  }
  if (carry) {
    if (out.length) out[out.length - 1].html += carry.html; else out.push(carry);
  }
  return out;
}

/** Chapters at the top-level headings (# or ##), big ones split further, tiny ones joined; no headings: even parts. */
export function splitChapters(html: string, fallbackTitle: string): Chapter[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const items: Item[] = [...doc.body.childNodes]
    .filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()))
    .map((n) => ({ tag: n instanceof Element ? n.tagName : '', html: n instanceof Element ? n.outerHTML : n.textContent ?? '',
                   text: n.textContent ?? '' }));
  for (const level of [1, 2]) {
    const groups = groupAt(items, `H${level}`);
    if (groups.filter((g) => g.title).length >= 2) {
      return join(groups.flatMap((g) => fit(g.items, g.title || fallbackTitle, '', level + 1)));
    }
  }
  return inParts(items, fallbackTitle, '');
}

/** `#id` links to an element in another chapter: `chNNN.html#id`, so they still work after the split. */
export function linkAcrossChapters(chapters: Chapter[], file: (i: number) => string): string[] {
  const where = new Map<string, number>();
  chapters.forEach((c, i) => { for (const m of c.html.matchAll(/\sid="([^"]+)"/g)) if (!where.has(m[1])) where.set(m[1], i); });
  return chapters.map((c, i) => c.html.replace(/(<a\s[^>]*href=")#([^"]+)"/g, (whole, pre: string, id: string) => {
    const at = where.get(decodeURIComponent(id));
    return at === undefined || at === i ? whole : `${pre}${file(at)}#${id}"`;
  }));
}

/** `images`: the files chosen with the Markdown, by their path relative to it (or just their name). */
export async function buildReflowBundle(md: string, images: Map<string, Blob>, meta: { title: string; author: string; language: string }):
  Promise<{ zip: Blob; chapters: number; images: number; missing: string[] }> {
  const html = markdownToHtml(cleanMarker(md));
  const chapters = splitChapters(html, meta.title);
  const file = (i: number) => `ch${String(i).padStart(3, '0')}.html`;
  const files: Record<string, Uint8Array> = {
    'book.json': strToU8(JSON.stringify({ format: 1, ...meta,
      chapters: chapters.map((c, i) => ({ file: file(i), title: c.title, part: c.part })) }, null, 1)),
  };
  linkAcrossChapters(chapters, file).forEach((h, i) => { files[file(i)] = strToU8(h); });
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

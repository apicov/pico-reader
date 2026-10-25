/** Chosen files and folders → books: each PDF or EPUB is one, and each Markdown file with the images next to it
 *  (a marker project: `<name>/<name>.md`, `<name>_meta.json`, `_page_*.jpeg`) is one. */

export interface Picked {
  file: File;
  /** relative to what was chosen: `folder/sub/file.md`, or just the name */
  path: string;
}

export interface BookSource {
  key: string; // the path: the same file chosen twice is one book
  kind: 'pdf' | 'epub' | 'markdown';
  file: File;
  /** Markdown only: the files beside it and below, by their path from its folder */
  images: Map<string, File>;
}

const IMAGE = /\.(jpe?g|png|gif|webp|svg)$/i;
const MARKDOWN = /\.(md|markdown)$/i;

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');
const nameOf = (path: string) => path.split('/').pop() ?? path;
const stemOf = (path: string) => nameOf(path).replace(/\.(md|markdown|pdf|epub)$/i, '');

const SKIPPED = /(^|\/)(\.[^/]*|node_modules|__pycache__)\//;

export function groupBooks(chosen: Picked[]): BookSource[] {
  const picked = chosen.filter((f) => !SKIPPED.test(f.path));
  // a marker project: a folder with a .md named like it; everything below it belongs to that book
  const projects = picked.filter((f) => MARKDOWN.test(f.path) && dirOf(f.path) && stemOf(f.path) === nameOf(dirOf(f.path)))
    .map((f) => dirOf(f.path));
  const inProject = (p: Picked) => projects.some((d) => p.path.startsWith(`${d}/`) && dirOf(p.path) !== d);
  const byDir = new Map<string, Picked[]>();
  for (const p of picked.filter((f) => MARKDOWN.test(f.path) && !inProject(f))) {
    byDir.set(dirOf(p.path), [...(byDir.get(dirOf(p.path)) ?? []), p]);
  }
  const books: BookSource[] = [];
  for (const [dir, mds] of byDir) {
    const named = mds.filter((m) => dir && stemOf(m.path) === nameOf(dir));
    for (const md of named.length ? named : mds) {
      const images = new Map<string, File>();
      const inside = picked.filter((f) => IMAGE.test(f.path) && (!dir || f.path.startsWith(`${dir}/`)));
      for (const f of inside) images.set(dir ? f.path.slice(dir.length + 1) : f.path, f.file);
      for (const f of inside) if (!images.has(nameOf(f.path))) images.set(nameOf(f.path), f.file);
      books.push({ key: md.path, kind: 'markdown', file: md.file, images });
    }
  }
  for (const p of picked) {
    const kind = /\.pdf$/i.test(p.path) ? 'pdf' : /\.epub$/i.test(p.path) ? 'epub' : null;
    // a PDF or EPUB in a Markdown book's folder is the same book (the source, or an export of it)
    if (kind && !inProject(p) && !(dirOf(p.path) && byDir.has(dirOf(p.path)))) books.push({ key: p.path, kind, file: p.file, images: new Map() });
  }
  return books.sort((a, b) => a.key.localeCompare(b.key));
}

/** The largest page-1 image of a marker project, when it's big enough to be the cover. */
export function markerCover(images: Map<string, File>): File | null {
  const first = [...new Set(images.values())].filter((f) => /^_page_0_/.test(f.name) && f.size > 20_000);
  return first.sort((a, b) => b.size - a.size)[0] ?? null;
}

/** "Art of Computer Programming, The Volume 3 (Knuth, Donald) (Z-Library)" → title and author. */
export function nameToMeta(fileName: string): { title: string; author: string } {
  let s = stemOf(fileName).replace(/_/g, ' ').replace(/\s*\((z-library|z-lib\.org)\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  let author = '';
  if (s.endsWith(')')) {
    let depth = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === ')') depth++;
      if (s[i] === '(' && --depth === 0) {
        if (i > 0) { author = s.slice(i + 1, -1).trim(); s = s.slice(0, i).trim(); }
        break;
      }
    }
  } else {
    const m = /^(.+?) (?:by|-) ((?:\p{Lu}[\p{L}.'-]*\s?){2,4})$/u.exec(s);
    if (m) { s = m[1].trim(); author = m[2].trim(); }
  }
  author = author.replace(/\s*\(auth\.\)$/i, '');
  if (/^(unknown|anonymous|n\/a)$/i.test(author)) author = '';
  const last = /^([^,]+), ([^,]+)$/.exec(author);
  if (last && !/\s/.test(last[1].trim())) author = `${last[2].trim()} ${last[1].trim()}`;
  const the = /^([^,]+), The (.+)$/.exec(s);
  if (the) s = `The ${the[1]}: ${the[2]}`;
  return { title: s, author };
}

const WORDS: Record<string, string[]> = {
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'sich', 'auf', 'ein', 'eine', 'auch', 'dem', 'den', 'zu', 'von'],
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'in', 'it', 'for', 'with', 'as', 'this', 'are', 'be', 'on', 'by'],
  es: ['el', 'la', 'de', 'que', 'y', 'los', 'las', 'en', 'un', 'una', 'por', 'con', 'para', 'es', 'del', 'se'],
  fr: ['le', 'la', 'les', 'de', 'et', 'des', 'est', 'que', 'une', 'un', 'pour', 'dans', 'qui', 'pas', 'du', 'sur'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'una', 'non', 'sono', 'gli', 'del', 'della', 'con', 'si', 'le'],
  pt: ['o', 'a', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'os', 'as', 'é'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'niet', 'op', 'te', 'zijn', 'met', 'voor', 'ook', 'maar', 'die'],
};

/** The book's language from its words (a sample is enough); '' when unsure. */
export function guessLanguage(text: string): string {
  const sample = text.slice(0, 60_000).toLowerCase();
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters && (sample.match(/\p{Script=Cyrillic}/gu)?.length ?? 0) / letters > 0.3) return 'ru';
  if (letters && (sample.match(/\p{Script=Greek}/gu)?.length ?? 0) / letters > 0.3) return 'el';
  const counts = new Map<string, number>();
  for (const w of sample.match(/\p{L}+/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  const scores = Object.entries(WORDS).map(([lang, words]) => [lang, words.reduce((n, w) => n + (counts.get(w) ?? 0), 0)] as const)
    .sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = scores;
  return top >= 20 && top >= second * 1.3 ? best : '';
}

/** Files dropped on the page, folders included (walked through, with their paths). */
export async function droppedFiles(items: DataTransferItemList): Promise<Picked[]> {
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) { // readEntries gives at most 100 at a time
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${path}/${e.name}`);
    }
  };
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, e.name);
  return out;
}

/** From an <input type="file">: with a folder chosen, each file knows its path in it. */
export function pickedFiles(list: FileList): Picked[] {
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

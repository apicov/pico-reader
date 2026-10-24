/**
 * A reflow bundle (tools/README.md): book.json + chapter files (HTML from Quarto, later Markdown) + images,
 * in a zip. The whole zip is read into memory once (a few MB); images become blob URLs on first use.
 */
import DOMPurify from 'dompurify';
import { unzipSync } from 'fflate';

export interface ReflowChapter {
  file: string;
  title: string;
  part: string;
}

export interface ReflowMeta {
  format: number;
  title: string;
  subtitle?: string;
  author: string;
  language: string;
  chapters: ReflowChapter[];
  styles?: string[];
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

/** posix-style join + normalize of a path relative to `fromFile` */
export function resolvePath(fromFile: string, relative: string): string {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of relative.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export class ReflowBundle {
  readonly meta: ReflowMeta;
  private files: Record<string, Uint8Array>;
  private urls = new Map<string, string>();
  private decoder = new TextDecoder();

  private constructor(files: Record<string, Uint8Array>) {
    this.files = files;
    const raw = files['book.json'];
    if (!raw) throw new Error('Not a reflow book (no book.json)');
    this.meta = JSON.parse(this.decoder.decode(raw)) as ReflowMeta;
  }

  static async open(blob: Blob): Promise<ReflowBundle> {
    return new ReflowBundle(unzipSync(new Uint8Array(await blob.arrayBuffer())));
  }

  text(path: string): string | null {
    const data = this.files[path];
    return data ? this.decoder.decode(data) : null;
  }

  assetUrl(path: string): string | null {
    let url = this.urls.get(path);
    if (!url) {
      const data = this.files[path];
      if (!data) return null;
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: IMAGE_TYPES[ext] ?? 'application/octet-stream' }));
      this.urls.set(path, url);
    }
    return url;
  }

  chapterIndex(file: string): number {
    return this.meta.chapters.findIndex((c) => c.file === file);
  }

  /** A chapter as sanitized HTML, with its images pointing at the bundle. */
  chapterHtml(index: number): string {
    const chapter = this.meta.chapters[index];
    const html = this.text(chapter.file) ?? '';
    const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    tpl.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (/^(data:|https?:)/.test(src)) return;
      const url = this.assetUrl(resolvePath(chapter.file, src));
      if (url) img.setAttribute('src', url);
      img.setAttribute('loading', 'lazy');
    });
    return tpl.innerHTML;
  }

  close(): void {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

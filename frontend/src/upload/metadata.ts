/** What a book file says about itself: title, author, language, cover. On the device, before uploading
 *  (the same rules as the desktop tool, tools/readertool/metadata.py). */
import { unzipSync } from 'fflate';

export interface BookMeta {
  title: string;
  author: string;
  language: string;
  cover: Blob | null;
}

const COVER_WIDTH = 600;

function resolve(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(href).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export async function epubMeta(file: Blob): Promise<BookMeta> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => /container\.xml$|\.opf$|\.(jpe?g|png|webp|gif)$/i.test(f.name),
  });
  const xml = (path: string) => new DOMParser().parseFromString(new TextDecoder().decode(files[path]), 'application/xml');
  const container = xml('META-INF/container.xml');
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path') ?? '';
  if (!files[opfPath]) throw new Error("This doesn't look like an EPUB (no package file)");
  const opf = xml(opfPath);
  const dc = (tag: string) => (opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', tag)[0]?.textContent ?? '').trim();
  const items = [...opf.getElementsByTagName('item')];
  let cover = items.find((i) => (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'));
  if (!cover) {
    const ref = [...opf.getElementsByTagName('meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    cover = items.find((i) => i.getAttribute('id') === ref);
  }
  let coverBlob: Blob | null = null;
  const type = cover?.getAttribute('media-type') ?? '';
  if (cover && type.startsWith('image/')) {
    const data = files[resolve(opfPath, cover.getAttribute('href') ?? '')];
    if (data) coverBlob = new Blob([data as BlobPart], { type: type === 'image/jpg' ? 'image/jpeg' : type });
  }
  return { title: dc('title'), author: dc('creator'), language: dc('language').slice(0, 2).toLowerCase(), cover: coverBlob };
}

export async function pdfMeta(file: Blob): Promise<BookMeta> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const { info } = (await doc.getMetadata()) as { info: { Title?: string; Author?: string; Language?: string } };
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    const cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return { title: (info?.Title ?? '').trim(), author: (info?.Author ?? '').trim(),
      language: (info?.Language ?? '').slice(0, 2).toLowerCase(), cover };
  } finally {
    void doc.destroy();
  }
}

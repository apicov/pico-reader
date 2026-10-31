/** A PDF's outline (its bookmarks) as the contents, and which entry the page being read is under. */
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { TocItem } from '../types';

/** Where an outline entry or a link points: a named destination, an explicit one, or nowhere */
export type Dest = string | unknown[] | null;

export interface OutlineNode { title: string; dest: Dest; items: OutlineNode[] }

export interface Outline {
  items: TocItem[];
  dests: Map<string, Dest>; // by item id
}

export function readOutline(nodes: OutlineNode[] | null): Outline {
  const items: TocItem[] = [];
  const dests = new Map<string, Dest>();
  const walk = (list: OutlineNode[], depth: number) => list.forEach((n) => {
    const id = `o${items.length}`;
    dests.set(id, n.dest);
    items.push({ id, label: n.title, depth });
    walk(n.items ?? [], depth + 1);
  });
  walk(nodes ?? [], 0);
  return { items, dests };
}

/** The page (from 0) a destination points to; null when it points nowhere this document has */
export async function destPage(doc: PDFDocumentProxy, dest: Dest): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || !explicit[0]) return null;
  const ref = explicit[0];
  return typeof ref === 'number' ? ref : doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
}

/** Each entry's page, for `entryAt` (entries whose destination can't be found are left out) */
export async function entryPages(doc: PDFDocumentProxy, outline: Outline): Promise<{ id: string; page: number }[]> {
  const pages = await Promise.all(outline.items.map(async (item) =>
    ({ id: item.id, page: await destPage(doc, outline.dests.get(item.id) ?? null).catch(() => null) })));
  return pages.filter((p): p is { id: string; page: number } => p.page !== null);
}

/** The entry the page is under: the last one starting on it or before it (null before the first) */
export function entryAt(pages: { id: string; page: number }[], page: number): string | null {
  let best: { id: string; page: number } | null = null;
  for (const p of pages) if (p.page <= page && (!best || p.page >= best.page)) best = p;
  return best?.id ?? null;
}

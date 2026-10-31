/**
 * Places in a book as the views write them (`Position.location`, highlights, bookmarks, search results):
 * - reflow: `c<chapter>:<fraction down the chapter>`, chapters counted from 0
 * - PDF:    `p<page>:<fraction down the page>`, pages counted from 1 (as printed page numbers are)
 * - EPUB:   an EPUB CFI, `epubcfi(…)` (foliate reads and writes it)
 * Each parse returns a 0-based `index` (chapter or page), so the views don't count differently.
 */

export interface Place {
  /** chapter or page, from 0 */
  index: number;
  /** 0..1 down it */
  fraction: number;
}

function placeCodec(prefix: string, firstNumber: 0 | 1) {
  const pattern = new RegExp(`^${prefix}(\\d+):([\\d.]+)$`);
  return {
    parse(location: string | undefined): Place | null {
      const m = pattern.exec(location ?? '');
      return m ? { index: Number(m[1]) - firstNumber, fraction: Number(m[2]) } : null;
    },
    format(place: Place): string {
      return `${prefix}${place.index + firstNumber}:${place.fraction.toFixed(4)}`;
    },
  };
}

export const chapterPlace = placeCodec('c', 0);
export const pagePlace = placeCodec('p', 1);
export const isCfi = (location: string | undefined) => !!location?.startsWith('epubcfi(');

/** The place a progress through the whole book falls on, with `count` chapters or pages of equal share */
export function placeAt(progress: number, count: number): Place {
  const exact = Math.max(0, progress) * count;
  const index = Math.max(0, Math.min(Math.floor(exact), count - 1));
  return { index, fraction: Math.min(1, exact - index) };
}

/** The progress through the whole book of a place, with `count` chapters or pages */
export const progressAt = (place: Place, count: number) => Math.min(1, (place.index + place.fraction) / Math.max(1, count));

/** How far down `box` a range starts, 0..1 (where a selection is, for its highlight) */
export function fractionDown(range: Range, box: DOMRect): number {
  return Math.max(0, Math.min(1, (range.getBoundingClientRect().top - box.top) / Math.max(1, box.height)));
}

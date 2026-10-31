/** The formats a book can be read in: what the reader calls them, and which is best. Opening one and its view:
 *  formatViews.tsx (kept apart so pages that only show the names don't load the viewers). */
import type { BookFormat } from '@/services/types';

export const FORMATS: Record<BookFormat, { label: string; description: string }> = {
  reflow: { label: 'Text', description: 'Text that fits the screen' },
  epub: { label: 'EPUB', description: 'E-book pages' },
  pdf: { label: 'PDF', description: 'The printed pages' },
};

/** Best reading experience first: text that reflows, then EPUB, then fixed PDF pages */
export const FORMAT_PREFERENCE: BookFormat[] = ['reflow', 'epub', 'pdf'];

/** A format's name, or the key itself for one the app doesn't know */
export const formatLabel = (format: string) => FORMATS[format as BookFormat]?.label ?? format;

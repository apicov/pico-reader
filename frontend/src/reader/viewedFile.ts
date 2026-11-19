/** A file opened just to read (docs/19-viewing-a-file.md): held here, in memory only, from the moment it's picked
 *  until the viewer takes it. Nothing about it is stored or sent: not the file, its place, nor that it was read. */
import type { BookSource } from '@/upload/books';

let picked: BookSource | null = null;

export const viewFile = (source: BookSource) => { picked = source; };
export const viewedFile = () => picked;
export const forgetViewedFile = () => { picked = null; };

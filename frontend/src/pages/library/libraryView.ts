/** What the library page shows: which books, and what it says when there are none */
import type { CollectionFilter } from '@/components/collections';
import type { Collection } from '@/services/shelf';

export type LibraryTab = 'mine' | 'reading' | 'all' | 'finished';

/** On My shelf, whether a book is shown. As folders: the open folder's books, or (at the top, `topLevel`) those in no
 *  collection; as one list: those of the chosen collection ('all' every one, 'none' those in no collection). */
export function shownOnShelf({ asFolders, folder, topLevel, collection, collections, inSomeCollection }: {
  asFolders: boolean; folder: { books: string[] } | undefined; topLevel: boolean;
  collection: CollectionFilter; collections: Collection[]; inSomeCollection: Set<string>;
}): (bookId: string) => boolean {
  const unsorted = (id: string) => !inSomeCollection.has(id);
  if (asFolders) return folder ? (id) => folder.books.includes(id) : topLevel ? unsorted : () => true;
  if (collection === 'all') return () => true;
  if (collection === 'none') return unsorted;
  const chosen = new Set(collections.find((c) => c.id === collection)?.book_ids ?? []);
  return (id) => chosen.has(id);
}

/** Why the list is empty, and what to do about it */
export function emptyMessage({ libraryEmpty, searching, inFolder, tab, onShelf, collection }: {
  libraryEmpty: boolean; searching: boolean; inFolder: boolean; tab: LibraryTab; onShelf: number; collection: CollectionFilter;
}): string {
  if (libraryEmpty) return 'No books yet. Add some with the desktop tool.';
  if (searching) return 'No book matches.';
  const addToCollection = 'No book in this collection yet: ⋮ → Collections… on a book.';
  if (inFolder) return addToCollection;
  switch (tab) {
    case 'mine':
      if (!onShelf) return 'Nothing on your shelf yet: use ⋮ → Add to My shelf on any book.';
      return collection === 'none' ? 'Every book on your shelf is in a collection.' : addToCollection;
    case 'reading': return 'Nothing here yet: books you open appear here.';
    case 'finished': return 'No finished books yet.';
    default: return 'No book matches.';
  }
}

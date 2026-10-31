import { emptyMessage, shownOnShelf } from './libraryView';

const collections = [{ id: 'uni', name: 'Uni', position: 0, book_ids: ['a'] }];
const inSomeCollection = new Set(['a']);

describe('shownOnShelf', () => {
  const shown = (o: Partial<Parameters<typeof shownOnShelf>[0]>) => ['a', 'b'].filter(shownOnShelf({
    asFolders: false, folder: undefined, topLevel: false, collection: 'all', collections, inSomeCollection, ...o }));
  it('as folders: the open folder, else at the top the books in no collection', () => {
    expect(shown({ asFolders: true, folder: { books: ['a'] } })).toEqual(['a']);
    expect(shown({ asFolders: true, topLevel: true })).toEqual(['b']);
    expect(shown({ asFolders: true })).toEqual(['a', 'b']); // searching: every book on the shelf
  });
  it('as a list: every one, those in no collection, or the chosen collection', () => {
    expect(shown({})).toEqual(['a', 'b']);
    expect(shown({ collection: 'none' })).toEqual(['b']);
    expect(shown({ collection: 'uni' })).toEqual(['a']);
  });
});

describe('emptyMessage', () => {
  const base = { libraryEmpty: false, searching: false, inFolder: false, tab: 'all' as const, onShelf: 0, collection: 'all' };
  it('says why and what to do', () => {
    expect(emptyMessage({ ...base, libraryEmpty: true, searching: true })).toMatch(/No books yet/);
    expect(emptyMessage({ ...base, searching: true, tab: 'mine' })).toBe('No book matches.');
    expect(emptyMessage({ ...base, tab: 'mine' })).toMatch(/Nothing on your shelf/);
    expect(emptyMessage({ ...base, tab: 'mine', onShelf: 3, collection: 'none' })).toMatch(/Every book on your shelf/);
    expect(emptyMessage({ ...base, tab: 'mine', onShelf: 3, collection: 'uni' })).toMatch(/No book in this collection/);
    expect(emptyMessage({ ...base, tab: 'finished' })).toBe('No finished books yet.');
  });
});

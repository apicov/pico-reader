import { describe, expect, it } from 'vitest';
import { ancestry, children, inCategory, subtree, type Category } from './categories';
import type { Book } from './types';

const c = (id: number, parent_id: number | null, name: string, position = 0): Category =>
  ({ id, parent_id, name, path: name, depth: 0, status: 'approved', position, books: 0 });
const tree = [c(1, null, 'Literature'), c(2, 1, 'Science fiction', 1), c(3, 2, 'Space opera'), c(4, 1, 'Classics', 0),
  c(5, null, 'Academic')];
const book = (id: string, category_id: number | null, category2_id: number | null = null) =>
  ({ id, category_id, category2_id } as unknown as Book);

describe('category tree', () => {
  it('lists children in order and the chain from the top', () => {
    expect(children(tree, 1).map((x) => x.name)).toEqual(['Classics', 'Science fiction']);
    expect(ancestry(tree, 3).map((x) => x.name)).toEqual(['Literature', 'Science fiction', 'Space opera']);
  });
  it('a category includes those below it', () => {
    expect([...subtree(tree, 1)].sort()).toEqual([1, 2, 3, 4]);
  });
  it('filters books by main or second category, or none', () => {
    const books = [book('a', 3), book('b', 5, 3), book('c', 5), book('d', null)];
    expect(books.filter(inCategory(tree, 1)).map((b) => b.id)).toEqual(['a', 'b']);
    expect(books.filter(inCategory(tree, 'none')).map((b) => b.id)).toEqual(['d']);
    expect(books.filter(inCategory(tree, null))).toHaveLength(4);
  });
});

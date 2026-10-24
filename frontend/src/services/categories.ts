/**
 * The shared category tree (backend app/categories.py): up to 3 levels, e.g. Literature › Science fiction ›
 * Space opera. Kept on the device for offline browsing. Books carry a main and an optional second category.
 */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import type { Book } from '@/services/types';

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  path: string; // "Literature > Science fiction > Space opera"
  depth: number;
  status: 'approved' | 'suggested';
  position: number;
  /** books in it or below it */
  books: number;
}

const KEY = 'categories';

export async function cachedCategories(): Promise<Category[]> {
  return (await getPref<Category[]>(KEY)) ?? [];
}

export async function loadCategories(): Promise<Category[]> {
  if (!isOnline()) return cachedCategories();
  try {
    const tree = await api<Category[]>('/api/categories');
    await setPref(KEY, tree);
    return tree;
  } catch {
    return cachedCategories();
  }
}

/** Shown with › between levels */
export const pretty = (path: string) => path.replaceAll(' > ', ' › ');

export function children(tree: Category[], parent: number | null): Category[] {
  return tree.filter((c) => c.parent_id === parent).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The category and every one below it */
export function subtree(tree: Category[], id: number): Set<number> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of tree) if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
  }
  return ids;
}

/** The chain from the top: [Literature, Science fiction, Space opera] */
export function ancestry(tree: Category[], id: number | null): Category[] {
  const byId = new Map(tree.map((c) => [c.id, c]));
  const chain: Category[] = [];
  let cur = id === null ? undefined : byId.get(id);
  while (cur) { chain.unshift(cur); cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id); }
  return chain;
}

/** 'none' = books without a category; a number = that category and those below it; null = every book */
export type CategoryFilter = number | 'none' | null;

export function inCategory(tree: Category[], filter: CategoryFilter): (b: Book) => boolean {
  if (filter === null) return () => true;
  if (filter === 'none') return (b) => !b.category_id;
  const ids = subtree(tree, filter);
  return (b) => (b.category_id != null && ids.has(b.category_id)) || (b.category2_id != null && ids.has(b.category2_id));
}

export async function setBookCategory(bookId: string, main: number | null, second: number | null): Promise<void> {
  await api(`/api/books/${encodeURIComponent(bookId)}/category`, { method: 'PUT', body: { category_id: main, category2_id: second } });
}

export async function suggestAgain(bookId: string): Promise<{ category: string; second: string | null; reason: string }> {
  return api(`/api/books/${encodeURIComponent(bookId)}/categorize`, { method: 'POST' });
}

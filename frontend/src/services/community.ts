/**
 * The community (backend routes/community.py): profiles, reviews, posts with books and quotes, comments, likes and
 * top lists, shared by everyone signed in. Online only: there's nothing to discuss without a connection.
 */
import { api, apiUrl } from '@/services/api';

export interface Author {
  handle: string;
  display_name: string;
  avatar_url: string | null;
}

export interface BookStub {
  id: string;
  title: string;
  author: string;
  /** false once the book was deleted from the library */
  available: boolean;
}

interface Likeable {
  id: string;
  likes: number;
  liked_by_me: boolean;
}

export interface Review extends Likeable {
  book: BookStub;
  score: number;
  recommend: boolean;
  body: string;
  spoiler: boolean;
  hidden: boolean;
  mine: boolean;
  created_at: string;
  updated_at: string;
  author: Author;
}

export interface Quote {
  book: BookStub;
  text: string;
  format: string;
  location: string;
  progress: number;
}

export interface QuoteDraft {
  book_id: string;
  text: string;
  format: string;
  location: string;
  progress: number;
}

export interface Comment extends Likeable {
  parent_id: string | null;
  body: string;
  spoiler: boolean;
  edited: boolean;
  deleted: boolean;
  hidden: boolean;
  mine: boolean;
  created_at: string;
  /** null for a deleted or hidden comment */
  author: Author | null;
}

export interface PostSummary extends Likeable {
  title: string;
  /** shortened in lists */
  body: string;
  edited: boolean;
  hidden: boolean;
  mine: boolean;
  created_at: string;
  updated_at: string;
  author: Author;
  comment_count: number;
  books: BookStub[];
}

export interface Post extends PostSummary {
  quotes: Quote[];
  comments: Comment[];
}

export interface TopList {
  id: string;
  title: string;
  description: string;
  hidden: boolean;
  mine: boolean;
  created_at: string;
  updated_at: string;
  author: Author;
  items: { book: BookStub; note: string }[];
}

export interface MyProfile extends Author {
  bio: string;
  show_reading: boolean;
  /** false while the handle is the one made from the email */
  chosen: boolean;
}

export interface Profile extends Author {
  bio: string;
  mine: boolean;
  finished_count: number;
  reading: BookStub[];
  reviews: Review[];
  posts: PostSummary[];
  lists: TopList[];
}

export interface RatingSummary {
  avg_score: number | null;
  review_count: number;
  recommend_count: number;
}

export interface BookCommunity {
  book: BookStub;
  summary: RatingSummary;
  my_review: Review | null;
  reviews: Review[];
  posts: PostSummary[];
}

export const avatarSrc = (a: Author) => (a.avatar_url ? apiUrl(a.avatar_url) : undefined);

const enc = encodeURIComponent;
const json = (method: string, body?: unknown) => ({ method, body });

let me: Promise<MyProfile> | null = null;
export const myProfile = (fresh = false) => {
  if (fresh || !me) me = api<MyProfile>('/api/profiles/me');
  me.catch(() => { me = null; });
  return me;
};
export const saveProfile = async (p: { handle: string; display_name: string; bio: string; show_reading: boolean }) => {
  const saved = await api<MyProfile>('/api/profiles/me', json('PUT', p));
  me = Promise.resolve(saved);
  return saved;
};
export const saveAvatar = async (jpegBase64: string | null) => {
  const saved = await api<MyProfile>('/api/profiles/me/avatar', json('PUT', { jpeg_base64: jpegBase64 }));
  me = Promise.resolve(saved);
  return saved;
};
export const getProfile = (handle: string) => api<Profile>(`/api/profiles/${enc(handle)}`);
export const members = () => api<Author[]>('/api/members');

export const bookCommunity = (bookId: string) => api<BookCommunity>(`/api/books/${enc(bookId)}/community`);
export const saveReview = (bookId: string, r: { score: number; recommend: boolean; body: string; spoiler: boolean }) =>
  api<Review>(`/api/books/${enc(bookId)}/review`, json('PUT', r));
export const deleteReview = (bookId: string) => api<void>(`/api/books/${enc(bookId)}/review`, json('DELETE'));
export const ratings = () => api<Record<string, RatingSummary>>('/api/ratings');

export type PostFilter = { book?: string; author?: string; mine_books?: boolean; before?: string };
export const listPosts = (f: PostFilter = {}) => {
  const q = new URLSearchParams();
  if (f.book) q.set('book', f.book);
  if (f.author) q.set('author', f.author);
  if (f.mine_books) q.set('mine_books', 'true');
  if (f.before) q.set('before', f.before);
  return api<PostSummary[]>(`/api/posts?${q}`);
};
export const getPost = (id: string) => api<Post>(`/api/posts/${enc(id)}`);
export interface PostDraft { title: string; body: string; book_ids: string[]; quotes: QuoteDraft[] }
export const createPost = (p: PostDraft) => api<Post>('/api/posts', json('POST', p));
export const editPost = (id: string, p: PostDraft) => api<Post>(`/api/posts/${enc(id)}`, json('PUT', p));
export const deletePost = (id: string) => api<void>(`/api/posts/${enc(id)}`, json('DELETE'));

export const addComment = (postId: string, c: { body: string; spoiler: boolean; parent_id?: string | null }) =>
  api<Comment[]>(`/api/posts/${enc(postId)}/comments`, json('POST', c));
export const editComment = (id: string, c: { body: string; spoiler: boolean }) =>
  api<Comment[]>(`/api/comments/${enc(id)}`, json('PUT', c));
export const deleteComment = (id: string) => api<void>(`/api/comments/${enc(id)}`, json('DELETE'));

export type LikeKind = 'post' | 'comment' | 'review';
export const setLike = (kind: LikeKind, id: string, on: boolean) =>
  api<void>(`/api/likes/${kind}/${enc(id)}`, json(on ? 'PUT' : 'DELETE'));

export interface ListDraft { title: string; description: string; items: { book_id: string; note: string }[] }
export const getList = (id: string) => api<TopList>(`/api/lists/${enc(id)}`);
export const createList = (l: ListDraft) => api<TopList>('/api/lists', json('POST', l));
export const editList = (id: string, l: ListDraft) => api<TopList>(`/api/lists/${enc(id)}`, json('PUT', l));
export const deleteList = (id: string) => api<void>(`/api/lists/${enc(id)}`, json('DELETE'));

export type HideKind = 'post' | 'comment' | 'review' | 'list';
export const setHidden = (kind: HideKind, id: string, hidden: boolean) =>
  api<void>(`/api/admin/hide/${kind}/${enc(id)}`, json(hidden ? 'POST' : 'DELETE'));

/** The jump into the reader that search results use (ReaderPage reads these parameters once). */
export const quoteLink = (q: { book: BookStub; format: string; location: string; progress: number }) =>
  `/read/${enc(q.book.id)}?${new URLSearchParams({ format: q.format, location: q.location, progress: String(q.progress) })}`;

/** "3 min ago", "yesterday", "12 Oct" */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short',
    year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** A square JPEG avatar (256 px, center crop) from a picked image, as base64 for saveAvatar. */
export async function avatarFromFile(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/jpeg', 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

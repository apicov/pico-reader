export interface Reader {
  email: string;
  name: string;
  is_admin: boolean;
}

export interface FileRef {
  size: number;
  sha256: string;
}

export type BookFormat = 'pdf' | 'epub' | 'reflow';

export interface Book {
  id: string;
  title: string;
  author: string;
  language: string;
  updated_at: string;
  formats: Partial<Record<BookFormat, FileRef>>;
  cover: (FileRef & { url?: string }) | null;
  /** this reader added it, or is an admin: may delete it or replace its files */
  can_change?: boolean;
  /** The offline search file (passages + vectors), once the server indexed the book */
  search?: FileRef | null;
  /** The search index, when the book has one */
  index?: { sha256: string; chunks: number } | null;
}

export interface Dictionary {
  id: string;
  name: string;
  from_lang: string;
  to_lang: string;
  entry_count: number;
  updated_at: string;
  /** everyone, or only the reader who uploaded it (admins see all) */
  visibility?: 'everyone' | 'private';
  /** admins: rename, change languages or visibility, delete */
  can_change?: boolean;
  files: Partial<Record<'sqlite' | 'jsonl' | 'res', FileRef>>;
}

export interface Library {
  books: Book[];
  dictionaries: Dictionary[];
}

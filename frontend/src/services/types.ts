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
  files: Partial<Record<'sqlite' | 'jsonl' | 'res', FileRef>>;
}

export interface Library {
  books: Book[];
  dictionaries: Dictionary[];
}

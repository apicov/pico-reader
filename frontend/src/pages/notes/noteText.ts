import type { Note } from '@/services/notes';

/** "12 Oct 2026" */
export const noteDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A note for the .md export: its citations become a list of the passages at the end */
export function asMarkdown(note: Note): string {
  const sources = note.sources.map((p, i) => `[${i + 1}] ${p.title}${p.heading ? `, ${p.heading}` : ''}: “${p.text.slice(0, 300)}${p.text.length > 300 ? '…' : ''}”`);
  return `# ${note.title}\n\n${note.markdown.trim()}\n${sources.length ? `\n---\n\n${sources.join('\n\n')}\n` : ''}`;
}

/** The note's title as a file name */
export const noteFileName = (note: Note) => `${note.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'note'}.md`;

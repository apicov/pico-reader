/** The book open last in this session, for the top bar's "Back to the book" button on the other pages (session
 *  storage: it's about the way back to the book, not a reading position, which position.ts keeps). */
const KEY = 'reading_now';

export function setReadingNow(book: { id: string; title: string }): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ id: book.id, title: book.title }));
  } catch { /* storage off: no "Continue reading" line */ }
}

export function readingNow(): { id: string; title: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

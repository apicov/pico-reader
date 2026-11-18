/** The book in front when the reader was left, for the top bar's "Back to the book" button on the other pages.
 *  Kept on the device across restarts (local storage); it's the way back to the book, not a reading position,
 *  which position.ts keeps. Cleared when the last tab closes. */
const KEY = 'reading_now';

export function setReadingNow(book: { id: string; title: string }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: book.id, title: book.title }));
  } catch { /* storage off: no "Back to the book" button */ }
}

export function clearReadingNow(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* storage off */ }
}

export function readingNow(): { id: string; title: string } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

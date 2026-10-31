/** Notes in an EPUB (footnotes, endnotes): told apart from other links, and their content for the popup. */
import DOMPurify from 'dompurify';

/** The element an anchor resolved to (anchors can also be ranges or offsets); tag checks, not instanceof:
 *  the book's pages are documents of their own */
export const asElement = (x: unknown) => (x && typeof x === 'object' && 'closest' in x ? x as Element : null);

const EPUB_NS = 'http://www.idpf.org/2007/ops';
const NOTE_TYPES = /\b(footnote|endnote|rearnote)\b/;
export const isNoteRef = (a: Element) => /\bnoteref\b/.test(a.getAttributeNS(EPUB_NS, 'type') ?? '')
  || a.getAttribute('role') === 'doc-noteref';
/** A note hidden by bookCss (asides typed as notes) */
export const hiddenNote = (el: Element) => {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.localName === 'aside' && NOTE_TYPES.test(e.getAttributeNS(EPUB_NS, 'type') ?? '')) return e;
  }
  return null;
};

/** A note's content for the popup: its element (or the block around the anchor it starts with), without the
 *  link back to the text, sanitized; null when there's nothing to show. */
export function noteHtml(target: Element): string | null {
  const note = (hiddenNote(target) ?? target.closest('aside, li, dd, p, div') ?? target).cloneNode(true) as Element;
  note.querySelectorAll('a').forEach((a) => {
    if (/\bbacklink\b/.test(a.getAttributeNS(EPUB_NS, 'type') ?? '') || a.getAttribute('role') === 'doc-backlink'
      || a.classList.contains('footnote-back')) a.remove();
  });
  if (!note.textContent?.trim()) return null;
  return DOMPurify.sanitize(note.innerHTML, { FORBID_TAGS: ['style', 'form', 'input'] });
}

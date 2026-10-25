export interface TextSelection {
  text: string;
  /** The sentence (or so) around the selection, for translation */
  context: string;
  /** Where it is, in the open format's terms (for highlights); set by the view */
  anchor?: { location: string; progress: number };
  /** Inside a code block: the text as it is (lines and indentation kept) and its language, if the block says */
  code?: { text: string; language: string };
}

/** `language-python` (Markdown, EPUB), or Quarto's `sourceCode python` */
function codeLanguage(el: Element | null): string {
  for (let e = el; e; e = e.parentElement) {
    const cls = e.getAttribute('class') ?? '';
    const m = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(cls) ?? /(?:^|\s)sourceCode\s+(\w[\w+#-]*)/.exec(cls);
    if (m) return m[1].toLowerCase();
    if (e.tagName === 'PRE') break;
  }
  return '';
}

const BLOCK = 'p, li, dd, dt, td, th, blockquote, h1, h2, h3, h4, h5, h6, figcaption, div';

/** The selected text and the sentence around it, or null when nothing (or only spaces) is selected. */
export function readSelection(sel: Selection | null): TextSelection | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const node = sel.getRangeAt(0).startContainer;
  const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
  const pre = el?.closest('pre') ?? (el?.closest('code') && !el.closest('p, li') ? el.closest('code') : null);
  if (pre) {
    const raw = sel.toString().replace(/\s+$/, '');
    return { text, context: text, code: { text: raw, language: codeLanguage(el) } };
  }
  const block = el?.closest(BLOCK) ?? el;
  const whole = (block?.textContent ?? text).replace(/\s+/g, ' ').trim();
  const at = whole.indexOf(text);
  if (at < 0) return { text, context: text };
  const start = Math.max(0, ...['. ', '! ', '? ', '» ', '“ '].map((s) => whole.lastIndexOf(s, at) + (whole.lastIndexOf(s, at) >= 0 ? 2 : 0)));
  const ends = ['. ', '! ', '? '].map((s) => whole.indexOf(s, at + text.length)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : whole.length;
  return { text, context: whole.slice(start, end).slice(0, 600).trim() };
}

/** Calls `onChange` once a selection in `doc` (inside `within`, when given) settles. */
export function watchSelection(doc: Document, onChange: (s: TextSelection | null) => void,
                               within?: () => Element | null): () => void {
  let timer = 0;
  const handler = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const sel = doc.getSelection();
      const read = readSelection(sel);
      const root = within?.();
      if (read && root && sel?.anchorNode && !root.contains(sel.anchorNode)) return; // e.g. text in a dialog
      onChange(read);
    }, 350);
  };
  doc.addEventListener('selectionchange', handler);
  return () => { clearTimeout(timer); doc.removeEventListener('selectionchange', handler); };
}

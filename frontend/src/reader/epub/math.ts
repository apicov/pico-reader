/** Display math in the book's pages (KaTeX, MathML, MathJax output). */

/** Display math wider than its column is scaled down to fit (it ran into the next column or was cut off); again
 *  whenever the column's width or the text size changes. Math can't wrap, and scrolling sideways fights page turns. */
const refits = new WeakMap<Document, () => void>();

/** Fit the math of a section again now (after a change of the text size) */
export const refitDisplayMath = (doc: Document) => refits.get(doc)?.();

/** Returns what stops it */
export function fitDisplayMath(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const fit = () => doc.querySelectorAll<HTMLElement>('.katex-display, math[display="block"], mjx-container[display="true"]')
    .forEach((el) => {
      el.style.fontSize = '';
      el.style.overflowX = '';
      const ratio = el.clientWidth / el.scrollWidth;
      if (ratio >= 1) return;
      el.style.fontSize = `${Math.max(0.5, ratio * 0.98)}em`;
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowX = 'auto';  // too wide even at half size: it scrolls
    });
  // foliate widens the page as it adds columns: only the column's width and the text size matter
  let last = '';
  const check = () => {
    const now = `${getComputedStyle(doc.documentElement).columnWidth}|${getComputedStyle(doc.body).fontSize}`;
    if (now !== last) { last = now; win.requestAnimationFrame(fit); }
  };
  const observer = new win.ResizeObserver(check);
  observer.observe(doc.documentElement);
  refits.set(doc, check);
  void doc.fonts?.ready.then(() => win.requestAnimationFrame(fit));  // the math fonts change the widths
  return () => observer.disconnect();
}

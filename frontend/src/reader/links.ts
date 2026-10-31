/** A link out of the book (the web, mail) opens in the browser; anything else (javascript:, file:) does nothing.
 *  Returns whether it was such a link. */
export function openExternal(href: string): boolean {
  if (!/^(https?|mailto):/i.test(href)) return false;
  window.open(href, '_blank', 'noopener');
  return true;
}

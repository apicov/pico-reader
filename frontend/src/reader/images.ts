/** The picture a tap landed on, if any: an <img>, or an SVG <image> (EPUB covers and figures are often those).
 *  Tag names, not instanceof: the EPUB's pages are documents of their own (iframes), with their own classes. */
export function tappedImage(target: EventTarget | null): { src: string; alt: string } | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return null;
  const img = el.closest('img, image');
  if (!img) return null;
  if (img.tagName.toLowerCase() === 'img') {
    const i = img as HTMLImageElement;
    return i.currentSrc || i.src ? { src: i.currentSrc || i.src, alt: i.alt ?? '' } : null;
  }
  const href = img.getAttribute('href') ?? img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (!href) return null;
  return { src: new URL(href, img.ownerDocument.baseURI).href, alt: img.getAttribute('aria-label') ?? '' };
}

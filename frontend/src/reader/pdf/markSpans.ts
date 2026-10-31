/** A highlight on one page; `fraction`: how far down the page it was made */
export interface PageHighlight { text: string; color: string; fraction: number }

export const NO_HIGHLIGHTS: PageHighlight[] = [];

/** Tint the text-layer spans that hold a highlight's text (pdf.js spans are runs of a line, so this
 *  marks whole runs: close enough to see what was highlighted). Text found more than once on the page: the
 *  occurrence nearest to where the highlight was made. */
export function markSpans(layer: HTMLElement, highlights: PageHighlight[]) {
  const spans = [...layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')];
  let text = '';
  const bounds = spans.map((span) => {
    const start = text.length;
    text += `${(span.textContent ?? '').replace(/\s+/g, ' ')} `;
    return [start, text.length] as const;
  });
  const flat = text.replace(/\s+/g, ' ');
  const box = layer.getBoundingClientRect();
  // how far down the page an offset in `flat` is: by its span's place, or by its place in the text when nothing is laid out
  const down = (at: number) => {
    const span = spans[Math.max(0, bounds.findIndex(([, end]) => end > at))];
    return box.height && span ? (span.getBoundingClientRect().top - box.top) / box.height : at / flat.length;
  };
  for (const h of highlights) {
    const needle = h.text.replace(/\s+/g, ' ').trim();
    if (!needle) continue;
    const found: number[] = [];
    for (let i = flat.indexOf(needle); i >= 0; i = flat.indexOf(needle, i + 1)) found.push(i);
    if (!found.length) continue;
    const at = found.reduce((a, b) => (Math.abs(down(b) - h.fraction) < Math.abs(down(a) - h.fraction) ? b : a));
    spans.forEach((span, i) => {
      if (bounds[i][0] < at + needle.length && bounds[i][1] > at) span.classList.add('hl', `hl-${h.color || 'yellow'}`);
    });
  }
}

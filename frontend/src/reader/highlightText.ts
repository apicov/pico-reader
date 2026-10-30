/** Marks highlights in plain DOM text (reflow chapters): finds each highlight's text (whitespace-insensitive),
 *  the occurrence nearest to where it was made (how far down the chapter, as measured when it was made), and wraps
 *  it in <mark> elements. */

interface Piece { node: Text; start: number }

function textIndex(root: HTMLElement): { text: string; pieces: Piece[]; map: number[] } {
  // collapsed text (runs of whitespace → one space) and, per collapsed char, its position in the raw node text
  const pieces: Piece[] = [];
  const map: number[] = [];
  let text = '';
  let raw = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest('.katex, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    pieces.push({ node, start: raw });
    for (const ch of node.data) {
      if (/\s/.test(ch)) {
        if (!text.endsWith(' ')) { text += ' '; map.push(raw); }
      } else { text += ch; map.push(raw); }
      raw++;
    }
  }
  return { text, pieces, map };
}

export function markHighlights(root: HTMLElement, highlights: { id: string; text: string; fraction: number; color: string }[]): void {
  for (const h of highlights) {
    const { text, pieces, map } = textIndex(root);
    const needle = h.text.replace(/\s+/g, ' ').trim();
    if (!needle || !pieces.length) continue;
    const found: number[] = [];
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
    if (!found.length) continue;
    // one occurrence: that one; more: the one nearest the place, by its height on the page (by its place in the
    // text where nothing is laid out)
    const box = root.getBoundingClientRect();
    const down = (at: number) => {
      const raw = map[at];
      const piece = pieces.findLast((p) => p.start <= raw)!;
      const range = root.ownerDocument.createRange();
      range.setStart(piece.node, raw - piece.start);
      return box.height ? (range.getBoundingClientRect().top - box.top) / box.height : at / text.length;
    };
    const best = found.length === 1 ? found[0]
      : found.reduce((a, b) => (Math.abs(down(b) - h.fraction) < Math.abs(down(a) - h.fraction) ? b : a));
    const startRaw = map[best];
    const endRaw = map[best + needle.length - 1] + 1;
    // wrap each text node's part separately (a highlight can cross elements)
    const segments: { node: Text; from: number; to: number }[] = [];
    for (const p of pieces) {
      const from = Math.max(startRaw, p.start);
      const to = Math.min(endRaw, p.start + p.node.data.length);
      if (from < to) segments.push({ node: p.node, from: from - p.start, to: to - p.start });
    }
    for (const seg of segments.reverse()) {
      const range = root.ownerDocument.createRange();
      range.setStart(seg.node, seg.from);
      range.setEnd(seg.node, seg.to);
      const mark = root.ownerDocument.createElement('mark');
      mark.className = `hl hl-${h.color || 'yellow'}`;
      mark.dataset.highlight = h.id;
      range.surroundContents(mark);
    }
  }
}

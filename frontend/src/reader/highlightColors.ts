/** The highlight colours. EPUB draws them from here (foliate's overlay); the reflow text and the PDF text layer
 *  have them as CSS classes `hl-<name>` (reflow.css, pdf.css), a little lighter over plain text. */
export const HIGHLIGHT_COLORS = {
  yellow: 'rgba(255, 210, 0, 0.45)',
  green: 'rgba(80, 200, 120, 0.4)',
  blue: 'rgba(80, 150, 255, 0.38)',
} as const;

export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;

export const highlightColor = (name: string) => HIGHLIGHT_COLORS[name as HighlightColor] ?? HIGHLIGHT_COLORS.yellow;

/** The classes a marked highlight carries (to take them off again) */
export const HIGHLIGHT_CLASSES = ['hl', ...Object.keys(HIGHLIGHT_COLORS).map((c) => `hl-${c}`)];

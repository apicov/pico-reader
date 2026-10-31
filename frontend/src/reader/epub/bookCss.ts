/** The CSS foliate puts into each of the book's sections: the reading settings over the book's own styles. */
import type { Settings } from '@/contexts/SettingsContext';
import { READING_FONT, READING_THEMES } from '@/theme/readingThemes';

/** The app's @font-face rules with absolute URLs: the book's sections are separate documents (blob URLs),
 *  so they neither inherit the app's fonts nor resolve its relative font paths. */
let fontFaces: string | null = null;
function appFontFaces(): string {
  if (fontFaces !== null) return fontFaces;
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule && /Literata/.test(rule.style.getPropertyValue('font-family'))) {
        rules.push(rule.cssText.replace(/url\("?([^")]+)"?\)/g,
          (_, u: string) => `url("${new URL(u, sheet.href ?? location.href).href}")`));
      }
    }
  }
  fontFaces = rules.join('\n');
  return fontFaces;
}

/** The book's text styled by the reading settings (foliate injects this into each section). */
export function bookCss(s: Settings): string {
  const c = READING_THEMES[s.theme];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${appFontFaces()}
    /* foliate paints the page background itself, from --theme-bg-color (also on a theme change) */
    html { color-scheme: ${c.mode}; --theme-bg-color: ${c.background}; background: ${c.background} !important;
      -webkit-tap-highlight-color: ${c.tap}; }
    body { background: transparent !important; color: ${c.text} !important; font-size: ${18 * s.fontScale}px !important; }
    /* the reading font and colours win over the book's own (dark themes need it), except for code and math, which
       keep their own fonts (KaTeX places glyphs by its fonts' metrics) and colours (syntax highlighting, \\color);
       the exceptions sit in :where() so the rules' specificity, and so which book rules beat them, stays the same */
    body, body *:where(:not(.katex, .katex *, math, math *, mjx-container, mjx-container *)) {
      font-family: ${READING_FONT} !important; }
    pre, code, kbd, samp, pre *, code * { font-family: ui-monospace, monospace !important; }
    body *:not(a):where(:not(pre *, code *, .katex *, math *, mjx-container *)) { color: inherit !important; }
    p, li, blockquote, dd { line-height: ${s.lineHeight} !important; text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    a:link { color: ${c.accent} !important; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    /* a wide table fits its column (the page is in columns: wider, it ran over the next pages) */
    table { max-width: 100% !important; }
    td, th { overflow-wrap: anywhere; }
    ${c.mode === 'dark' ? 'img { filter: brightness(0.9); }' : ''}
    ::highlight(seen) { text-decoration: underline dotted ${c.accent} 1.5px; text-underline-offset: 3px; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

/** The page's side margins, per setting (on foliate's renderer, outside the sections) */
export const MARGIN_PX = { narrow: '0px', normal: '8px', wide: '32px' } as const;

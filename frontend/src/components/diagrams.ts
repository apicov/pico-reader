/** Mermaid diagrams in Markdown (```mermaid blocks, e.g. in notes): drawn as SVG where they appear. The library
 *  (a few MB) loads only when a text has a diagram. */
import { UI_FONT } from '@/theme/readingThemes';

let counter = 0;

export async function drawDiagrams(root: HTMLElement | null, dark: boolean): Promise<void> {
  if (!root) return;
  // code blocks not drawn yet, and diagrams to redraw (the theme changed)
  const blocks = [
    ...[...root.querySelectorAll('pre > code.language-mermaid')].map((c) => c.parentElement as HTMLElement),
    ...root.querySelectorAll<HTMLElement>('.diagram[data-src]'),
  ];
  if (!blocks.length) return;
  const { default: mermaid } = await import('mermaid');
  // one named font (text is measured with it, so labels fit their boxes); natural size, scrolled on a phone
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral',
    fontFamily: UI_FONT, flowchart: { useMaxWidth: false }, timeline: { useMaxWidth: false },
    mindmap: { useMaxWidth: false }, sequence: { useMaxWidth: false } });
  for (const block of blocks) {
    const src = block.dataset.src ?? block.textContent ?? '';
    if (!(await mermaid.parse(src, { suppressErrors: true }))) {
      block.classList.add('diagram-failed'); // shown as code, with a note (Markdown.tsx)
      continue;
    }
    const { svg } = await mermaid.render(`diagram-${++counter}`, src);
    const div = document.createElement('div');
    div.className = 'diagram';
    div.dataset.src = src;
    div.innerHTML = svg;
    block.replaceWith(div);
  }
}

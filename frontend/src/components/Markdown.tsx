import { useEffect, useMemo, useRef } from 'react';
import { Box, useTheme, type SxProps, type Theme } from '@mui/material';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { drawDiagrams } from './diagrams';

/** `||hidden||` → a spoiler span, blurred until tapped (community posts and comments). Not inside code. */
export function withSpoilers(md: string): string {
  return md.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part
    : part.replace(/\|\|([^|\n]+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>'))).join('');
}

/** "[3]" → a citation button, except inside code (a diagram's `A[1]` is a node, not a citation) */
export function citeButtons(html: string): string {
  return html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/).map((part, i) => (i % 2 ? part
    : part.replace(/\[(\d{1,3})\]/g, '<button type="button" class="cite" data-n="$1">$1</button>'))).join('');
}

/** Model answers and notes: Markdown, sanitized; "[3]" citations become buttons (`onCite(3)`), except in code;
 *  ```mermaid blocks become diagrams. */
export function Markdown({ text, onCite, sx }: { text: string; onCite?: (n: number) => void; sx?: SxProps<Theme> }) {
  const html = useMemo(() => {
    const raw = marked.parse(withSpoilers(text), { async: false, breaks: false, gfm: true });
    return DOMPurify.sanitize(citeButtons(raw), { ADD_ATTR: ['data-n'] });
  }, [text]);
  const ref = useRef<HTMLDivElement>(null);
  const dark = useTheme().palette.mode === 'dark';
  useEffect(() => { void drawDiagrams(ref.current, dark).catch(() => undefined); }, [html, dark]);
  return (
    <Box ref={ref} sx={{
      '& p': { m: 0, mb: 1.25 }, '& p:last-child': { mb: 0 }, '& ul, & ol': { pl: 3, my: 1 }, '& li': { mb: 0.5 },
      '& code': { fontSize: '0.88em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
      '& button.cite': { border: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', p: '0 0.15em',
        fontSize: '0.72em', fontWeight: 700, verticalAlign: 'super', fontFamily: 'inherit' },
      '& .spoiler:not(.shown)': { filter: 'blur(5px)', cursor: 'pointer', bgcolor: 'action.hover', borderRadius: 0.5 },
      '& blockquote': { m: 0, my: 1, pl: 1.5, borderLeft: 3, borderColor: 'divider', color: 'text.secondary' },
      '& pre': { overflowX: 'auto', bgcolor: 'action.hover', p: 1, borderRadius: 1 },
      '& pre code': { bgcolor: 'transparent', px: 0 },
      '& .diagram': { my: 1.5, overflowX: 'auto', textAlign: 'center', '& svg': { maxWidth: 'none', height: 'auto' } },
      '& pre.diagram-failed::before': { content: '"This diagram couldn\'t be drawn:"', display: 'block',
        fontFamily: 'inherit', fontSize: '0.8em', color: 'text.secondary', mb: 0.5 },
      '& h2, & h3': { fontSize: '1.1em', mt: 2, mb: 1 },
      ...sx,
    }}
      onClick={(e) => {
        (e.target as HTMLElement).closest('.spoiler')?.classList.add('shown');
        const n = (e.target as HTMLElement).closest('button.cite')?.getAttribute('data-n');
        if (n && onCite) onCite(Number(n));
      }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}

import { useMemo } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Model answers: light Markdown, sanitized; "[3]" citations become buttons (`onCite(3)`). */
export function Markdown({ text, onCite, sx }: { text: string; onCite?: (n: number) => void; sx?: SxProps<Theme> }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, breaks: false, gfm: true });
    const cited = raw.replace(/\[(\d{1,2})\]/g, '<button type="button" class="cite" data-n="$1">$1</button>');
    return DOMPurify.sanitize(cited, { ADD_ATTR: ['data-n'] });
  }, [text]);
  return (
    <Box sx={{
      '& p': { m: 0, mb: 1.25 }, '& p:last-child': { mb: 0 }, '& ul, & ol': { pl: 3, my: 1 }, '& li': { mb: 0.5 },
      '& code': { fontSize: '0.88em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
      '& button.cite': { border: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', p: '0 0.15em',
        fontSize: '0.72em', fontWeight: 700, verticalAlign: 'super', fontFamily: 'inherit' },
      ...sx,
    }}
      onClick={(e) => {
        const n = (e.target as HTMLElement).closest('button.cite')?.getAttribute('data-n');
        if (n && onCite) onCite(Number(n));
      }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}

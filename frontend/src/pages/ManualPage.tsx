/**
 * The user manual: every feature, with pictures of the real screens. The content is data
 * (components/manual/chapters.ts); this page lays it out: a contents list (beside the text on wide screens,
 * folded on phones), a search box that filters the sections, and `?s=<chapter>[.<section>]` links (the app uses a
 * HashRouter, so `#anchors` can't be used).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Collapse, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { MANUAL_CHAPTERS } from '@/components/manual/chapters';
import { nodeText } from '@/components/manual/searchText';
import type { ManualChapter, ManualSection } from '@/components/manual/types';
import { READING_FONT } from '@/theme/readingThemes';

const anchorId = (target: string) => `manual-${target.replace('.', '--')}`;

interface Indexed {
  chapter: ManualChapter;
  sections: { section: ManualSection; text: string }[];
}

function Contents({ chapters, onGo }: { chapters: Indexed[]; onGo: (target: string) => void }) {
  const link = { p: 0, border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left',
    cursor: 'pointer', '&:hover': { color: 'primary.main' } } as const;
  return (
    <Box component="nav" aria-label="Manual contents">
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {chapters.map(({ chapter, sections }) => {
          const Icon = chapter.icon;
          return (
            <Box component="li" key={chapter.id} sx={{ mb: 1.25 }}>
              <Box component="button" type="button" onClick={() => onGo(chapter.id)}
                sx={{ ...link, display: 'flex', gap: 1, alignItems: 'center', fontWeight: 600, py: 0.25 }}>
                <Icon /> {chapter.title}
              </Box>
              <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, pl: 4.25 }}>
                {sections.map(({ section }) => (
                  <Box component="li" key={section.id}>
                    <Box component="button" type="button" onClick={() => onGo(`${chapter.id}.${section.id}`)}
                      sx={{ ...link, color: 'text.secondary', fontSize: 14, py: 0.4 }}>
                      {section.title}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default function ManualPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [contentsOpen, setContentsOpen] = useState(false);
  const target = params.get('s');

  // the text of each section for the search box, once (the content doesn't change)
  const index = useMemo<Indexed[]>(() => MANUAL_CHAPTERS.map((chapter) => ({
    chapter,
    sections: chapter.sections.map((section) => ({
      section, text: `${chapter.title} ${section.title} ${nodeText(section.body)}`.toLowerCase(),
    })),
  })), []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return index;
    const words = q.split(/\s+/);
    return index
      .map((c) => ({ ...c, sections: c.sections.filter((s) => words.every((w) => s.text.includes(w))) }))
      .filter((c) => c.sections.length > 0);
  }, [index, q]);

  // a link or the contents: scroll there once it's shown, and again when the pictures above it have loaded
  useEffect(() => {
    if (!target) return;
    const scroll = (behavior: ScrollBehavior) =>
      document.getElementById(anchorId(target))?.scrollIntoView?.({ behavior, block: 'start' });
    scroll('smooth');
    const timers = [700, 1600, 3000].map((ms) => window.setTimeout(() => scroll('auto'), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [target, visible]);

  const go = (to: string) => {
    setQuery('');
    setContentsOpen(false);
    setParams({ s: to }, { replace: true });
    if (to === target) document.getElementById(anchorId(to))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const toTop = () => {
    setParams({}, { replace: true });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  return (
    <Box sx={{ display: 'flex', gap: 5, alignItems: 'flex-start', maxWidth: 1100, mx: 'auto' }}>
      <Box component="aside" sx={{ display: { xs: 'none', md: 'block' }, width: 260, flexShrink: 0, position: 'sticky',
        top: 88, maxHeight: 'calc(100vh - 110px)', overflowY: 'auto', pr: 1 }}>
        <Typography variant="overline" color="text.secondary">Contents</Typography>
        <Contents chapters={index} onGo={go} />
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, maxWidth: 760, fontSize: 16, lineHeight: 1.65,
        '& h3': { fontSize: 19, mt: 3.5, mb: 1 }, '& ul, & ol': { pl: 3 }, '& li': { mb: 0.5 },
        '& pre': { p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 14 },
        '& code': { fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' } }}>
        <Typography variant="h4" component="h1" sx={{ fontFamily: READING_FONT, mb: 0.5 }}>User manual</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Everything Pico Reader can do, from reading your first book to studying on your computer.
        </Typography>
        <TextField fullWidth size="small" placeholder="Search the manual…" value={query} onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search the manual' },
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear the search" onClick={() => setQuery('')}><ClearIcon fontSize="small" /></IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }} />

        <Box sx={{ display: { md: 'none' }, mt: 1.5, border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5 }}>
          <Button fullWidth color="inherit" onClick={() => setContentsOpen((v) => !v)} aria-expanded={contentsOpen}
            endIcon={contentsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ justifyContent: 'space-between', py: 1 }}>
            Contents
          </Button>
          <Collapse in={contentsOpen}><Box sx={{ pb: 1.5 }}><Contents chapters={index} onGo={go} /></Box></Collapse>
        </Box>

        {q && (
          <Typography role="status" color="text.secondary" sx={{ mt: 2 }}>
            {visible.length === 0
              ? `Nothing in the manual mentions “${query.trim()}”.`
              : `${visible.reduce((n, c) => n + c.sections.length, 0)} sections mention “${query.trim()}”.`}
          </Typography>
        )}

        {visible.map(({ chapter, sections }) => {
          const Icon = chapter.icon;
          return (
            <Box component="article" key={chapter.id} id={anchorId(chapter.id)} sx={{ mt: 5, scrollMarginTop: 88 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', pb: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ color: 'primary.main', display: 'flex', '& svg': { fontSize: 32 } }}><Icon /></Box>
                <div>
                  <Typography variant="h5" component="h2" sx={{ fontFamily: READING_FONT }}>{chapter.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{chapter.summary}</Typography>
                </div>
              </Stack>
              {sections.map(({ section }) => (
                <Box component="section" key={section.id} id={anchorId(`${chapter.id}.${section.id}`)} sx={{ scrollMarginTop: 88 }}>
                  <h3>{section.title}</h3>
                  {section.body}
                </Box>
              ))}
              <Button size="small" onClick={toTop} sx={{ mt: 1 }}>↑ Back to the top</Button>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

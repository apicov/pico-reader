import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DOMPurify from 'dompurify';
import { Link as RouterLink } from 'react-router-dom';
import { languageName } from '@/services/languages';
import { dictImages, lookUp, preferredDict, setPreferredDict, type Lookup } from './lookup';
import './dict.css';

/** A definition's HTML, sanitized; images from the dictionary's res zip; bword:// links look words up. */
function Definition({ html, dictId, onWord }: { html: string; dictId: string; onWord: (w: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: /^(?:bword:|https?:|[^:]*$)/i });
    const imgs = el.querySelectorAll<HTMLImageElement>('img[src]');
    if (imgs.length) {
      void dictImages(dictId).then((map) => imgs.forEach((img) => {
        const url = map.get(img.getAttribute('src') ?? '');
        if (url) img.src = url; else img.remove();
      })).catch(() => imgs.forEach((img) => img.remove()));
    }
  }, [html, dictId]);
  return (
    <div ref={ref} className="dict-def" onClick={(e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('bword://')) onWord(decodeURIComponent(href.slice(8)));
      else if (/^https?:/.test(href)) window.open(href, '_blank', 'noopener');
    }} />
  );
}

export function DictResults({ word, language, dark }: { word: string; language: string; dark: boolean }) {
  const [current, setCurrent] = useState(word);
  const [result, setResult] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(true);
  const [preferred, setPreferred] = useState<string | null>(null);

  useEffect(() => setCurrent(word), [word]);
  useEffect(() => { void preferredDict(language).then(setPreferred); }, [language]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void lookUp(current, language).then((r) => { if (!cancelled) { setResult(r); setBusy(false); } })
      .catch(() => { if (!cancelled) { setResult(null); setBusy(false); } });
    return () => { cancelled = true; };
  }, [current, language]);

  if (busy && !result) return <Box sx={{ p: 2, textAlign: 'center' }}><CircularProgress size={20} /></Box>;
  if (!result) return null;
  const nothingInstalled = !result.results.length && !result.suggestions.length;
  return (
    <Box className={dark ? 'dict-dark' : undefined}>
      {current !== word && (
        <Button size="small" onClick={() => setCurrent(word)} sx={{ mb: 1 }}>← {word}</Button>
      )}
      {result.results.map(({ dict, entries, loose }) => (
        <Box key={dict.id} sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
            <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }} noWrap>
              {dict.name} · {languageName(dict.to_lang)}{loose ? ' · without accents' : ''}
            </Typography>
            <Tooltip title="Show this dictionary first">
              <IconButton size="small" onClick={() => { void setPreferredDict(language, dict.id); setPreferred(dict.id); }}>
                {preferred === dict.id ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          {entries.slice(0, 6).map((e, i) => (
            <Box key={i} sx={{ mb: 1.5 }}>
              <Typography sx={{ fontWeight: 600, fontFamily: 'Literata, serif' }}>{e.headword}</Typography>
              <Definition html={e.def} dictId={dict.id} onWord={setCurrent} />
            </Box>
          ))}
        </Box>
      ))}
      {!result.results.length && result.suggestions.length > 0 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>“{result.word}” isn't in your dictionaries. Did you mean:</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {result.suggestions.map((s) => <Chip key={s} label={s} onClick={() => setCurrent(s)} variant="outlined" />)}
          </Stack>
        </Box>
      )}
      {nothingInstalled && (
        <Typography variant="body2" color="text.secondary">
          No {languageName(language)} dictionary found “{result.word}” (or none is installed). {' '}
          <RouterLink to="/dictionaries">Install dictionaries</RouterLink>
        </Typography>
      )}
    </Box>
  );
}

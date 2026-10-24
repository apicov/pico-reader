import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DOMPurify from 'dompurify';
import { Link as RouterLink } from 'react-router-dom';
import { languageName } from '@/services/languages';
import { recordLookup } from '@/services/events';
import { api } from '@/services/api';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { addCard } from '@/services/review';
import { markKnown } from '@/services/words';
import { useSettings } from '@/contexts/SettingsContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import CheckIcon from '@mui/icons-material/Check';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
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

/** A review card for a looked-up word: its dictionary form, the first definition as plain text, its sentence */
function cardFor(r: Lookup, record: { bookId: string; context: string }): Promise<boolean> {
  const first = r.results[0];
  const entry = first.entries[0];
  const tmp = document.createElement('div');
  tmp.innerHTML = DOMPurify.sanitize(entry.def);
  const meaning = (tmp.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return addCard({ language: first.dict.from_lang, term: entry.headword, meaning, example: record.context.slice(0, 500),
    source: 'lookup', book_id: record.bookId });
}

export function DictResults({ word, language, dark, record }: {
  word: string; language: string; dark: boolean;
  /** Record the lookup of `word` for the statistics (not the words followed from a definition) */
  record?: { bookId: string; location: string; context: string };
}) {
  const { settings } = useSettings();
  const online = useOnlineStatus();
  const [known, setKnown] = useState(false);
  const [ai, setAi] = useState<{ lemma: string; part_of_speech: string; meaning: string; notes: string } | 'asking' | 'failed' | null>(null);
  const [carded, setCarded] = useState(false);
  const recorded = useRef('');
  const [current, setCurrent] = useState(word);
  const [result, setResult] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(true);
  const [preferred, setPreferred] = useState<string | null>(null);

  useEffect(() => { setCurrent(word); setAi(null); setKnown(false); setCarded(false); }, [word]);
  useEffect(() => { void preferredDict(language).then(setPreferred); }, [language]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void lookUp(current, language).then((r) => {
      if (record && current === word && recorded.current !== `${word}|${record.location}`) {
        recorded.current = `${word}|${record.location}`;
        void recordLookup({ book_id: record.bookId, language, word: r.word, location: record.location,
          matched: r.results[0]?.entries[0]?.headword ?? '', dictionaries: r.results.map((x) => x.dict.id),
          found: r.results.length > 0, context: record.context.slice(0, 1000) });
        if (settings.autoReview && r.results.length) void cardFor(r, record).then(setCarded);
        // no dictionary has it: ask the model, with the sentence for context
        if (!r.results.length && online) {
          setAi('asking');
          void api<{ lemma: string; part_of_speech: string; meaning: string; notes: string }>('/api/define', {
            method: 'POST', body: { word: r.word, context: record.context.slice(0, 1500), language, target_lang: settings.targetLanguage },
          }).then((d) => {
            setAi(d);
            if (settings.autoReview) void addCard({ language, term: d.lemma, meaning: d.meaning, example: record.context.slice(0, 500),
              source: 'lookup', book_id: record.bookId }).then(setCarded);
          }).catch(() => setAi('failed'));
        }
      }
      if (!cancelled) { setResult(r); setBusy(false); }
    })
      .catch(() => { if (!cancelled) { setResult(null); setBusy(false); } });
    return () => { cancelled = true; };
  }, [current, language]);

  if (busy && !result) return <Box sx={{ p: 2, textAlign: 'center' }}><CircularProgress size={20} /></Box>;
  if (!result) return null;
  const nothingInstalled = !result.results.length && !result.suggestions.length && !ai;
  const aiBlock = ai && current === word && (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>AI · not in your dictionaries</Typography>
      </Stack>
      {ai === 'asking' && <CircularProgress size={16} />}
      {ai === 'failed' && <Typography variant="body2" color="text.secondary">The AI couldn't define it right now.</Typography>}
      {typeof ai === 'object' && (
        <>
          <Typography sx={{ fontWeight: 600, fontFamily: 'Literata, serif' }}>
            {ai.lemma}{ai.part_of_speech ? <Typography component="span" variant="body2" color="text.secondary"> · {ai.part_of_speech}</Typography> : null}
          </Typography>
          <Typography className="dict-def">{ai.meaning}</Typography>
          {ai.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{ai.notes}</Typography>}
        </>
      )}
    </Box>
  );
  const headword = result.results[0]?.entries[0]?.headword ?? result.word;
  return (
    <Box className={dark ? 'dict-dark' : undefined}>
      {record && result.results.length > 0 && current === word && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button size="small" variant="outlined" startIcon={<CheckIcon />} disabled={known || !online}
            onClick={() => void markKnown(language, headword).then(() => setKnown(true))}>
            {known ? 'Known' : 'I know this'}
          </Button>
          {!settings.autoReview && (
            <Button size="small" startIcon={<SchoolOutlinedIcon />} disabled={carded}
              onClick={() => void cardFor(result, record).then(() => setCarded(true))}>
              {carded ? 'In review' : 'Add to review'}
            </Button>
          )}
        </Stack>
      )}
      {current !== word && (
        <Button size="small" onClick={() => setCurrent(word)} sx={{ mb: 1 }}>← {word}</Button>
      )}
      {aiBlock}
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
      {!result.results.length && result.suggestions.length > 0 && !(ai && typeof ai === 'object') && (
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

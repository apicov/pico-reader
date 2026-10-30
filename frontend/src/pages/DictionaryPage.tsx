import { useEffect, useState } from 'react';
import { Autocomplete, Box, InputAdornment, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useSearchParams } from 'react-router-dom';
import { TranslationHistory } from '@/components/TranslationHistory';
import { useSettings } from '@/contexts/SettingsContext';
import { dictsFor } from '@/dict/lookup';
import { DictResults } from '@/dict/DictResults';
import { cleanWord, fold, keyOf } from '@/dict/normalize';
import { backend } from '@/dict/store';
import { languageName } from '@/services/languages';

const NO_RECORD_PLACE = { bookId: null, location: '', context: '' };

/** Headwords starting like `text` in all the dictionaries, for the search box */
async function suggest(text: string): Promise<string[]> {
  const stem = fold(keyOf(cleanWord(text)));
  if (!stem) return [];
  const lists = await Promise.all((await dictsFor()).map((d) => backend.prefix(d.id, stem, 10)));
  return [...new Set(lists.flat())].slice(0, 12);
}

/** A dictionary on its own (GoldenDict style): every offline dictionary, of any language, first; the AI when
 *  none has the word (it tells the word's language: a translation into the reader's language and a definition
 *  in the word's own); the translations made in books in the second tab. The word is in the address, so back
 *  and forward step through the words looked up. */
export default function DictionaryPage() {
  const [params, setParams] = useSearchParams();
  const { settings } = useSettings();
  const dark = useTheme().palette.mode === 'dark';
  const tab = params.get('tab') === 'history' ? 'history' : 'lookup';
  const word = params.get('w') ?? '';
  const [input, setInput] = useState(word);
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => { setInput(word); }, [word]);

  useEffect(() => {
    if (!input.trim()) { setOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void suggest(input).then((s) => { if (!cancelled) setOptions(s); }).catch(() => undefined);
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input]);

  const go = (next: { tab?: string; w?: string }) => {
    const p: Record<string, string> = {};
    if (next.tab === 'history') p.tab = 'history';
    else {
      const w = cleanWord(next.w ?? word);
      if (w) p.w = w;
    }
    setParams(p);
  };
  const lookUpWord = (w: string | null) => { if (w?.trim()) go({ w }); };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Tabs value={tab} onChange={(_, t) => go({ tab: t })} sx={{ mb: 2 }}>
        <Tab value="lookup" label="Dictionary" />
        <Tab value="history" label="Translations" />
      </Tabs>
      {tab === 'history' ? <TranslationHistory /> : (
        <>
          <Autocomplete freeSolo autoHighlight={false} options={options} filterOptions={(o) => o}
            inputValue={input} onInputChange={(_, v) => setInput(v)} onChange={(_, v) => lookUpWord(v)}
            sx={{ mb: 2 }}
            renderInput={({ InputProps, inputProps, InputLabelProps, ...p }) => (
              <TextField {...p} autoFocus size="small" placeholder="Look up a word"
                slotProps={{
                  inputLabel: InputLabelProps,
                  input: { ...InputProps, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
                  htmlInput: { ...inputProps, enterKeyHint: 'search', 'aria-label': 'Word' },
                }} />
            )} />
          {word ? (
            // '': the word's own language, whichever the AI finds it is
            <DictResults word={word} dark={dark} record={NO_RECORD_PLACE} aiTargets={[settings.targetLanguage, '']} />
          ) : (
            <Typography color="text.secondary">
              All your offline dictionaries are searched first; when none has the word, the AI translates it into{' '}
              {languageName(settings.targetLanguage)} and explains it in its own language.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

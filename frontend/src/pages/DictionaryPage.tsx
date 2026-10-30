import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, InputAdornment, MenuItem, Select, Stack, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useSearchParams } from 'react-router-dom';
import { TranslationHistory } from '@/components/TranslationHistory';
import { useSettings } from '@/contexts/SettingsContext';
import { dictsFor } from '@/dict/lookup';
import { DictResults } from '@/dict/DictResults';
import { cleanWord, fold, keyOf } from '@/dict/normalize';
import { backend, isCurrent } from '@/dict/store';
import { useInstalledDicts } from '@/hooks/useInstalledDicts';
import { useLibrary } from '@/hooks/useLibrary';
import { getPref, setPref } from '@/services/prefs';
import { LANGUAGES, languageName } from '@/services/languages';
import { readingNow } from '@/reader/readingNow';

const LAST_LANGUAGE = 'dictionary_page_language';
const NO_RECORD_PLACE = { bookId: null, location: '', context: '' };

/** Headwords starting like `text` in the language's dictionaries, for the search box */
async function suggest(text: string, language: string): Promise<string[]> {
  const stem = fold(keyOf(cleanWord(text)));
  if (!stem) return [];
  const lists = await Promise.all((await dictsFor(language)).map((d) => backend.prefix(d.id, stem, 10)));
  return [...new Set(lists.flat())].slice(0, 12);
}

/** A dictionary on its own (GoldenDict style): the offline dictionaries first, the AI when none has the word
 *  (a translation into the reader's language and a definition in the word's own); the translations made in
 *  books in the second tab. The language and the word are in the address, so back and forward step through
 *  the words looked up. */
export default function DictionaryPage() {
  const [params, setParams] = useSearchParams();
  const { settings } = useSettings();
  const { library } = useLibrary();
  const installed = useInstalledDicts();
  const dark = useTheme().palette.mode === 'dark';
  const tab = params.get('tab') === 'history' ? 'history' : 'lookup';
  const word = params.get('w') ?? '';
  const [fallback, setFallback] = useState('');
  const language = params.get('lang') || fallback;
  const [input, setInput] = useState(word);
  const [options, setOptions] = useState<string[]>([]);

  // languages with a dictionary installed first
  const withDicts = useMemo(() => [...new Set(Object.values(installed).filter(isCurrent).map((d) => d.from_lang))].sort(),
    [installed]);
  const languages = [...withDicts, ...Object.keys(LANGUAGES).filter((l) => !withDicts.includes(l))];

  // no language in the address: the last one used here, else the open book's, else one with dictionaries
  useEffect(() => {
    if (params.get('lang')) return;
    void getPref<string>(LAST_LANGUAGE).then((last) => {
      const open = readingNow();
      const bookLanguage = open && library?.books.find((b) => b.id === open.id)?.language;
      setFallback(last || bookLanguage || withDicts[0] || settings.targetLanguage);
    });
  }, [params, library, withDicts, settings.targetLanguage]);

  useEffect(() => { setInput(word); }, [word]);

  useEffect(() => {
    if (!language || !input.trim()) { setOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void suggest(input, language).then((s) => { if (!cancelled) setOptions(s); }).catch(() => undefined);
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, language]);

  const go = (next: { tab?: string; lang?: string; w?: string }) => {
    const p: Record<string, string> = {};
    const lang = next.lang ?? language;
    if (next.tab === 'history') p.tab = 'history';
    else {
      if (lang) p.lang = lang;
      const w = cleanWord(next.w ?? word);
      if (w) p.w = w;
    }
    setParams(p);
  };
  const lookUpWord = (w: string | null) => { if (w?.trim()) go({ w }); };
  const changeLanguage = (lang: string) => {
    void setPref(LAST_LANGUAGE, lang);
    go({ lang });
  };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Tabs value={tab} onChange={(_, t) => go({ tab: t })} sx={{ mb: 2 }}>
        <Tab value="lookup" label="Dictionary" />
        <Tab value="history" label="Translations" />
      </Tabs>
      {tab === 'history' ? <TranslationHistory /> : (
        <>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
            <Autocomplete freeSolo autoHighlight={false} options={options} filterOptions={(o) => o}
              inputValue={input} onInputChange={(_, v) => setInput(v)} onChange={(_, v) => lookUpWord(v)}
              sx={{ flex: 1 }}
              renderInput={({ InputProps, inputProps, InputLabelProps, ...p }) => (
                <TextField {...p} autoFocus size="small" placeholder={`Look up a word in ${languageName(language)}`}
                  slotProps={{
                    inputLabel: InputLabelProps,
                    input: { ...InputProps, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
                    htmlInput: { ...inputProps, lang: language, enterKeyHint: 'search', 'aria-label': 'Word' },
                  }} />
              )} />
            <Select size="small" value={languages.includes(language) ? language : ''} aria-label="Language"
              onChange={(e) => changeLanguage(e.target.value)} sx={{ minWidth: 140 }}>
              {languages.map((l) => <MenuItem key={l} value={l}>{languageName(l)}</MenuItem>)}
            </Select>
          </Stack>
          {word && language ? (
            <DictResults word={word} language={language} dark={dark} record={NO_RECORD_PLACE}
              aiTargets={[settings.targetLanguage, language]} />
          ) : (
            <Typography color="text.secondary">
              Your offline dictionaries are searched first; when none has the word, the AI translates it into{' '}
              {languageName(settings.targetLanguage)} and explains it in {languageName(language)}.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

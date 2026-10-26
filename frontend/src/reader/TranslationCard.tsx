import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useSettings } from '@/contexts/SettingsContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { languageName } from '@/services/languages';
import { findLocal, translate, type Translation } from '@/services/translations';
import { ModelNote } from '@/components/ModelNote';
import { READING_FONT } from '@/theme/readingThemes';
import { addCard } from '@/services/review';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';

/** Translate a passage on request; shows a stored translation of the same passage at once. */
export function TranslationCard({ text, context, language, bookId, location, onTerm }: {
  text: string; context: string; language: string; bookId: string; location: string;
  onTerm?: (term: string) => void;
}) {
  const { settings } = useSettings();
  const online = useOnlineStatus();
  const [result, setResult] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<number | null>(null);
  const target = settings.targetLanguage;

  useEffect(() => {
    setResult(null);
    setError('');
    void findLocal(text, target).then((t) => t && setResult(t));
  }, [text, target]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await translate({ text, context, source_lang: language === target ? '' : language,
        target_lang: target, book_id: bookId, location }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!result) {
    return (
      <Box>
        <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <TranslateIcon />}
          disabled={busy || !online} onClick={() => void run()}>
          Translate into {languageName(target)}
        </Button>
        {!online && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Translating needs a connection; saved translations show offline.</Typography>}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Box>
    );
  }
  return (
    <Box>
      <Typography sx={{ fontFamily: READING_FONT, fontSize: 17, lineHeight: 1.55 }} lang={result.target_lang}>
        {result.translation}
      </Typography>
      {result.notes && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{result.notes}</Typography>
      )}
      {result.vocabulary.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {result.vocabulary.map((v) => (
            <Stack key={v.term} direction="row" spacing={1} alignItems="baseline">
              <Chip size="small" variant="outlined" label={v.term} lang={language}
                onClick={onTerm ? () => onTerm(v.term.replace(/^(der|die|das|el|la|los|las|le|la|les|o|a|os|as)\s+/i, '')) : undefined} />
              <Typography variant="body2">{v.meaning}</Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {result.vocabulary.length > 0 && (
        <Button size="small" startIcon={<SchoolOutlinedIcon />} sx={{ mt: 1 }} disabled={added !== null}
          onClick={() => void Promise.all(result.vocabulary.map((v) => addCard({ language, term: v.term, meaning: v.meaning,
            example: text, source: 'translation', book_id: bookId }))).then((r) => setAdded(r.filter(Boolean).length))}>
          {added === null ? 'Add words to review' : `${added} added to review`}
        </Button>
      )}
      <ModelNote models={result.model} via={result.via} />
    </Box>
  );
}

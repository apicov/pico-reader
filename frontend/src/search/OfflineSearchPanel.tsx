import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Box, Card, CardActionArea, CardContent, CircularProgress, InputAdornment, IconButton, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { Book } from '@/services/types';
import { READING_FONT } from '@/theme/readingThemes';
import { searchOffline, type LocalPassage } from './localIndex';
import { offlineSearchEnabled, offlineSearchWordsOnly, searchableOffline } from './offlineSearch';

/** Without a connection the chat can't answer, but the downloaded books can still be searched on the device. */
export function OfflineSearchPanel({ books, onOpen }: { books: Book[]; onOpen: (p: LocalPassage) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [ready, setReady] = useState<Book[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LocalPassage[] | null>(null);
  const [error, setError] = useState('');
  const [wordsOnly, setWordsOnly] = useState(false);

  useEffect(() => {
    void offlineSearchEnabled().then(setEnabled);
    void offlineSearchWordsOnly().then(setWordsOnly);
    void searchableOffline(books).then(setReady);
  }, [books]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    try {
      setResults(await searchOffline(query.trim(), ready, wordsOnly));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (enabled === false) {
    return <Alert severity="info">Offline: the chat needs a connection. Switch on offline search in Settings to search downloaded books without one.</Alert>;
  }
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        Offline: searching {ready.length ? ready.map((b) => b.title).join(', ') : 'no book yet (open a book once while online)'} on this device
        {wordsOnly ? ' by words only (the search model can’t run on this device).' : '.'}
      </Alert>
      <Box component="form" onSubmit={run}>
        <TextField fullWidth value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your downloaded books"
          disabled={!ready.length}
          slotProps={{ input: { endAdornment: (
            <InputAdornment position="end">
              <IconButton type="submit" aria-label="Search offline" disabled={busy || !query.trim()}>
                {busy ? <CircularProgress size={20} /> : <SearchIcon />}
              </IconButton>
            </InputAdornment>
          ) } }} />
      </Box>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {results && (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {results.length === 0 && <Typography color="text.secondary">Nothing found.</Typography>}
          {results.map((p, i) => (
            <Card key={`${p.book_id}-${p.location}-${i}`}>
              <CardActionArea onClick={() => onOpen(p)}>
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Typography variant="caption" color="text.secondary">{p.title}{p.heading ? ` · ${p.heading}` : ''}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: READING_FONT, mt: 0.25 }}>
                    {p.text.length > 280 ? `${p.text.slice(0, 280)}…` : p.text}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}

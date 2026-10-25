import { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, LinearProgress, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { serverVectors } from '@/search/localIndex';
import { embedTexts, loadModel } from '@/search/localModel';
import { fetchSearchFiles, offlineSearchEnabled, offlineSearchWordsOnly, searchableOffline, setOfflineSearch,
  setOfflineSearchWordsOnly } from '@/search/offlineSearch';
import type { Book } from '@/services/types';

/** Offline search: the model on the device + the downloaded books' search files; and the in-browser test. */
export function OfflineSearchSettings() {
  const online = useOnlineStatus();
  const { library } = useLibrary();
  const [on, setOn] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState<Book[]>([]);
  const [error, setError] = useState('');
  const [wordsOnly, setWordsOnly] = useState(false);
  const [testBook, setTestBook] = useState('');
  const [test, setTest] = useState<string | null>(null);

  const refreshReady = async () => setReady(await searchableOffline(library?.books ?? []));
  useEffect(() => { void offlineSearchEnabled().then(setOn); void offlineSearchWordsOnly().then(setWordsOnly); }, []);
  useEffect(() => { void refreshReady(); }, [library]);  // eslint-disable-line react-hooks/exhaustive-deps

  const enable = async (value: boolean) => {
    setOn(value);
    await setOfflineSearch(value);
    if (!value) return;
    setError('');
    setProgress(0);
    try {
      // Without the model (an old WebView), offline search still works by words
      const model = await loadModel(setProgress).then(() => true, (e: Error) => {
        console.warn('Offline search model:', e.message);
        return false;
      });
      setWordsOnly(!model);
      await setOfflineSearchWordsOnly(!model);
      await fetchSearchFiles(library?.books ?? []);
      await refreshReady();
    } catch (e) {
      setError(`Offline search couldn't be set up: ${(e as Error).message}`);
      setOn(false);
      await setOfflineSearch(false);
    } finally {
      setProgress(null);
    }
  };

  const runTest = async () => {
    const book = ready.find((b) => b.id === testBook);
    if (!book) return;
    setTest('Embedding the passages in this browser…');
    try {
      const { texts, vectors } = await serverVectors(book);
      const sample = Math.min(texts.length, 120);
      const t0 = performance.now();
      const mine = await embedTexts(texts.slice(0, sample), 'passage');
      const seconds = (performance.now() - t0) / 1000;
      const cos = mine.map((v, i) => v.reduce((s, x, d) => s + x * vectors[i][d], 0));
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      setTest(`${sample} passages in ${seconds.toFixed(1)} s (${(sample / seconds).toFixed(1)} per second; the whole book `
        + `would take about ${Math.ceil((texts.length / (sample / seconds)) / 60)} min). Same as the server's vectors: `
        + `average similarity ${(cos.reduce((a, b) => a + b, 0) / cos.length).toFixed(4)}, lowest ${Math.min(...cos).toFixed(4)}.`
        + (mem ? ` JavaScript memory: ${(mem.usedJSHeapSize / 1e6).toFixed(0)} MB.` : ''));
    } catch (e) {
      setTest(`The test failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box>
      <Typography variant="h6">Offline search</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Search your downloaded books without a connection. Downloads the search model once (about 135 MB) and each
        downloaded book's search file.
      </Typography>
      <FormControlLabel control={<Switch checked={on} disabled={progress !== null || (!online && !on)}
        onChange={(e) => void enable(e.target.checked)} />} label={on ? 'On' : 'Off'} />
      {progress !== null && <LinearProgress variant={progress > 0 ? 'determinate' : 'indeterminate'} value={progress * 100} sx={{ my: 1 }} />}
      {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
      {on && wordsOnly && progress === null && (
        <Alert severity="info" sx={{ my: 1 }}>
          This device can't run the search model (its WebView is too old), so offline search matches words, not
          meaning. On Android, updating “Android System WebView” from the Play Store and switching offline search
          off and on again may fix this.
        </Alert>
      )}
      {on && progress === null && (
        <Typography variant="body2" color="text.secondary">
          {ready.length ? `Searchable offline: ${ready.map((b) => b.title).join(', ')}` : 'No downloaded book has its search file yet: open a book once while online.'}
        </Typography>
      )}
      {on && !wordsOnly && ready.length > 0 && (
        <Stack spacing={1} sx={{ mt: 2, maxWidth: 420 }}>
          <Typography variant="subtitle2">Test: index a book in this browser</Typography>
          <Typography variant="caption" color="text.secondary">
            Embeds the passages of a book here (transformers.js) and compares them with the server's, to see how this device copes.
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField select size="small" value={testBook} onChange={(e) => setTestBook(e.target.value)} sx={{ flex: 1 }} label="Book">
              {ready.map((b) => <MenuItem key={b.id} value={b.id}>{b.title}</MenuItem>)}
            </TextField>
            <Button variant="outlined" disabled={!testBook} onClick={() => void runTest()}>Run</Button>
          </Stack>
          {test && <Alert severity="info">{test}</Alert>}
        </Stack>
      )}
    </Box>
  );
}

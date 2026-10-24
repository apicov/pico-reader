import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CardContent, CircularProgress, MenuItem, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { api } from '@/services/api';
import { READING_FONT } from '@/theme/readingThemes';

interface Passage {
  book_id: string;
  title: string;
  heading: string;
  format: string;
  location: string;
  progress: number;
  text: string;
}

type Mode = 'ask' | 'search';

/** "[2][3]" in an answer → links to those sources */
function withCitations(answer: string, onCite: (n: number) => void): ReactNode[] {
  return answer.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    return m ? (
      <Box key={i} component="button" onClick={() => onCite(Number(m[1]))}
        sx={{ border: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', p: 0, fontSize: '0.75em',
          verticalAlign: 'super', fontWeight: 600 }}>{m[1]}</Box>
    ) : <span key={i}>{part}</span>;
  });
}

/** Ask the library a question (an answer citing passages) or just find passages. */
export default function AskPage() {
  const { library } = useLibrary();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('ask');
  const [scope, setScope] = useState('all');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const indexed = (library?.books ?? []).filter((b) => b.index);

  const open = (p: Passage) => navigate(`/read/${encodeURIComponent(p.book_id)}?${new URLSearchParams({
    format: p.format, location: p.location, progress: String(p.progress) })}`);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError('');
    setAnswer(null);
    setPassages([]);
    const books = scope === 'all' ? undefined : [scope];
    try {
      if (mode === 'ask') {
        const res = await api<{ answer: string; sources: Passage[] }>('/api/ask', {
          method: 'POST', body: { question: question.trim(), book_ids: books } });
        setAnswer(res.answer || 'Nothing in your books seems to answer that.');
        setPassages(res.sources);
      } else {
        const q = new URLSearchParams({ q: question.trim(), limit: '15' });
        books?.forEach((b) => q.append('book_id', b));
        setPassages(await api<Passage[]>(`/api/search?${q}`));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Ask your library</Typography>
      {!online && <Alert severity="info" sx={{ mb: 2 }}>Searching needs a connection.</Alert>}
      {library && indexed.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>No book is indexed yet: run <code>reader index --all</code> on your computer.</Alert>
      )}
      <form onSubmit={run}>
        <Stack spacing={1.5}>
          <TextField fullWidth multiline maxRows={4} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder={mode === 'ask' ? 'Ask a question, in any language' : 'Words or a description of what you look for'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(e); } }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v: Mode | null) => v && setMode(v)}>
              <ToggleButton value="ask">Answer</ToggleButton>
              <ToggleButton value="search">Passages</ToggleButton>
            </ToggleButtonGroup>
            <Select size="small" value={scope} onChange={(e) => setScope(e.target.value)} sx={{ minWidth: 160, flex: 1 }}>
              <MenuItem value="all">All books</MenuItem>
              {indexed.map((b) => <MenuItem key={b.id} value={b.id}>{b.title}</MenuItem>)}
            </Select>
            <Button type="submit" variant="contained" disableElevation disabled={busy || !online || !question.trim()}>
              {busy ? <CircularProgress size={18} /> : mode === 'ask' ? 'Ask' : 'Search'}
            </Button>
          </Stack>
        </Stack>
      </form>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {answer && (
        <Typography sx={{ fontFamily: READING_FONT, fontSize: 17, lineHeight: 1.6, mt: 3 }}>
          {withCitations(answer, (n) => passages[n - 1] && open(passages[n - 1]))}
        </Typography>
      )}
      {passages.length > 0 && (
        <Stack spacing={1.5} sx={{ mt: 3 }}>
          {answer && <Typography variant="overline" color="text.secondary">Sources</Typography>}
          {passages.map((p, i) => (
            <Card key={`${p.book_id}-${p.location}-${i}`}>
              <CardActionArea onClick={() => open(p)}>
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Typography variant="caption" color="text.secondary">
                    {answer ? `[${i + 1}] ` : ''}{p.title}{p.heading ? ` · ${p.heading}` : ''}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: READING_FONT, mt: 0.5 }}>
                    {p.text.length > 320 ? `${p.text.slice(0, 320)}…` : p.text}
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

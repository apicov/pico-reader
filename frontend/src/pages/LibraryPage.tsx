import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, Chip, IconButton, InputAdornment, LinearProgress, Menu, MenuItem, Stack, Tab, Tabs,
  TextField, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { cachedShelf, loadShelf, setShelfStatus, subscribeShelf, type ShelfEntry, type ShelfStatus } from '@/services/shelf';
import { getPref, setPref } from '@/services/prefs';
import { Link as RouterLink } from 'react-router-dom';
import { localPosition } from '@/reader/position';
import { cachedStats, formatMinutes, getReadingGoal, getStats, type ReadingGoal } from '@/services/stats';
import SearchIcon from '@mui/icons-material/Search';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import DownloadDoneIcon from '@mui/icons-material/DownloadDone';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '@/components/BookCover';
import { useBookCache } from '@/hooks/useBookCache';
import { useCoverUrl } from '@/hooks/useCoverUrl';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { CachedFile } from '@/services/bookCache';
import { languageName } from '@/services/languages';
import type { Book } from '@/services/types';

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', epub: 'EPUB', reflow: 'Text' };

function BookCard({ book, files, online, shelf }: {
  book: Book; files: Record<string, CachedFile>; online: boolean; shelf?: ShelfEntry;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const choose = (status: ShelfStatus) => { setMenu(null); void setShelfStatus(book.id, status); };
  const navigate = useNavigate();
  const cover = useCoverUrl(book, files[`${book.id}/cover`], online);
  const [progress, setProgress] = useState(0);
  useEffect(() => { void localPosition(book.id).then((p) => setProgress(p?.progress ?? 0)); }, [book.id]);
  const downloaded = Object.keys(book.formats).some((k) => files[`${book.id}/${k}`]);
  // Offline, only downloaded books open
  const available = online || downloaded;
  return (
    <Card sx={{ border: 0, bgcolor: 'transparent', opacity: available ? 1 : 0.45, position: 'relative', overflow: 'visible' }}>
      <CardActionArea disabled={!available} onClick={() => navigate(`/read/${book.id}`)} sx={{ p: 0.5, borderRadius: 1 }}>
        <Box sx={{ position: 'relative' }}>
          <BookCover book={book} src={cover} />
          {progress > 0 && (
            <Box sx={{ position: 'absolute', left: 4, right: 4, bottom: 2, height: 3, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 2, bgcolor: 'primary.main' }} />
            </Box>
          )}
          {(downloaded || !available) && (
            <Box sx={{ position: 'absolute', right: 6, bottom: 6, bgcolor: 'background.paper', borderRadius: '50%',
              width: 26, height: 26, display: 'grid', placeItems: 'center', border: 1, borderColor: 'divider' }}
              title={downloaded ? 'On this device' : 'Not downloaded'}>
              {downloaded ? <DownloadDoneIcon sx={{ fontSize: 16 }} /> : <CloudOffOutlinedIcon sx={{ fontSize: 16 }} />}
            </Box>
          )}
        </Box>
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 500, lineHeight: 1.3 }} noWrap title={book.title}>{book.title}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">{book.author || '\u00a0'}</Typography>
        {shelf?.status === 'reading' && progress > 0 && (
          <Typography variant="caption" color="text.secondary" component="div">{Math.max(1, Math.round(progress * 100))}% read</Typography>
        )}
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={languageName(book.language)} />
          {Object.keys(book.formats).map((f) => <Chip key={f} size="small" variant="outlined" label={FORMAT_LABEL[f] ?? f} />)}
        </Stack>
      </CardActionArea>
      <IconButton size="small" aria-label={`${book.title}: shelf`} onClick={(e) => setMenu(e.currentTarget)}
        sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
          '&:hover': { bgcolor: 'background.paper' } }}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        {shelf?.status !== 'reading' && <MenuItem onClick={() => choose('reading')}>{shelf?.status === 'finished' ? 'Read again' : 'Add to Currently reading'}</MenuItem>}
        {shelf?.status !== 'finished' && <MenuItem onClick={() => choose('finished')}>Mark as finished</MenuItem>}
        {shelf && shelf.status !== 'removed' && <MenuItem onClick={() => choose('removed')}>Remove from my lists</MenuItem>}
      </Menu>
    </Card>
  );
}

/** Today's reading against the goal, when the goal is on */
function GoalBar() {
  const online = useOnlineStatus();
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [today, setToday] = useState(0);
  useEffect(() => {
    void getReadingGoal().then(setGoal);
    void cachedStats('week').then((s) => s && setToday(s.today_seconds));
    if (online) void getStats('week').then((s) => setToday(s.today_seconds)).catch(() => undefined);
  }, [online]);
  if (!goal?.enabled) return null;
  const done = today >= goal.minutes * 60;
  return (
    <Box component={RouterLink} to="/stats" sx={{ display: 'block', mb: 2, color: 'inherit', textDecoration: 'none' }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">Today {formatMinutes(today)} of {goal.minutes} min{done ? ' ✓' : ''}</Typography>
        <Typography variant="body2" color="primary">Statistics</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(100, (today / (goal.minutes * 60)) * 100)} sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
    </Box>
  );
}

function matches(book: Book, q: string): boolean {
  const hay = `${book.title} ${book.author}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return hay.includes(q);
}

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const files = useBookCache();
  const online = useOnlineStatus();

  // The reader's shelf: "Currently reading" first when there's anything on it
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [tab, setTab] = useState<'reading' | 'all' | 'finished' | null>(null);
  useEffect(() => {
    const load = () => void cachedShelf().then(setShelf);
    load();
    void loadShelf().then(setShelf);
    return subscribeShelf(load);
  }, [online]);
  useEffect(() => {
    void getPref<'reading' | 'all' | 'finished'>('library_tab').then((saved) => setTab((t) => t ?? saved ?? null));
  }, []);
  const byId = useMemo(() => new Map(shelf.map((e) => [e.book_id, e])), [shelf]);
  const reading = shelf.filter((e) => e.status === 'reading');
  const finished = shelf.filter((e) => e.status === 'finished');
  const current = tab ?? (reading.length ? 'reading' : 'all');
  const pickTab = (t: 'reading' | 'all' | 'finished') => { setTab(t); void setPref('library_tab', t); };

  const books = useMemo(() => {
    const q = query.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const all = (library?.books ?? []).filter((b) => !q || matches(b, q));
    if (current === 'all') return all;
    const order = new Map(shelf.filter((e) => e.status === current).map((e, i) => [e.book_id, i]));
    return all.filter((b) => order.has(b.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }, [library, query, shelf, current]);

  return (
    <>
      {loading && <LinearProgress sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000 }} />}
      <GoalBar />
      <Tabs value={current} onChange={(_, v) => pickTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="reading" label={`Reading${reading.length ? ` (${reading.length})` : ''}`} />
        <Tab value="all" label="All books" />
        <Tab value="finished" label={`Finished${finished.length ? ` (${finished.length})` : ''}`} />
      </Tabs>
      <TextField fullWidth size="small" placeholder="Search title or author" value={query}
        onChange={(e) => setQuery(e.target.value)} sx={{ mb: 3 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      {error && !library && (
        <Alert severity="warning" action={<Button onClick={() => void refresh()}>Retry</Button>}>{error}</Alert>
      )}
      {library && books.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 6 }}>
          {library.books.length === 0 ? 'No books yet. Add some with the desktop tool.'
            : query ? 'No book matches.'
            : current === 'reading' ? 'Nothing here yet: books you open appear here.'
            : current === 'finished' ? 'No finished books yet.' : 'No book matches.'}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {books.map((book) => <BookCard key={book.id} book={book} files={files} online={online} shelf={byId.get(book.id)} />)}
      </Box>
    </>
  );
}

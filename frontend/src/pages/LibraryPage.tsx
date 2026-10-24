import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, Chip, InputAdornment, LinearProgress, Stack, TextField, Typography } from '@mui/material';
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

function BookCard({ book, files, online }: { book: Book; files: Record<string, CachedFile>; online: boolean }) {
  const navigate = useNavigate();
  const cover = useCoverUrl(book, files[`${book.id}/cover`], online);
  const downloaded = Object.keys(book.formats).some((k) => files[`${book.id}/${k}`]);
  // Offline, only downloaded books open
  const available = online || downloaded;
  return (
    <Card sx={{ border: 0, bgcolor: 'transparent', opacity: available ? 1 : 0.45 }}>
      <CardActionArea disabled={!available} onClick={() => navigate(`/read/${book.id}`)} sx={{ p: 0.5, borderRadius: 1 }}>
        <Box sx={{ position: 'relative' }}>
          <BookCover book={book} src={cover} />
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
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={languageName(book.language)} />
          {Object.keys(book.formats).map((f) => <Chip key={f} size="small" variant="outlined" label={FORMAT_LABEL[f] ?? f} />)}
        </Stack>
      </CardActionArea>
    </Card>
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

  const books = useMemo(() => {
    const q = query.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return (library?.books ?? []).filter((b) => !q || matches(b, q));
  }, [library, query]);

  return (
    <>
      {loading && <LinearProgress sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000 }} />}
      <TextField fullWidth size="small" placeholder="Search title or author" value={query}
        onChange={(e) => setQuery(e.target.value)} sx={{ mb: 3 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      {error && !library && (
        <Alert severity="warning" action={<Button onClick={() => void refresh()}>Retry</Button>}>{error}</Alert>
      )}
      {library && books.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 6 }}>
          {library.books.length === 0 ? 'No books yet. Add some with the desktop tool.' : 'No book matches.'}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {books.map((book) => <BookCard key={book.id} book={book} files={files} online={online} />)}
      </Box>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, Chip, InputAdornment, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '@/components/BookCover';
import { useLibrary } from '@/hooks/useLibrary';
import { languageName } from '@/services/languages';
import type { Book } from '@/services/types';

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', epub: 'EPUB', mdbook: 'Text' };

function matches(book: Book, q: string): boolean {
  const hay = `${book.title} ${book.author}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return hay.includes(q);
}

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

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
        {books.map((book) => (
          <Card key={book.id} sx={{ border: 0, bgcolor: 'transparent' }}>
            <CardActionArea onClick={() => navigate(`/read/${book.id}`)} sx={{ p: 0.5, borderRadius: 1 }}>
              <BookCover book={book} src={book.cover?.url} />
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 500, lineHeight: 1.3 }} noWrap title={book.title}>{book.title}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">{book.author || ' '}</Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" label={languageName(book.language)} />
                {Object.keys(book.formats).map((f) => <Chip key={f} size="small" variant="outlined" label={FORMAT_LABEL[f] ?? f} />)}
              </Stack>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </>
  );
}

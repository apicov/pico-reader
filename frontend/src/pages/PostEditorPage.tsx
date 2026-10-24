import { useEffect, useState } from 'react';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookPicker } from '@/components/community/BookPicker';
import { Loading, MarkdownEditor, NeedsConnection, QuoteCard } from '@/components/community/parts';
import { useLibrary } from '@/hooks/useLibrary';
import { createPost, editPost, getPost, type QuoteDraft } from '@/services/community';

/** Router state from the reader ("Share to a post") or a book page ("New post about this book"). */
interface StartWith { quote?: QuoteDraft; bookIds?: string[] }

function Editor({ postId }: { postId?: string }) {
  const navigate = useNavigate();
  const start = (useLocation().state ?? {}) as StartWith;
  const { library } = useLibrary();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bookIds, setBookIds] = useState<string[]>(start.bookIds ?? (start.quote ? [start.quote.book_id] : []));
  const [quotes, setQuotes] = useState<QuoteDraft[]>(start.quote ? [start.quote] : []);
  const [loaded, setLoaded] = useState(!postId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!postId) return;
    getPost(postId).then((p) => {
      setTitle(p.title);
      setBody(p.body);
      setBookIds(p.books.filter((b) => b.available).map((b) => b.id));
      setQuotes(p.quotes.filter((q) => q.book.available).map((q) => ({ book_id: q.book.id, text: q.text, format: q.format,
        location: q.location, progress: q.progress })));
      setLoaded(true);
    }, (e: Error) => setError(e.message));
  }, [postId]);

  const bookOf = (id: string) => {
    const b = library?.books.find((x) => x.id === id);
    return { id, title: b?.title ?? '', author: b?.author ?? '', available: true };
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const draft = { title: title.trim(), body, book_ids: bookIds, quotes };
      const saved = postId ? await editPost(postId, draft) : await createPost(draft);
      navigate(`/community/post/${saved.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!loaded) return <Loading error={error} />;
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>{postId ? 'Edit post' : 'New post'}</Typography>
        <Button variant="contained" disabled={busy || !title.trim()} onClick={() => void save()}>{postId ? 'Save' : 'Post'}</Button>
      </Stack>
      <Stack spacing={2}>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 200 }}
          autoFocus fullWidth />
        <BookPicker value={bookIds} onChange={setBookIds} label="About these books (optional)" />
        {quotes.map((q, i) => (
          <QuoteCard key={i} quote={{ ...q, book: bookOf(q.book_id) }} onRemove={() => setQuotes(quotes.filter((_, j) => j !== i))} />
        ))}
        {!postId && quotes.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            To quote a book, select text in the reader and tap the speech bubble, or share a highlight from its Notes.
          </Typography>
        )}
        <MarkdownEditor label="What do you think?" value={body} onChange={setBody} minRows={6} />
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  );
}

export default function PostEditorPage() {
  const { postId } = useParams();
  return <NeedsConnection><Editor postId={postId} /></NeedsConnection>;
}

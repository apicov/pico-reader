import { useEffect, useState } from 'react';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate, useParams } from 'react-router-dom';
import { BookPicker } from '@/components/community/BookPicker';
import { AuthorLine, BookLink, Loading, NeedsConnection } from '@/components/community/parts';
import { useAuth } from '@/contexts/AuthContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useLoad } from '@/hooks/useLoad';
import { createList, deleteList, editList, getList, setHidden } from '@/services/community';

function ListView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { reader } = useAuth();
  const { data: list, error, reload } = useLoad(() => getList(id), [id]);
  if (!list) return <Loading error={error} retry={() => void reload()} />;
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }} />
        {list.mine && <Button size="small" onClick={() => navigate(`/lists/${id}/edit`)}>Edit</Button>}
        {reader?.is_admin && !list.mine && (
          <Button size="small" color="inherit" onClick={() => void setHidden('list', id, !list.hidden).then(reload)}>
            {list.hidden ? 'Show again' : 'Hide'}
          </Button>
        )}
      </Stack>
      <Typography variant="h5">{list.title}</Typography>
      <Box sx={{ my: 1 }}><AuthorLine author={list.author} when={list.updated_at} /></Box>
      {list.description && <Typography sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>{list.description}</Typography>}
      <Stack component="ol" spacing={1.5} sx={{ pl: 3, m: 0 }}>
        {list.items.map((item) => (
          <Box component="li" key={item.book.id} sx={{ '&::marker': { fontWeight: 700 } }}>
            <BookLink book={item.book} />
            {item.book.author && <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{item.book.author}</Typography>}
            {item.note && <Typography variant="body2" sx={{ mt: 0.5 }}>{item.note}</Typography>}
          </Box>
        ))}
      </Stack>
      {list.items.length === 0 && <Typography color="text.secondary">This list is empty.</Typography>}
    </Box>
  );
}

function ListEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const { library } = useLibrary();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<{ book_id: string; note: string }[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    getList(id).then((l) => {
      setTitle(l.title);
      setDescription(l.description);
      setItems(l.items.filter((i) => i.book.available).map((i) => ({ book_id: i.book.id, note: i.note })));
      setLoaded(true);
    }, (e: Error) => setError(e.message));
  }, [id]);
  const titleOf = (bookId: string) => library?.books.find((b) => b.id === bookId)?.title ?? bookId;
  const move = (i: number, by: number) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setItems(next);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const save = () => run(async () => {
    const draft = { title: title.trim(), description, items };
    const saved = id ? await editList(id, draft) : await createList(draft);
    navigate(`/lists/${saved.id}`, { replace: true });
  });

  if (!loaded) return <Loading error={error} />;
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>{id ? 'Edit list' : 'New list'}</Typography>
        <Button variant="contained" disabled={busy || !title.trim()} onClick={() => void save()}>Save</Button>
      </Stack>
      <Stack spacing={2}>
        <TextField label="Title" placeholder="My top 10" value={title} onChange={(e) => setTitle(e.target.value)}
          inputProps={{ maxLength: 200 }} autoFocus={!id} />
        <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)}
          multiline minRows={2} inputProps={{ maxLength: 5000 }} />
        <BookPicker label="Add books" value={[]} onChange={(ids) => {
          const add = ids.filter((b) => !items.some((i) => i.book_id === b));
          setItems([...items, ...add.map((book_id) => ({ book_id, note: '' }))]);
        }} />
        {items.map((item, i) => (
          <Stack key={item.book_id} direction="row" spacing={1} alignItems="flex-start">
            <Typography sx={{ fontWeight: 700, minWidth: 24, pt: 1 }}>{i + 1}.</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 500 }} noWrap>{titleOf(item.book_id)}</Typography>
              <TextField size="small" placeholder="Why it's here (optional)" value={item.note} fullWidth
                inputProps={{ maxLength: 1000 }}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
            </Box>
            <Stack>
              <IconButton size="small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
            </Stack>
            <IconButton size="small" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}><CloseIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
        {error && <Alert severity="error">{error}</Alert>}
        {id && (
          <Box>
            <Button color="error" disabled={busy} onClick={() => {
              if (window.confirm('Delete this list?')) void run(async () => { await deleteList(id); navigate('/community', { replace: true }); });
            }}>Delete list</Button>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

export function ListPage() {
  const { listId } = useParams();
  return <NeedsConnection>{listId && <ListView id={listId} />}</NeedsConnection>;
}

export function ListEditorPage() {
  const { listId } = useParams();
  return <NeedsConnection><ListEditor id={listId} /></NeedsConnection>;
}

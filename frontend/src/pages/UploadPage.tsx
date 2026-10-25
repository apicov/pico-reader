import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Checkbox, Collapse, IconButton, LinearProgress, List, ListItem, ListItemText,
  MenuItem, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { api } from '@/services/api';
import { LANGUAGES } from '@/services/languages';
import { loadCategories, type Category } from '@/services/categories';
import { CategoryPicker } from '@/components/categories';
import { droppedFiles, groupBooks, guessLanguage, markerCover, nameToMeta, pickedFiles, type BookSource,
  type Picked } from '@/upload/books';
import { buildReflowBundle } from '@/upload/markdown';
import { epubMeta, pdfMeta } from '@/upload/metadata';
import { uploadBook, type Kind } from '@/upload/upload';

interface Item {
  source: BookSource;
  title: string;
  author: string;
  language: string;
  categoryId: number | null;
  target: string; // 'new', or the id of a book this is another format of
  cover: Blob | null;
  selected: boolean;
  status: 'reading' | 'ready' | 'uploading' | 'done' | 'failed';
  note: string;
  error: string;
  progress: number;
  bookId?: string;
  duplicate: boolean;
}

interface HistoryEvent { id: number; book_id: string; title: string; action: string; actor: string; created_at: string }

const ACTIONS: Record<string, string> = {
  uploaded: 'added', files_changed: 'changed files of', deleted: 'deleted', reindexed: 'asked to index again',
  indexed: 'indexed', index_failed: 'failed to index',
};

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** What a book's file says about it (title, author, language, cover), read before uploading. */
async function readMeta(source: BookSource): Promise<Pick<Item, 'title' | 'author' | 'language' | 'cover' | 'note'>> {
  const fromName = nameToMeta(source.file.name);
  if (source.kind === 'markdown') {
    const text = await source.file.text();
    const images = new Set(source.images.values()).size;
    return { ...fromName, title: fromName.title || /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || 'Untitled',
             language: guessLanguage(text), cover: markerCover(source.images),
             note: `Markdown · ${(source.file.size / 1e6).toFixed(1)} MB · ${images} image${images === 1 ? '' : 's'}` };
  }
  const m = source.kind === 'epub' ? await epubMeta(source.file) : await pdfMeta(source.file);
  return { title: m.title || fromName.title, author: m.author || fromName.author,
           language: m.language in LANGUAGES ? m.language : '', cover: m.cover,
           note: `${source.kind.toUpperCase()} · ${(source.file.size / 1e6).toFixed(1)} MB` };
}

/** The files to send: a Markdown book becomes a reflow bundle here, with the title and language as edited. */
async function filesOf(item: Item): Promise<{ files: Partial<Record<Kind, { blob: Blob; type: string }>>; note: string }> {
  const files: Partial<Record<Kind, { blob: Blob; type: string }>> = {};
  let note = item.note;
  if (item.source.kind === 'markdown') {
    const bundle = await buildReflowBundle(await item.source.file.text(), item.source.images,
      { title: item.title.trim(), author: item.author.trim(), language: item.language });
    files.reflow = { blob: bundle.zip, type: 'application/zip' };
    note = `${bundle.chapters} chapters, ${bundle.images} images${bundle.missing.length ? ` — missing: ${bundle.missing.slice(0, 5).join(', ')}` : ''}`;
  } else {
    files[item.source.kind] = { blob: item.source.file, type: item.source.kind === 'epub' ? 'application/epub+zip' : 'application/pdf' };
  }
  if (item.cover) files.cover = { blob: item.cover, type: item.cover.type || 'image/jpeg' };
  return { files, note };
}

/** Add books (PDF, EPUB, or Markdown with its images, e.g. marker's folders) to the shared library, several at once;
 *  the server indexes them for search. */
export default function UploadPage() {
  const { reader } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const { library, refresh } = useLibrary();
  const [items, setItems] = useState<Item[]>([]);
  const [tree, setTree] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => { void loadCategories().then(setTree); }, []);

  const mine = (library?.books ?? []).filter((b) => b.can_change);
  const doneCount = items.filter((i) => i.status === 'done').length;

  useEffect(() => {
    if (online) void api<HistoryEvent[]>('/api/books/history?days=90').then(setHistory).catch(() => undefined);
  }, [online, doneCount]);

  const change = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.source.key === key ? { ...i, ...patch } : i)));

  const add = async (picked: Picked[]) => {
    setError('');
    const known = new Set(itemsRef.current.map((i) => i.source.key));
    const found = groupBooks(picked);
    const sources = found.filter((s) => !known.has(s.key));
    if (!sources.length) {
      setError(found.length ? 'Those books are in the list already.' : 'No PDF, EPUB or Markdown file there.');
      return;
    }
    setItems((list) => [...list, ...sources.map((source): Item => ({
      source, ...nameToMeta(source.file.name), language: '', categoryId: null, target: 'new', cover: null, selected: true,
      status: 'reading', note: '', error: '', progress: 0, duplicate: false }))]);
    const titles = new Set([...(library?.books ?? []).map((b) => plain(b.title)),
                            ...itemsRef.current.map((i) => plain(i.title))]);
    for (const source of sources) { // one at a time: a PDF's cover is drawn, a Markdown file read whole
      try {
        const meta = await readMeta(source);
        const duplicate = titles.has(plain(meta.title));
        titles.add(plain(meta.title));
        change(source.key, { ...meta, status: 'ready', duplicate, selected: !duplicate });
      } catch (e) {
        change(source.key, { status: 'failed', selected: false, error: `Couldn't read it: ${(e as Error).message}` });
      }
    }
  };

  const ready = (i: Item) => i.selected && (i.status === 'ready' || i.status === 'failed') && !!i.title.trim() && !!i.language;
  const toSend = items.filter(ready);
  const needLanguage = items.filter((i) => i.selected && i.status === 'ready' && !i.language).length;

  const sendAll = async () => {
    setSending(true);
    for (const key of toSend.map((i) => i.source.key)) {
      const item = itemsRef.current.find((i) => i.source.key === key);
      if (!item || !ready(item)) continue; // removed or changed meanwhile
      change(key, { status: 'uploading', progress: 0, error: '' });
      try {
        const { files, note } = await filesOf(item);
        change(key, { note });
        const id = await uploadBook({ id: item.target === 'new' ? undefined : item.target, title: item.title.trim(),
          author: item.author.trim(), language: item.language,
          ...(item.target === 'new' && item.categoryId !== null ? { category_id: item.categoryId } : {}) },
        files, (progress) => change(key, { progress }));
        change(key, { status: 'done', bookId: id, selected: false });
      } catch (e) {
        change(key, { status: 'failed', error: (e as Error).message });
      }
    }
    setSending(false);
    void refresh();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (online && !sending) await add(await droppedFiles(e.dataTransfer.items));
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h5">Add books</Typography>
      <Typography variant="body2" color="text.secondary">
        PDF, EPUB, or Markdown with its images. For marker's output choose a book's folder, or the folder that holds
        several of them: every folder with a .md file named like it is one book. They go into the shared library; the
        server then makes them searchable.
      </Typography>
      {!online && <Alert severity="info">Adding books needs a connection.</Alert>}
      <Box onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
        sx={{ border: 2, borderStyle: 'dashed', borderColor: dragging ? 'primary.main' : 'divider', borderRadius: 2, p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Button variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={!online || sending}>
            Choose files
            <input hidden type="file" multiple accept=".pdf,.epub,.md,.markdown,image/*"
              onChange={(e) => { if (e.target.files) void add(pickedFiles(e.target.files)); e.target.value = ''; }} />
          </Button>
          <Button variant="outlined" component="label" startIcon={<FolderOpenIcon />} disabled={!online || sending}>
            Choose a folder
            <input hidden type="file" {...{ webkitdirectory: '' }}
              onChange={(e) => { if (e.target.files) void add(pickedFiles(e.target.files)); e.target.value = ''; }} />
          </Button>
          <Typography variant="body2" color="text.secondary">or drop files and folders here (several at once)</Typography>
        </Stack>
      </Box>
      {error && <Alert severity="warning" onClose={() => setError('')}>{error}</Alert>}

      {items.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Button variant="contained" disableElevation disabled={!online || sending || !toSend.length} onClick={() => void sendAll()}>
            {sending ? 'Uploading…' : `Upload ${toSend.length} book${toSend.length === 1 ? '' : 's'}`}
          </Button>
          <Button disabled={sending} onClick={() => setItems((l) => l.filter((i) => i.status !== 'done'))}>Clear finished</Button>
          <Button disabled={sending} onClick={() => setItems([])}>Clear all</Button>
          <Typography variant="body2" color="text.secondary">
            {items.length} in the list{doneCount ? ` · ${doneCount} added` : ''}{needLanguage ? ` · ${needLanguage} need a language` : ''}
          </Typography>
        </Stack>
      )}
      {items.map((item) => (
        <BookCard key={item.source.key} item={item} tree={tree} mine={mine} locked={sending}
          onChange={(patch) => change(item.source.key, patch)}
          onRemove={() => setItems((l) => l.filter((i) => i.source.key !== item.source.key))}
          onOpen={() => item.bookId && navigate(`/read/${encodeURIComponent(item.bookId)}`)} />
      ))}

      {history.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mt: 2 }}>History</Typography>
          <List dense>
            {history.map((e) => (
              <ListItem key={e.id} disableGutters>
                <ListItemText primary={`${e.actor === reader?.email ? 'You' : e.actor} ${ACTIONS[e.action] ?? e.action} “${e.title}”`}
                  secondary={new Date(e.created_at).toLocaleString()} />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Stack>
  );
}

function BookCard({ item, tree, mine, locked, onChange, onRemove, onOpen }: {
  item: Item; tree: Category[]; mine: { id: string; title: string }[]; locked: boolean;
  onChange: (patch: Partial<Item>) => void; onRemove: () => void; onOpen: () => void;
}) {
  const [more, setMore] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string>();
  useEffect(() => {
    if (!item.cover) { setCoverUrl(undefined); return; }
    const url = URL.createObjectURL(item.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.cover]);
  const editable = !locked && (item.status === 'ready' || item.status === 'failed');
  return (
    <Card variant="outlined" sx={{ opacity: item.selected || item.status !== 'ready' ? 1 : 0.6 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1.5}>
          <Stack sx={{ alignItems: 'center' }}>
            <Checkbox checked={item.selected} disabled={!editable} onChange={(e) => onChange({ selected: e.target.checked })}
              slotProps={{ input: { 'aria-label': `Upload ${item.title}` } }} sx={{ p: 0.5 }} />
            {coverUrl && <Box component="img" src={coverUrl} alt="" sx={{ width: 56, mt: 1, borderRadius: 0.5 }} />}
          </Stack>
          <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
                {item.source.key}{item.note ? ` · ${item.note}` : ''}
              </Typography>
              <IconButton size="small" aria-label={`Remove ${item.title} from the list`} disabled={locked && item.status === 'uploading'}
                onClick={onRemove}><CloseIcon fontSize="small" /></IconButton>
            </Stack>
            {item.status === 'reading' && <LinearProgress />}
            {item.duplicate && item.status === 'ready' && (
              <Alert severity="info" sx={{ py: 0 }}>A book with this title is in the library or the list already: not selected.</Alert>
            )}
            <TextField size="small" label="Title" value={item.title} disabled={!editable} required
              onChange={(e) => onChange({ title: e.target.value })} />
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Author" value={item.author} disabled={!editable} sx={{ flex: 2 }}
                onChange={(e) => onChange({ author: e.target.value })} />
              <TextField size="small" select label="Language" value={item.language} disabled={!editable} required sx={{ flex: 1 }}
                error={item.selected && item.status === 'ready' && !item.language}
                onChange={(e) => onChange({ language: e.target.value })}>
                {Object.entries(LANGUAGES).map(([code, name]) => <MenuItem key={code} value={code}>{name}</MenuItem>)}
              </TextField>
            </Stack>
            {editable && (
              <Box>
                <Button size="small" onClick={() => setMore(!more)}>{more ? 'Less' : 'Category, another format…'}</Button>
                <Collapse in={more} unmountOnExit>
                  <Stack spacing={1.25} sx={{ mt: 1 }}>
                    <TextField size="small" select label="Add as" value={item.target} onChange={(e) => onChange({ target: e.target.value })}>
                      <MenuItem value="new">A new book</MenuItem>
                      {mine.map((b) => <MenuItem key={b.id} value={b.id}>Another format of “{b.title}”</MenuItem>)}
                    </TextField>
                    {item.target === 'new' && (
                      <CategoryPicker tree={tree} value={item.categoryId} onChange={(categoryId) => onChange({ categoryId })}
                        label="Category (empty: the AI suggests one after indexing)" />
                    )}
                  </Stack>
                </Collapse>
              </Box>
            )}
            {item.status === 'uploading' && <LinearProgress variant="determinate" value={item.progress * 100} />}
            {item.status === 'done' && (
              <Alert severity="success" sx={{ py: 0 }} action={<Button size="small" onClick={onOpen}>Open</Button>}>
                Added. The server is making it searchable.
              </Alert>
            )}
            {item.error && <Alert severity="error" sx={{ py: 0 }}>{item.error}</Alert>}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

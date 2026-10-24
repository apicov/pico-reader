import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, LinearProgress, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { api } from '@/services/api';
import { LANGUAGES } from '@/services/languages';
import { loadCategories, type Category } from '@/services/categories';
import { CategoryPicker } from '@/components/categories';
import { buildReflowBundle } from '@/upload/markdown';
import { epubMeta, pdfMeta } from '@/upload/metadata';
import { uploadBook, type Kind } from '@/upload/upload';

interface Prepared {
  kind: Exclude<Kind, 'cover'>;
  blob: Blob;
  type: string;
  cover: Blob | null;
  note: string;
}

interface HistoryEvent { id: number; book_id: string; title: string; action: string; actor: string; created_at: string }

const ACTIONS: Record<string, string> = {
  uploaded: 'added', files_changed: 'changed files of', deleted: 'deleted', reindexed: 'asked to index again',
  indexed: 'indexed', index_failed: 'failed to index',
};

/** Add a book (PDF, EPUB, or Markdown with its images) to the shared library; the server indexes it for search. */
export default function UploadPage() {
  const { reader } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const { library, refresh } = useLibrary();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tree, setTree] = useState<Category[]>([]);
  useEffect(() => { void loadCategories().then(setTree); }, []);
  const [target, setTarget] = useState('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [coverUrl, setCoverUrl] = useState<string>();

  const mine = (library?.books ?? []).filter((b) => b.can_change);

  useEffect(() => {
    if (online) void api<HistoryEvent[]>('/api/books/history?days=90').then(setHistory).catch(() => undefined);
  }, [online, done]);
  useEffect(() => {
    if (!prepared?.cover) { setCoverUrl(undefined); return; }
    const url = URL.createObjectURL(prepared.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    setDone(null);
    setBusy('Reading the file…');
    try {
      const files = [...list];
      const book = files.find((f) => /\.(pdf|epub|md|markdown)$/i.test(f.name));
      if (!book) throw new Error('Choose a PDF, an EPUB, or a Markdown file (with its images)');
      const base = book.name.replace(/\.[^.]+$/, '');
      if (/\.epub$/i.test(book.name)) {
        const m = await epubMeta(book);
        setPrepared({ kind: 'epub', blob: book, type: 'application/epub+zip', cover: m.cover, note: '' });
        setTitle(m.title || base); setAuthor(m.author); setLanguage(m.language in LANGUAGES ? m.language : '');
      } else if (/\.pdf$/i.test(book.name)) {
        const m = await pdfMeta(book);
        setPrepared({ kind: 'pdf', blob: book, type: 'application/pdf', cover: m.cover, note: '' });
        setTitle(m.title || base); setAuthor(m.author); setLanguage(m.language in LANGUAGES ? m.language : '');
      } else {
        const md = await book.text();
        const firstHeading = /^#\s+(.+)$/m.exec(md)?.[1]?.trim();
        const images = new Map<string, Blob>();
        for (const f of files) {
          if (f === book) continue;
          const rel = (f.webkitRelativePath || f.name).split('/').slice(f.webkitRelativePath ? 1 : 0).join('/');
          images.set(rel, f);
          images.set(f.name, f);
        }
        const t = firstHeading || base;
        const bundle = await buildReflowBundle(md, images, { title: t, author: '', language: language || 'de' });
        setPrepared({ kind: 'reflow', blob: bundle.zip, type: 'application/zip', cover: null,
          note: `${bundle.chapters} chapters, ${bundle.images} images${bundle.missing.length ? ` — missing: ${bundle.missing.slice(0, 5).join(', ')}` : ''}` });
        setTitle(t); setAuthor('');
      }
    } catch (e) {
      setPrepared(null);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!prepared || !title.trim() || !language) return;
    setBusy('Uploading…');
    setProgress(0);
    setError('');
    try {
      let blob = prepared.blob;
      if (prepared.kind === 'reflow') {
        // the bundle carries title and language too: rebuild its book.json with the edited ones
        const { unzipSync, zipSync, strToU8 } = await import('fflate');
        const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
        const meta = JSON.parse(new TextDecoder().decode(files['book.json']));
        files['book.json'] = strToU8(JSON.stringify({ ...meta, title: title.trim(), author: author.trim(), language }, null, 1));
        blob = new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
      }
      const files: Partial<Record<Kind, { blob: Blob; type: string }>> = { [prepared.kind]: { blob, type: prepared.type } };
      if (prepared.cover) files.cover = { blob: prepared.cover, type: prepared.cover.type || 'image/jpeg' };
      const id = await uploadBook({ id: target === 'new' ? undefined : target, title: title.trim(), author: author.trim(), language,
                                    ...(target === 'new' && categoryId !== null ? { category_id: categoryId } : {}) },
        files, setProgress);
      setDone(id);
      setPrepared(null);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Typography variant="h5">Add a book</Typography>
      <Typography variant="body2" color="text.secondary">
        PDF, EPUB, or Markdown (choose the .md together with its images). It goes into the shared library; the server
        then makes it searchable.
      </Typography>
      {!online && <Alert severity="info">Adding books needs a connection.</Alert>}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={!online || !!busy}>
          Choose files
          <input hidden type="file" multiple accept=".pdf,.epub,.md,.markdown,image/*"
            onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
        </Button>
        <Button variant="text" component="label" disabled={!online || !!busy}>
          Choose a folder (Markdown + images)
          <input hidden type="file" {...{ webkitdirectory: '' }} onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
        </Button>
      </Stack>
      {busy && (
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>{busy}</Typography>
          <LinearProgress variant={busy.startsWith('Uploading') ? 'determinate' : 'indeterminate'} value={progress * 100} />
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {done && (
        <Alert severity="success" action={<Button onClick={() => navigate(`/read/${encodeURIComponent(done)}`)}>Open</Button>}>
          Added. The server is making it searchable (see the library).
        </Alert>
      )}
      {prepared && !busy && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2}>
              {coverUrl && <Box component="img" src={coverUrl} alt="" sx={{ width: 90, borderRadius: 1, alignSelf: 'flex-start' }} />}
              <Stack spacing={1.5} sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {prepared.kind.toUpperCase()} · {(prepared.blob.size / 1e6).toFixed(1)} MB{prepared.note ? ` · ${prepared.note}` : ''}
                </Typography>
                <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                <TextField size="small" label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
                <TextField size="small" select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} required>
                  {Object.entries(LANGUAGES).map(([code, name]) => <MenuItem key={code} value={code}>{name}</MenuItem>)}
                </TextField>
                <TextField size="small" select label="Add as" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <MenuItem value="new">A new book</MenuItem>
                  {mine.map((b) => <MenuItem key={b.id} value={b.id}>Another format of “{b.title}”</MenuItem>)}
                </TextField>
                {target === 'new' && (
                  <CategoryPicker tree={tree} value={categoryId} onChange={setCategoryId}
                    label="Category (empty: the AI suggests one after indexing)" />
                )}
                <Button variant="contained" disableElevation disabled={!title.trim() || !language || !online} onClick={() => void send()}>
                  Upload
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}
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

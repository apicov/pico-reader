import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CardContent, IconButton, Link, Menu, MenuItem, Snackbar, Stack, Tab,
  Tabs, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { Passage } from '@/services/chat';
import { exportText } from '@/services/download';
import { sendToComputer } from '@/services/computer';
import { cachedNotes, changeNote, deleteNote, getNote, loadNotes, subscribeNotes, type Note } from '@/services/notes';
import { READING_FONT } from '@/theme/readingThemes';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The first words of a note, without Markdown marks or diagrams */
function snippet(md: string): string {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*[-*+]\s+/gm, ' ').replace(/[#*_>`|]+/g, ' ')
    .replace(/\s?\[\d+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The reader's notes, or those about one book; read offline from the device's copy. */
function useNotes(bookId?: string): Note[] | null {
  const online = useOnlineStatus();
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    const load = () => void cachedNotes(bookId).then(setNotes);
    load();
    void loadNotes().then(load);
    return subscribeNotes(load);
  }, [bookId, online]);
  return notes;
}

function NoteCards({ notes, showBook }: { notes: Note[]; showBook: boolean }) {
  return (
    <Stack spacing={1.5}>
      {notes.map((n) => (
        <Card key={n.id}>
          <CardActionArea component={RouterLink} to={`/notes/${encodeURIComponent(n.id)}`}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography sx={{ fontFamily: READING_FONT, fontWeight: 600 }}>{n.title}</Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {showBook && n.book_title ? `${n.book_title} · ` : ''}{day(n.updated_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} noWrap>{snippet(n.markdown)}</Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

/** "My notes" on a book's page */
export function BookNotes({ bookId }: { bookId: string }) {
  const notes = useNotes(bookId);
  if (!notes?.length) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>My notes</Typography>
      <NoteCards notes={notes} showBook={false} />
    </Box>
  );
}

export default function NotesPage() {
  const notes = useNotes();
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontFamily: READING_FONT, mb: 0.5 }}>Notes</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Summaries, outlines and diagrams you keep. Ask for one in the <Link component={RouterLink} to="/ask">chat</Link>, e.g.
        “summarise chapter 3 of … as a note, with a map of the characters”.
      </Typography>
      {notes && notes.length === 0 && <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>No notes yet.</Typography>}
      {notes && <NoteCards notes={notes} showBook />}
    </Box>
  );
}

/** A note for the .md export: its citations become a list of the passages at the end */
function asMarkdown(note: Note): string {
  const sources = note.sources.map((p, i) => `[${i + 1}] ${p.title}${p.heading ? `, ${p.heading}` : ''}: “${p.text.slice(0, 300)}${p.text.length > 300 ? '…' : ''}”`);
  return `# ${note.title}\n\n${note.markdown.trim()}\n${sources.length ? `\n---\n\n${sources.join('\n\n')}\n` : ''}`;
}

export function NotePage() {
  const { noteId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<{ title: string; markdown: string } | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  useEffect(() => { void getNote(noteId).then((n) => setNote(n ?? null)); }, [noteId]);

  const openPassage = (p: Passage) => navigate(`/read/${encodeURIComponent(p.book_id)}?${new URLSearchParams({
    format: p.format, location: p.location, progress: String(p.progress) })}`);

  const save = async () => {
    if (!note || !draft) return;
    setError('');
    try {
      setNote(await changeNote(note.id, draft));
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (note === undefined) return null;
  if (note === null) return <Alert severity="info">This note isn't here (deleted, or not on this device yet).</Alert>;
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }} />
        {!draft && <IconButton aria-label="Note actions" onClick={(e) => setMenu(e.currentTarget)}><MoreVertIcon /></IconButton>}
      </Stack>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem disabled={!online} onClick={() => { setMenu(null); setTab('edit'); setDraft({ title: note.title, markdown: note.markdown }); }}>
          Edit
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); void exportText(asMarkdown(note), `${note.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'note'}.md`); }}>
          Export .md
        </MenuItem>
        <MenuItem onClick={() => {
          setMenu(null);
          void sendToComputer({ kind: 'note', title: note.title, body: asMarkdown(note),
            meta: { book_id: note.book_id ?? undefined, book_title: note.book_title ?? '' } })
            .then((r) => setSent(r === 'sent' ? 'Sent to your computer (inbox)' : 'Queued: it goes to your computer when online'));
        }}>Send to computer (copy)</MenuItem>
        <MenuItem disabled={!online} sx={{ color: 'error.main' }} onClick={() => {
          setMenu(null);
          if (window.confirm(`Delete the note “${note.title}”?`)) {
            void deleteNote(note.id).then(() => navigate('/notes', { replace: true })).catch((e) => setError((e as Error).message));
          }
        }}>Delete…</MenuItem>
      </Menu>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Snackbar open={!!sent} autoHideDuration={3_000} onClose={() => setSent('')} message={sent} />
      {draft ? (
        <Stack spacing={1.5}>
          <TextField label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="edit" label="Markdown" />
            <Tab value="preview" label="Preview" />
          </Tabs>
          {tab === 'edit'
            ? <TextField multiline minRows={14} value={draft.markdown} onChange={(e) => setDraft({ ...draft, markdown: e.target.value })}
                slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 14 } } }} />
            : <Markdown text={draft.markdown} onCite={(n) => note.sources[n - 1] && openPassage(note.sources[n - 1])}
                sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disableElevation disabled={!online || !draft.title.trim()} onClick={() => void save()}>Save</Button>
            <Button onClick={() => { setDraft(null); setError(''); }}>Cancel</Button>
          </Stack>
        </Stack>
      ) : (
        <>
          <Typography variant="h5" sx={{ fontFamily: READING_FONT, lineHeight: 1.25 }}>{note.title}</Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
            {note.book_id && note.book_title && <><Link component={RouterLink} to={`/book/${encodeURIComponent(note.book_id)}`}>{note.book_title}</Link> · </>}
            {day(note.updated_at)}
          </Typography>
          <Markdown text={note.markdown} onCite={(n) => note.sources[n - 1] && openPassage(note.sources[n - 1])}
            sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />
        </>
      )}
    </Box>
  );
}

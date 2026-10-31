import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogTitle, IconButton, Link, List, ListItemButton, ListItemText, Menu, MenuItem,
  Snackbar, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { useSendToComputer } from '@/components/SendToComputer';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readerPath } from '@/reader/jump';
import type { Passage } from '@/services/chat';
import { exportText } from '@/services/download';
import { changeNote, deleteNote, getNote, NoteConflict, type Note } from '@/services/notes';
import { READING_FONT } from '@/theme/readingThemes';
import { NoteEditor } from './NoteParts';
import { asMarkdown, noteDay, noteFileName } from './noteText';
import { useProjects } from './useNotes';

/** While a note is shown (not being edited), a change made elsewhere (its file on the computer) is looked for this often */
const LIVE_EVERY_MS = 4_000;

/** `/notes/:noteId`: a note, to read, edit, export, move to a project or send to the computer */
export default function NotePage() {
  const { noteId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<{ title: string; markdown: string } | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Note | null>(null);
  const [updated, setUpdated] = useState(false);
  const [moving, setMoving] = useState(false);
  const projects = useProjects();
  const { send, ui: sendUi } = useSendToComputer();
  useEffect(() => { void getNote(noteId).then((n) => setNote(n ?? null)); }, [noteId]);

  // Live: while it's shown (not being edited here), a change made elsewhere, e.g. in its file on the computer,
  // appears within seconds
  const shownVersion = note?.updated_at;
  useEffect(() => {
    if (!online || draft || !shownVersion) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void getNote(noteId).then((n) => {
        if (n && n.updated_at !== shownVersion) { setNote(n); setUpdated(true); }
      });
    }, LIVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [online, draft, noteId, shownVersion]);

  const openPassage = (p: Passage) => navigate(readerPath(p.book_id, p));

  const save = async (overwrite = false) => {
    if (!note || !draft) return;
    setError('');
    setConflict(null);
    try {
      setNote(await changeNote(note.id, draft, overwrite ? undefined : note.updated_at));
      setDraft(null);
    } catch (e) {
      if (e instanceof NoteConflict) setConflict(e.current);
      else setError((e as Error).message);
    }
  };

  const move = async (projectId: string | null) => {
    if (!note) return;
    setMoving(false);
    try {
      setNote(await changeNote(note.id, { project_id: projectId }));
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
        <MenuItem disabled={!online} onClick={() => { setMenu(null); setDraft({ title: note.title, markdown: note.markdown }); }}>
          Edit
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); void exportText(asMarkdown(note), noteFileName(note)); }}>
          Export .md
        </MenuItem>
        {projects.length > 0 && (
          <MenuItem disabled={!online} onClick={() => { setMenu(null); setMoving(true); }}>Project…</MenuItem>
        )}
        <MenuItem onClick={() => {
          setMenu(null);
          send({ kind: 'note', title: note.title, body: asMarkdown(note),
            meta: { book_id: note.book_id ?? undefined, book_title: note.book_title ?? '' } });
        }}>Send to computer (copy)</MenuItem>
        <MenuItem disabled={!online} sx={{ color: 'error.main' }} onClick={() => {
          setMenu(null);
          if (window.confirm(`Delete the note “${note.title}”?`)) {
            void deleteNote(note.id).then(() => navigate('/notes', { replace: true })).catch((e) => setError((e as Error).message));
          }
        }}>Delete…</MenuItem>
      </Menu>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {conflict && draft && (
        <Alert severity="warning" sx={{ mb: 2 }} action={
          <Stack direction="row">
            <Button color="inherit" size="small" onClick={() => { setNote(conflict); setDraft(null); setConflict(null); }}>Take theirs</Button>
            <Button color="inherit" size="small" onClick={() => void save(true)}>Save mine</Button>
          </Stack>
        }>
          This note changed meanwhile (on your computer?). Take that version, or save yours over it.
        </Alert>
      )}
      {sendUi}
      <Snackbar open={updated} autoHideDuration={3_000} onClose={() => setUpdated(false)} message="Updated just now" />
      <Dialog open={moving} onClose={() => setMoving(false)} fullWidth maxWidth="xs">
        <DialogTitle>Project</DialogTitle>
        <List sx={{ pt: 0 }}>
          {[{ id: null, name: 'No project', hint: '~/pico/notes' } as const,
            ...projects.map((p) => ({ id: p.id, name: p.name, hint: `${p.name}/notes` }))].map((p) => (
            <ListItemButton key={p.id ?? 'none'} selected={(note.project_id ?? null) === p.id} onClick={() => void move(p.id)}>
              <ListItemText primary={p.name} secondary={p.hint} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
      {draft ? (
        <NoteEditor draft={draft} onChange={setDraft} canSave={online} onSave={() => void save()}
          onCancel={() => { setDraft(null); setError(''); setConflict(null); }}
          onCite={(n) => note.sources[n - 1] && openPassage(note.sources[n - 1])} />
      ) : (
        <>
          <Typography variant="h5" sx={{ fontFamily: READING_FONT, lineHeight: 1.25 }}>{note.title}</Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
            {note.project && <>{note.project} · </>}
            {note.book_id && note.book_title && <><Link component={RouterLink} to={`/book/${encodeURIComponent(note.book_id)}`}>{note.book_title}</Link> · </>}
            {noteDay(note.updated_at)}
          </Typography>
          <Markdown text={note.markdown} onCite={(n) => note.sources[n - 1] && openPassage(note.sources[n - 1])}
            sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />
        </>
      )}
    </Box>
  );
}

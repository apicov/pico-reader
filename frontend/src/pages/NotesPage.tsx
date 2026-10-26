import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogTitle, IconButton, Link, List,
  ListItemButton, ListItemText, Menu, MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { Passage } from '@/services/chat';
import { exportText } from '@/services/download';
import { useSendToComputer } from '@/components/SendToComputer';
import { cachedNotes, changeNote, createNote, deleteNote, getNote, loadNotes, NoteConflict, subscribeNotes,
  type Note } from '@/services/notes';
import { getPref, setPref } from '@/services/prefs';
import { cachedProjects, loadProjects, type Project } from '@/services/projects';
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
                {showBook && n.project ? `${n.project} · ` : ''}{showBook && n.book_title ? `${n.book_title} · ` : ''}{day(n.updated_at)}
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

/** The projects on the study computer (kept on the device for offline use) */
function useProjects(): Project[] {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    void cachedProjects().then(setProjects);
    void loadProjects().then(setProjects);
  }, []);
  return projects;
}

export default function NotesPage() {
  const notes = useNotes();
  const online = useOnlineStatus();
  const projects = useProjects();
  const [project, setProject] = useState<string>('all'); // 'all', 'none' or a project's id
  useEffect(() => { void getPref<string>('notes_project').then((p) => p && setProject(p)); }, []);
  const pick = (p: string) => { setProject(p); void setPref('notes_project', p); };
  const shown = project === 'none' || projects.some((p) => p.id === project) ? project : 'all';
  const listed = notes?.filter((n) => shown === 'all' || (shown === 'none' ? !n.project_id : n.project_id === shown));
  const chip = (value: string, label: string) => (
    <Chip key={value} label={label} size="small" clickable color={shown === value ? 'primary' : 'default'}
      variant={shown === value ? 'filled' : 'outlined'} onClick={() => pick(value)} />
  );
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h5" sx={{ fontFamily: READING_FONT, flex: 1 }}>Notes</Typography>
        <Button variant="outlined" startIcon={<AddIcon />} component={RouterLink} disabled={!online}
          to="/notes/new" state={{ project: shown !== 'all' && shown !== 'none' ? shown : null }}>
          New note
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Summaries, outlines and diagrams you keep. Write one yourself (Markdown), or ask for one in
        the <Link component={RouterLink} to="/ask">chat</Link>, e.g. “summarise chapter 3 of … as a note, with a map of
        the characters”.
      </Typography>
      {projects.length > 0 && notes && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
          {chip('all', 'All')}
          {projects.map((p) => chip(p.id, `${p.name} (${notes.filter((n) => n.project_id === p.id).length})`))}
          {chip('none', `No project (${notes.filter((n) => !n.project_id).length})`)}
        </Stack>
      )}
      {listed && listed.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          {shown === 'all' ? 'No notes yet.' : 'No notes here yet: save a .md in the project\'s notes/ folder, or move a note here (⋮ → Project…).'}
        </Typography>
      )}
      {listed && <NoteCards notes={listed} showBook />}
    </Box>
  );
}

/** A note for the .md export: its citations become a list of the passages at the end */
function asMarkdown(note: Note): string {
  const sources = note.sources.map((p, i) => `[${i + 1}] ${p.title}${p.heading ? `, ${p.heading}` : ''}: “${p.text.slice(0, 300)}${p.text.length > 300 ? '…' : ''}”`);
  return `# ${note.title}\n\n${note.markdown.trim()}\n${sources.length ? `\n---\n\n${sources.join('\n\n')}\n` : ''}`;
}

/** Title and Markdown, with a preview: editing a note, or writing a new one */
function NoteEditor({ draft, onChange, canSave, onSave, onCancel, onCite, children }: {
  draft: { title: string; markdown: string }; onChange: (d: { title: string; markdown: string }) => void;
  canSave: boolean; onSave: () => void; onCancel: () => void; onCite?: (n: number) => void; children?: React.ReactNode;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  return (
    <Stack spacing={1.5}>
      <TextField label="Title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      {children}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="edit" label="Markdown" />
        <Tab value="preview" label="Preview" />
      </Tabs>
      {tab === 'edit'
        ? <TextField multiline minRows={14} value={draft.markdown} onChange={(e) => onChange({ ...draft, markdown: e.target.value })}
            slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 14 } }, htmlInput: { 'aria-label': 'Markdown' } }} />
        : <Markdown text={draft.markdown} onCite={onCite ?? (() => undefined)} sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" disableElevation disabled={!canSave || !draft.title.trim()} onClick={onSave}>Save</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Stack>
    </Stack>
  );
}

/** `/notes/new`: a note written by hand (in a project when the list was showing one) */
export function NewNotePage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const projects = useProjects();
  const start = (useLocation().state as { project?: string | null } | null)?.project ?? '';
  const [draft, setDraft] = useState({ title: '', markdown: '' });
  const [project, setProject] = useState<string>(start);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try {
      const note = await createNote({ ...draft, project_id: project || null });
      navigate(`/notes/${encodeURIComponent(note.id)}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Typography variant="h6">New note</Typography>
      </Stack>
      {!online && <Alert severity="info" sx={{ mb: 2 }}>Saving a note needs a connection.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <NoteEditor draft={draft} onChange={setDraft} canSave={online} onSave={() => void save()} onCancel={() => navigate(-1)}>
        {projects.length > 0 && (
          <TextField select size="small" label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
            <MenuItem value="">No project (~/pico/notes)</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
        )}
      </NoteEditor>
    </Box>
  );
}

export function NotePage() {
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
    }, 4_000);
    return () => clearInterval(timer);
  }, [online, draft, noteId, shownVersion]);

  const openPassage = (p: Passage) => navigate(`/read/${encodeURIComponent(p.book_id)}?${new URLSearchParams({
    format: p.format, location: p.location, progress: String(p.progress) })}`);

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
        <MenuItem onClick={() => { setMenu(null); void exportText(asMarkdown(note), `${note.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'note'}.md`); }}>
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
            {day(note.updated_at)}
          </Typography>
          <Markdown text={note.markdown} onCite={(n) => note.sources[n - 1] && openPassage(note.sources[n - 1])}
            sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />
        </>
      )}
    </Box>
  );
}

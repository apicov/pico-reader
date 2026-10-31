import { useState } from 'react';
import { Alert, Box, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { createNote } from '@/services/notes';
import { NoteEditor } from './NoteParts';
import { useProjects } from './useNotes';

/** `/notes/new`: a note written by hand (in a project when the list was showing one) */
export default function NewNotePage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const projects = useProjects();
  const location = useLocation();
  const start = (location.state as { project?: string | null } | null)?.project ?? '';
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

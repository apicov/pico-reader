import { useEffect, useState } from 'react';
import { Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getPref, setPref } from '@/services/prefs';
import { READING_FONT } from '@/theme/readingThemes';
import { NoteCards } from './NoteParts';
import { useNotes, useProjects } from './useNotes';

/** `/notes`: the reader's notes, by project */
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

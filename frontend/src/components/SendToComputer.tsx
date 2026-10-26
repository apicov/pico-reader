import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, Snackbar, ToggleButton,
  ToggleButtonGroup } from '@mui/material';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { sendToComputer, type Drop } from '@/services/computer';
import { getPref, setPref } from '@/services/prefs';
import { cachedProjects, loadProjects, type Project } from '@/services/projects';

const LAST = 'send_target';
const MODE = 'send_mode';
type Mode = 'journal' | 'file';

/** "Send to computer": the reader picks where (the inbox, or one of their projects) and how: added to the end of
 *  that inbox's running file (journal.md: one file to keep open in the editor), or as a file of its own. Both
 *  choices are remembered and come first. `ui` holds the picker and the "sent" message. */
export function useSendToComputer(): { send: (d: Drop) => void; ui: ReactNode } {
  const [projects, setProjects] = useState<Project[]>([]);
  const [last, setLast] = useState<string>('');
  const [mode, setMode] = useState<Mode>('journal');
  const [pending, setPending] = useState<Drop | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void cachedProjects().then(setProjects);
    void loadProjects().then(setProjects);
    void getPref<string>(LAST).then((v) => setLast(v ?? ''));
    void getPref<Mode>(MODE).then((v) => v && setMode(v));
  }, []);

  const go = (d: Drop, projectId: string) => {
    const name = projects.find((p) => p.id === projectId)?.name;
    void setPref(LAST, projectId);
    setLast(projectId);
    const where = `${name ?? 'inbox'}${mode === 'journal' ? ', journal.md' : ''}`;
    void sendToComputer({ ...d, project_id: projectId || null, append: mode === 'journal' }).then((r) => setMessage(
      r === 'sent' ? `Sent to your computer (${where})` : 'Queued: it goes to your computer when online'));
  };
  const pickMode = (m: Mode | null) => { if (m) { setMode(m); void setPref(MODE, m); } };

  const folder = (name: string) => (mode === 'journal' ? `${name}/journal.md` : `${name}/ (a new file)`);
  const targets = [{ id: '', name: 'Inbox', hint: folder('~/pico/inbox') },
    ...projects.map((p) => ({ id: p.id, name: p.name, hint: folder(`${p.name}/inbox`) }))]
    .sort((a, b) => Number(b.id === last) - Number(a.id === last));
  const ui = (
    <>
      <Dialog open={!!pending} onClose={() => setPending(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>Send to your computer</DialogTitle>
        <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, m) => pickMode(m)} sx={{ mx: 3, mb: 1 }}
          aria-label="How">
          <ToggleButton value="journal">Running file</ToggleButton>
          <ToggleButton value="file">New file</ToggleButton>
        </ToggleButtonGroup>
        <List sx={{ pt: 0 }}>
          {targets.map((t) => (
            <ListItemButton key={t.id || 'inbox'} autoFocus={t.id === last}
              onClick={() => { if (pending) go(pending, t.id); setPending(null); }}>
              <ListItemIcon>{t.id ? <FolderOutlinedIcon /> : <ComputerOutlinedIcon />}</ListItemIcon>
              <ListItemText primary={t.name} secondary={t.hint} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
      <Snackbar open={!!message} autoHideDuration={3_000} onClose={() => setMessage('')} message={message} />
    </>
  );
  return { send: setPending, ui };
}

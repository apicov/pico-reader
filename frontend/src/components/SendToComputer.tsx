import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, Snackbar } from '@mui/material';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { sendToComputer, type Drop } from '@/services/computer';
import { getPref, setPref } from '@/services/prefs';
import { cachedProjects, loadProjects, type Project } from '@/services/projects';

const LAST = 'send_target';

/** "Send to computer": straight to the inbox, or, when the reader has projects, into the one they pick (the last
 *  one picked comes first). `ui` holds the picker and the "sent" message. */
export function useSendToComputer(): { send: (d: Drop) => void; ui: ReactNode } {
  const [projects, setProjects] = useState<Project[]>([]);
  const [last, setLast] = useState<string>('');
  const [pending, setPending] = useState<Drop | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void cachedProjects().then(setProjects);
    void loadProjects().then(setProjects);
    void getPref<string>(LAST).then((v) => setLast(v ?? ''));
  }, []);

  const go = (d: Drop, projectId: string) => {
    const name = projects.find((p) => p.id === projectId)?.name;
    void setPref(LAST, projectId);
    setLast(projectId);
    void sendToComputer({ ...d, project_id: projectId || null }).then((r) => setMessage(r === 'sent'
      ? `Sent to your computer${name ? ` (${name})` : ''}` : 'Queued: it goes to your computer when online'));
  };
  const send = (d: Drop) => (projects.length ? setPending(d) : go(d, ''));

  const targets = [{ id: '', name: 'Inbox', hint: '~/pico/inbox' },
    ...projects.map((p) => ({ id: p.id, name: p.name, hint: `${p.name}/inbox` }))]
    .sort((a, b) => Number(b.id === last) - Number(a.id === last));
  const ui = (
    <>
      <Dialog open={!!pending} onClose={() => setPending(null)} fullWidth maxWidth="xs">
        <DialogTitle>Send to your computer</DialogTitle>
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
  return { send, ui };
}

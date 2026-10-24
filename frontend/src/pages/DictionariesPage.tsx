import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel,
  LinearProgress, List, ListItem, ListItemText, ListSubheader, Menu, MenuItem, Paper, Select, Stack, Switch, TextField,
  Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { DictionaryUpload } from '@/components/DictionaryUpload';
import { useAuth } from '@/contexts/AuthContext';
import { byOrder, dictPrefs, setDictEnabled, setDictOrder, subscribeDictPrefs, syncDictPrefs, type DictPrefs } from '@/dict/prefs';
import { installDict, isCurrent, PACKAGE, removeDict, type InstalledDict } from '@/dict/store';
import { useInstalledDicts } from '@/hooks/useInstalledDicts';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { api } from '@/services/api';
import { LANGUAGES, languageName } from '@/services/languages';
import type { Dictionary } from '@/services/types';

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
const packageSize = (d: Dictionary) => (d.files[PACKAGE]?.size ?? 0) + (d.files.res?.size ?? 0);

interface DictJob { id: number; dict_id: string; name: string; status: 'queued' | 'running' | 'failed'; error: string }

function usePrefs(): DictPrefs {
  const [prefs, setPrefs] = useState<DictPrefs>({ disabled: [], order: {} });
  useEffect(() => {
    const load = () => void dictPrefs().then(setPrefs);
    load();
    void syncDictPrefs().then(setPrefs);
    return subscribeDictPrefs(load);
  }, []);
  return prefs;
}

/** Admins: rename, languages, who sees it, delete. */
function AdminMenu({ dict, onChanged }: { dict: Dictionary; onChanged: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: dict.name, from_lang: dict.from_lang, to_lang: dict.to_lang });
  const [error, setError] = useState('');
  const save = async (body: object) => {
    setError('');
    try {
      await api(`/api/admin/dictionaries/${encodeURIComponent(dict.id)}`, { method: 'PUT', body });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton size="small" aria-label={`${dict.name}: manage`} onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <MenuItem onClick={() => { close(); setEditing(true); }}>Rename / languages…</MenuItem>
        <MenuItem onClick={() => { close(); void save({ visibility: dict.visibility === 'private' ? 'everyone' : 'private' }); }}>
          {dict.visibility === 'private' ? 'Share with every reader' : 'Make it only mine'}
        </MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          close();
          if (window.confirm(`Delete “${dict.name}” from the server for everyone? Devices that installed it keep their copy until they remove it.`)) {
            void api(`/api/admin/dictionaries/${encodeURIComponent(dict.id)}`, { method: 'DELETE' }).then(onChanged, (e: Error) => setError(e.message));
          }
        }}>Delete…</MenuItem>
      </Menu>
      <Dialog open={editing} onClose={() => setEditing(false)} fullWidth maxWidth="xs">
        <DialogTitle>{dict.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {(['from_lang', 'to_lang'] as const).map((k) => (
              <FormControl key={k} fullWidth>
                <InputLabel>{k === 'from_lang' ? 'Words in' : 'Explained in'}</InputLabel>
                <Select label={k === 'from_lang' ? 'Words in' : 'Explained in'} value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                  {Object.entries({ ...LANGUAGES, [form[k]]: languageName(form[k]) }).map(([code, n]) => <MenuItem key={code} value={code}>{n}</MenuItem>)}
                </Select>
              </FormControl>
            ))}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="contained" disabled={!form.name.trim()} onClick={() => void save(form)}>Save</Button>
        </DialogActions>
      </Dialog>
      {error && !editing && <Typography variant="caption" color="error">{error}</Typography>}
    </>
  );
}

/** Install dictionaries on this device (they work offline), switch them on or off and order them (for your
 *  account, on every device); admins upload, share and delete them. */
export default function DictionariesPage() {
  const { library, refresh } = useLibrary();
  const installed = useInstalledDicts();
  const prefs = usePrefs();
  const online = useOnlineStatus();
  const { reader } = useAuth();
  const admin = !!reader?.is_admin;
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<DictJob[]>([]);

  // Admins: dictionaries being converted, polled while any is waiting
  const [pollKey, setPollKey] = useState(0);
  useEffect(() => {
    if (!admin || !online) return;
    let timer = 0;
    let cancelled = false;
    let waiting = 0;
    const poll = () => void api<DictJob[]>('/api/admin/dict-jobs').then((list) => {
      if (cancelled) return;
      const active = list.filter((j) => j.status !== 'failed').length;
      if (active < waiting) void refresh(); // one finished: it's in the library now
      waiting = active;
      setJobs(list);
      if (active) timer = window.setTimeout(poll, 15_000);
    }).catch(() => undefined);
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [admin, online, refresh, pollKey]);

  const install = async (d: Dictionary) => {
    setError('');
    setBusy((b) => ({ ...b, [d.id]: 0 }));
    try {
      await installDict(d, (f) => setBusy((b) => ({ ...b, [d.id]: f })));
    } catch (e) {
      setError(`${d.name}: ${(e as Error).message}`);
    } finally {
      setBusy(({ [d.id]: _, ...rest }) => rest);
    }
  };
  const installAll = async (dicts: Dictionary[]) => { for (const d of dicts) await install(d); };
  const removeAll = async (ids: string[]) => { for (const id of ids) await removeDict(id); };

  const all = library?.dictionaries ?? [];
  const byId = new Map(all.map((d) => [d.id, d]));
  const installedHere = Object.values(installed);
  const gone = installedHere.filter((d) => !byId.has(d.id));
  const used = installedHere.reduce((n, d) => n + (d.size ?? (byId.has(d.id) ? packageSize(byId.get(d.id)!) : 0)), 0);

  const byLanguage = new Map<string, Dictionary[]>();
  for (const d of all) byLanguage.set(d.from_lang, [...(byLanguage.get(d.from_lang) ?? []), d]);

  const move = (lang: string, ordered: Dictionary[], i: number, by: number) => {
    const ids = ordered.map((d) => d.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    void setDictOrder(lang, ids);
  };

  return (
    <Box sx={{ maxWidth: 680 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Dictionaries</Typography>
        {admin && <Button startIcon={<UploadFileIcon />} disabled={!online} onClick={() => setUploading(true)}>Upload</Button>}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select a word while reading to look it up in the dictionaries for the book's language that are installed here
        and switched on. Switches and order are kept in your account; installing is per device.
      </Typography>
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Typography variant="body2">
          <b>On this device:</b> {installedHere.length
            ? `${installedHere.length} dictionar${installedHere.length === 1 ? 'y' : 'ies'} · ${mb(used)}`
            : 'none installed yet'}
        </Typography>
      </Paper>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {admin && jobs.length > 0 && (
        <Alert severity={jobs.some((j) => j.status === 'failed') ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {jobs.map((j) => (
            <div key={j.id}>
              {j.name || j.dict_id}: {j.status === 'queued' ? 'waiting to be converted' : j.status === 'running' ? 'converting…' : `failed: ${j.error}`}
            </div>
          ))}
        </Alert>
      )}
      {[...byLanguage.entries()].sort(([a], [b]) => languageName(a).localeCompare(languageName(b))).map(([lang, dicts]) => {
        const here = byOrder(dicts.filter((d) => installed[d.id]), prefs.order[lang]);
        const notHere = dicts.filter((d) => !installed[d.id] && d.files[PACKAGE]);
        const rows = [...here, ...dicts.filter((d) => !installed[d.id])];
        return (
          <List key={lang} dense subheader={
            <ListSubheader disableSticky sx={{ bgcolor: 'transparent', px: 0, display: 'flex', alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>{languageName(lang)}</Box>
              {notHere.length > 1 && <Button size="small" disabled={!online} onClick={() => void installAll(notHere)}>
                Install all ({mb(notHere.reduce((n, d) => n + packageSize(d), 0))})</Button>}
              {here.length > 1 && <Button size="small" color="inherit" onClick={() => {
                if (window.confirm(`Remove the ${here.length} ${languageName(lang)} dictionaries from this device?`)) void removeAll(here.map((d) => d.id));
              }}>Remove all</Button>}
            </ListSubheader>}>
            {rows.map((d) => {
              const inst: InstalledDict | undefined = installed[d.id];
              const file = d.files[PACKAGE];
              const outdated = inst && file && (inst.sha256 !== file.sha256 || !isCurrent(inst));
              const progress = busy[d.id];
              const enabled = !prefs.disabled.includes(d.id);
              const i = here.indexOf(d);
              return (
                <ListItem key={d.id} disableGutters sx={{ alignItems: 'flex-start', opacity: inst && !enabled ? 0.55 : 1 }}>
                  <ListItemText
                    primary={<>
                      {d.name}
                      {d.visibility === 'private' && <Chip size="small" label="Only me" sx={{ ml: 1, height: 20 }} />}
                    </>}
                    secondary={<>
                      → {languageName(d.to_lang)} · {d.entry_count.toLocaleString()} entries
                      {file ? ` · ${mb(packageSize(d))}` : ''}{inst && !outdated ? ' · installed' : ''}
                      {inst && !enabled ? ' · off' : ''}
                      {progress !== undefined && (
                        <LinearProgress variant={progress > 0 && progress < 1 ? 'determinate' : 'indeterminate'}
                          value={progress * 100} sx={{ mt: 0.5, mr: 2 }} />
                      )}
                    </>}
                    slotProps={{ secondary: { component: 'div' } }}
                  />
                  <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
                    {inst && here.length > 1 && (
                      <>
                        <IconButton size="small" aria-label="Move up" disabled={i <= 0} onClick={() => move(lang, here, i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="Move down" disabled={i < 0 || i >= here.length - 1} onClick={() => move(lang, here, i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                      </>
                    )}
                    {inst && <Switch size="small" checked={enabled} inputProps={{ 'aria-label': `${d.name}: use for lookups` }}
                      onChange={(e) => void setDictEnabled(d.id, e.target.checked)} />}
                    {progress === undefined && (inst && !outdated
                      ? <Button size="small" color="inherit" onClick={() => void removeDict(d.id)}>Remove</Button>
                      : <Button size="small" disabled={!online || !file} onClick={() => void install(d)}>{outdated ? 'Update' : 'Install'}</Button>)}
                    {d.can_change && <AdminMenu dict={d} onChanged={() => void refresh()} />}
                  </Stack>
                </ListItem>
              );
            })}
          </List>
        );
      })}
      {gone.length > 0 && (
        <List dense subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', px: 0 }}>No longer available</ListSubheader>}>
          {gone.map((d) => (
            <ListItem key={d.id} disableGutters secondaryAction={
              <Button size="small" color="inherit" onClick={() => void removeDict(d.id)}>Remove</Button>}>
              <ListItemText primary={d.name} secondary={`Removed from the library${d.size ? ` · ${mb(d.size)} on this device` : ''}`} />
            </ListItem>
          ))}
        </List>
      )}
      {library && all.length === 0 && <Typography color="text.secondary">No dictionaries in the library yet.</Typography>}
      <DictionaryUpload open={uploading} onClose={() => setUploading(false)} onQueued={() => setPollKey((k) => k + 1)} />
    </Box>
  );
}

import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, LinearProgress,
  MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { api } from '@/services/api';
import { LANGUAGES } from '@/services/languages';
import { put, sha256 } from '@/upload/upload';
import { stardictZip, type IfoInfo } from '@/upload/stardict';

/** Admins: send a StarDict to the server, which converts it (Dictionaries page shows "Converting…"). */
export function DictionaryUpload({ open, onClose, onQueued }: { open: boolean; onClose: () => void; onQueued: () => void }) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ zip: Blob; info: IfoInfo } | null>(null);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'everyone'>('private');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  const reset = () => { setPicked(null); setName(''); setFrom(''); setTo(''); setProgress(null); setError(''); };
  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    try {
      const p = await stardictZip([...list]);
      setPicked(p);
      setName(p.info.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    if (!picked) return;
    setError('');
    setProgress(0);
    try {
      const source = { size: picked.zip.size, sha256: await sha256(picked.zip), content_type: 'application/zip' };
      const res = await api<{ id: string; uploads: { source: string } }>('/api/admin/dictionaries/upload', {
        method: 'POST', body: { name: name.trim(), from_lang: from, to_lang: to, visibility, source } });
      await put(res.uploads.source, picked.zip, 'application/zip', (n) => setProgress(n / picked.zip.size));
      await api(`/api/admin/dictionaries/${encodeURIComponent(res.id)}/convert`, { method: 'POST' });
      onQueued();
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  const langSelect = (label: string, value: string, set: (v: string) => void) => (
    <FormControl fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => set(e.target.value)}>
        {Object.entries(LANGUAGES).map(([code, n]) => <MenuItem key={code} value={code}>{n}</MenuItem>)}
      </Select>
    </FormControl>
  );

  return (
    <Dialog open={open} onClose={progress === null ? () => { reset(); onClose(); } : undefined} fullWidth maxWidth="sm">
      <DialogTitle>Upload a dictionary</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            A StarDict dictionary: its .ifo, .idx and .dict (or .dict.dz) files, with .syn and a res folder if it has
            them, or a zip of them. The server converts it; it appears here when ready.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => filesInput.current?.click()} disabled={progress !== null}>Choose files or zip</Button>
            <Button variant="outlined" onClick={() => folderInput.current?.click()} disabled={progress !== null}>Choose a folder</Button>
          </Stack>
          <input ref={filesInput} type="file" multiple hidden accept=".zip,.ifo,.idx,.gz,.dict,.dz,.syn"
            onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
          <input ref={folderInput} type="file" hidden {...{ webkitdirectory: '' }}
            onChange={(e) => { void choose(e.target.files); e.target.value = ''; }} />
          {picked && (
            <>
              <Typography variant="body2">
                {picked.info.wordcount.toLocaleString()} entries · {picked.zip.size < 1e6 ? `${Math.max(1, Math.round(picked.zip.size / 1e3))} KB` : `${(picked.zip.size / 1e6).toFixed(1)} MB`} to send
              </Typography>
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 200 }} />
              <Stack direction="row" spacing={1}>
                {langSelect('Words in', from, setFrom)}
                {langSelect('Explained in', to, setTo)}
              </Stack>
              <FormControl fullWidth>
                <InputLabel>Who sees it</InputLabel>
                <Select label="Who sees it" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'everyone')}>
                  <MenuItem value="private">Only me</MenuItem>
                  <MenuItem value="everyone">Every reader</MenuItem>
                </Select>
              </FormControl>
            </>
          )}
          {progress !== null && <Box><LinearProgress variant="determinate" value={progress * 100} /></Box>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={progress !== null} onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button variant="contained" disabled={!picked || !name.trim() || !from || !to || progress !== null}
          onClick={() => void send()}>Upload</Button>
      </DialogActions>
    </Dialog>
  );
}

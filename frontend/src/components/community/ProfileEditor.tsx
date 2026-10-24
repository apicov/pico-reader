import { useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { avatarFromFile, saveAvatar, saveProfile, type MyProfile } from '@/services/community';
import { MemberAvatar } from './parts';

/** Name, handle, bio, picture and what others see. Used on /profile and as the first-visit prompt. */
export function ProfileEditor({ profile, onSaved, submitLabel = 'Save' }: {
  profile: MyProfile; onSaved: (p: MyProfile) => void; submitLabel?: string;
}) {
  const [form, setForm] = useState({ handle: profile.handle, display_name: profile.display_name, bio: profile.bio,
    show_reading: profile.show_reading });
  const [current, setCurrent] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<MyProfile>) => {
    setBusy(true);
    setError('');
    try {
      const saved = await work();
      setCurrent(saved);
      return saved;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <MemberAvatar author={{ ...current, display_name: form.display_name || current.display_name }} size={64} />
        <Box>
          <Button size="small" disabled={busy} onClick={() => fileInput.current?.click()}>
            {current.avatar_url ? 'Change picture' : 'Add a picture'}
          </Button>
          {current.avatar_url && (
            <Button size="small" color="inherit" disabled={busy} onClick={() => void run(() => saveAvatar(null))}>Remove</Button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(async () => saveAvatar(await avatarFromFile(file)));
          }} />
        </Box>
      </Stack>
      <TextField label="Name" value={form.display_name} inputProps={{ maxLength: 60 }}
        onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
      <TextField label="Handle" value={form.handle} inputProps={{ maxLength: 20 }}
        helperText="3–20 letters, digits or _; your profile is /u/handle"
        onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
      <TextField label="About you" value={form.bio} multiline minRows={2} inputProps={{ maxLength: 1000 }}
        onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      <FormControlLabel control={<Switch checked={form.show_reading}
        onChange={(e) => setForm({ ...form, show_reading: e.target.checked })} />}
        label="Show the books I'm reading on my profile" />
      <Typography variant="caption" color="text.secondary">
        Other readers see your name, handle, picture, reviews, posts, comments and lists, never your email.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button variant="contained" disabled={busy || form.handle.length < 3}
          onClick={() => void run(() => saveProfile(form)).then((p) => p && onSaved(p))}>{submitLabel}</Button>
      </Box>
    </Stack>
  );
}

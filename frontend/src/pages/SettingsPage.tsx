import { Box, Button, Divider, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { LANGUAGES } from '@/services/languages';
import { READING_THEMES, type ReadingThemeName } from '@/theme/readingThemes';

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const { reader, signOut } = useAuth();

  return (
    <Stack spacing={3} sx={{ maxWidth: 520 }}>
      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Theme</Typography>
        <Stack direction="row" spacing={1.5}>
          {(Object.keys(READING_THEMES) as ReadingThemeName[]).map((name) => {
            const t = READING_THEMES[name];
            const selected = settings.theme === name;
            return (
              <Box key={name} component="button" onClick={() => update({ theme: name })} aria-pressed={selected}
                sx={{ width: 72, height: 72, borderRadius: 2, cursor: 'pointer', bgcolor: t.background, color: t.text,
                  border: 2, borderColor: selected ? 'primary.main' : t.divider, fontFamily: 'inherit', fontSize: 13 }}>
                <Box sx={{ fontSize: 22, fontFamily: 'Literata, serif' }}>Aa</Box>{t.label}
              </Box>
            );
          })}
        </Stack>
      </Box>
      <FormControl size="small">
        <InputLabel id="target-lang">Translate into</InputLabel>
        <Select labelId="target-lang" label="Translate into" value={settings.targetLanguage}
          onChange={(e) => update({ targetLanguage: e.target.value })}>
          {Object.entries(LANGUAGES).map(([code, name]) => <MenuItem key={code} value={code}>{name}</MenuItem>)}
        </Select>
      </FormControl>
      <Divider />
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Signed in as {reader?.email}</Typography>
        <Button variant="outlined" color="inherit" onClick={() => void signOut()}>Sign out</Button>
      </Box>
    </Stack>
  );
}

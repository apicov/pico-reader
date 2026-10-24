import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, List, ListItem, ListItemText, ListSubheader, Typography } from '@mui/material';
import { installDict, isCurrent, PACKAGE, removeDict } from '@/dict/store';
import { useInstalledDicts } from '@/hooks/useInstalledDicts';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { languageName } from '@/services/languages';
import type { Dictionary } from '@/services/types';

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Install dictionaries on this device; they work offline once installed. */
export default function DictionariesPage() {
  const { library } = useLibrary();
  const installed = useInstalledDicts();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [error, setError] = useState('');

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

  const byLanguage = new Map<string, Dictionary[]>();
  for (const d of library?.dictionaries ?? []) {
    byLanguage.set(d.from_lang, [...(byLanguage.get(d.from_lang) ?? []), d]);
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Dictionaries</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select a word while reading to look it up in the installed dictionaries for the book's language.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {[...byLanguage.entries()].sort(([a], [b]) => languageName(a).localeCompare(languageName(b))).map(([lang, dicts]) => (
        <List key={lang} dense subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', px: 0 }}>{languageName(lang)}</ListSubheader>}>
          {dicts.map((d) => {
            const inst = installed[d.id];
            const file = d.files[PACKAGE];
            const outdated = inst && file && (inst.sha256 !== file.sha256 || !isCurrent(inst));
            const progress = busy[d.id];
            return (
              <ListItem key={d.id} disableGutters secondaryAction={progress === undefined && (
                inst && !outdated
                  ? <Button size="small" color="inherit" onClick={() => void removeDict(d.id)}>Remove</Button>
                  : <Button size="small" disabled={!online || !file} onClick={() => void install(d)}>{outdated ? 'Update' : 'Install'}</Button>
              )}>
                <ListItemText
                  primary={d.name}
                  secondary={<>
                    {languageName(d.from_lang)} → {languageName(d.to_lang)} · {d.entry_count.toLocaleString()} entries
                    {file ? ` · ${mb(file.size + (d.files.res?.size ?? 0))}` : ''}{inst && !outdated ? ' · installed' : ''}
                    {progress !== undefined && (
                      <LinearProgress variant={progress > 0 && progress < 1 ? 'determinate' : 'indeterminate'}
                        value={progress * 100} sx={{ mt: 0.5, mr: 2 }} />
                    )}
                  </>}
                  slotProps={{ secondary: { component: 'div' } }}
                  sx={{ pr: 9 }}
                />
              </ListItem>
            );
          })}
        </List>
      ))}
      {library && library.dictionaries.length === 0 && (
        <Typography color="text.secondary">No dictionaries in the library yet.</Typography>
      )}
    </Box>
  );
}

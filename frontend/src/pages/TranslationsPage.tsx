import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, InputAdornment, Menu, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { downloadExport } from '@/services/download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { deleteTranslation, localTranslations, subscribeTranslations, syncTranslations, type Translation } from '@/services/translations';
import { READING_FONT } from '@/theme/readingThemes';

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every translation made, newest first; readable offline. */
export default function TranslationsPage() {
  const { library } = useLibrary();
  const online = useOnlineStatus();
  const [items, setItems] = useState<Translation[]>([]);
  const [book, setBook] = useState('all');
  const [query, setQuery] = useState('');
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [exportError, setExportError] = useState('');

  const exportAs = async (kind: 'apkg' | 'tsv') => {
    setExportAnchor(null);
    setExportError('');
    const q = book === 'all' ? '' : `?book_id=${encodeURIComponent(book)}`;
    try {
      await downloadExport(`/api/vocabulary.${kind}${q}`, `pico-reader-vocabulary.${kind}`);
    } catch (e) {
      setExportError((e as Error).message);
    }
  };

  useEffect(() => {
    const load = () => void localTranslations().then(setItems);
    load();
    if (online) void syncTranslations().catch(() => undefined);
    return subscribeTranslations(load);
  }, [online]);

  const titles = useMemo(() => new Map((library?.books ?? []).map((b) => [b.id, b.title])), [library]);
  const books = [...new Set(items.map((t) => t.book_id).filter((b): b is string => !!b))];
  const q = plain(query.trim());
  const shown = items.filter((t) => (book === 'all' || t.book_id === book)
    && (!q || plain(`${t.source_text} ${t.translation} ${t.vocabulary.map((v) => v.term).join(' ')}`).includes(q)));

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Translations</Typography>
        <Button startIcon={<FileDownloadOutlinedIcon />} disabled={!online || items.length === 0}
          onClick={(e) => setExportAnchor(e.currentTarget)}>Vocabulary</Button>
        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => void exportAs('apkg')}>Anki deck (.apkg)</MenuItem>
          <MenuItem onClick={() => void exportAs('tsv')}>Spreadsheet (.tsv)</MenuItem>
        </Menu>
      </Stack>
      {exportError && <Alert severity="error" sx={{ mb: 2 }}>{exportError}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
        <Select size="small" value={book} onChange={(e) => setBook(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="all">All books</MenuItem>
          {books.map((b) => <MenuItem key={b} value={b}>{titles.get(b) ?? b}</MenuItem>)}
        </Select>
      </Stack>
      {shown.length === 0 && (
        <Typography color="text.secondary">
          {items.length ? 'Nothing matches.' : 'Select a passage while reading and tap Translate; it will be kept here.'}
        </Typography>
      )}
      <Stack spacing={1.5}>
        {shown.map((t) => (
          <Card key={t.id}>
            <CardContent sx={{ '&:last-child': { pb: 2 } }}>
              <Stack direction="row" alignItems="flex-start" spacing={1}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontFamily: READING_FONT }} lang={t.source_lang}>{t.source_text}</Typography>
                  <Typography sx={{ fontFamily: READING_FONT, mt: 1, color: 'primary.main' }} lang={t.target_lang}>{t.translation}</Typography>
                  {t.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t.notes}</Typography>}
                  {t.vocabulary.length > 0 && (
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                      {t.vocabulary.map((v) => <Chip key={v.term} size="small" variant="outlined" label={`${v.term} · ${v.meaning}`} />)}
                    </Stack>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    {titles.get(t.book_id ?? '') ?? t.book_id ?? ''} · {new Date(t.created_at).toLocaleDateString()}
                    {t.model ? ` · ${t.model}` : ''}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Delete" disabled={!online} onClick={() => void deleteTranslation(t.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

/** Choosing and browsing categories (services/categories.ts). */
import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
  Typography } from '@mui/material';
import { ancestry, children, loadCategories, pretty, setBookCategory, suggestAgain, type Category,
  type CategoryFilter } from '@/services/categories';
import type { Book } from '@/services/types';

export function CategoryPicker({ tree, value, onChange, label }: {
  tree: Category[]; value: number | null; onChange: (id: number | null) => void; label: string;
}) {
  const options = [...tree].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <Autocomplete<Category>
      options={options}
      value={tree.find((c) => c.id === value) ?? null}
      onChange={(_, c) => onChange(c?.id ?? null)}
      getOptionLabel={(c) => pretty(c.path)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={({ key, ...props }, c) => (
        <li key={key} {...props} style={{ paddingLeft: 12 + (c.depth - 1) * 16 }}>
          <Typography variant="body2" sx={{ fontWeight: c.depth === 1 ? 600 : 400 }}>{c.name}</Typography>
          {c.status === 'suggested' && <Chip size="small" label="new" sx={{ ml: 1, height: 18 }} />}
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

/** Rows of chips: the top level, then the chosen category's subcategories, then theirs. */
export function CategoryBrowser({ tree, value, onChange, uncategorised }: {
  tree: Category[]; value: CategoryFilter; onChange: (v: CategoryFilter) => void; uncategorised: number;
}) {
  const chain = typeof value === 'number' ? ancestry(tree, value) : [];
  const rows: { parent: number | null; selected: number | null }[] = [{ parent: null, selected: chain[0]?.id ?? null }];
  for (let i = 0; i < chain.length; i++) {
    if (children(tree, chain[i].id).some((c) => c.books > 0)) rows.push({ parent: chain[i].id, selected: chain[i + 1]?.id ?? null });
  }
  const chip = (c: Category, selected: boolean, parent: number | null) => (
    <Chip key={c.id} size="small" clickable color={selected ? 'primary' : 'default'} variant={selected ? 'filled' : 'outlined'}
      label={<>{c.name} <Box component="span" sx={{ opacity: 0.7 }}>{c.books}</Box>{c.status === 'suggested' ? ' · new' : ''}</>}
      onClick={() => onChange(selected ? parent ?? null : c.id)} />
  );
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {rows.map(({ parent, selected }, level) => (
        <Stack key={level} direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
          {level === 0 && (
            <Chip size="small" clickable label="All" color={value === null ? 'primary' : 'default'}
              variant={value === null ? 'filled' : 'outlined'} onClick={() => onChange(null)} />
          )}
          {children(tree, parent).filter((c) => c.books > 0 || c.id === selected).map((c) => chip(c, c.id === selected, parent))}
          {level === 0 && uncategorised > 0 && (
            <Chip size="small" clickable label={<>Uncategorised <Box component="span" sx={{ opacity: 0.7 }}>{uncategorised}</Box></>}
              color={value === 'none' ? 'primary' : 'default'} variant={value === 'none' ? 'filled' : 'outlined'}
              onClick={() => onChange(value === 'none' ? null : 'none')} />
          )}
        </Stack>
      ))}
    </Stack>
  );
}

/** The uploader or an admin sets a book's categories, or asks the AI again. */
export function BookCategoryDialog({ book, open, onClose, onSaved }: {
  book: Book; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [tree, setTree] = useState<Category[]>([]);
  const [main, setMain] = useState<number | null>(book.category_id ?? null);
  const [second, setSecond] = useState<number | null>(book.category2_id ?? null);
  const [reason, setReason] = useState(book.category_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    void loadCategories().then(setTree);
    setMain(book.category_id ?? null);
    setSecond(book.category2_id ?? null);
    setReason(book.category_reason ?? '');
  }, [open, book]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Category of “{book.title}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <CategoryPicker tree={tree} value={main} onChange={setMain} label="Category" />
          <CategoryPicker tree={tree} value={second} onChange={setSecond} label="Also in (optional)" />
          {reason && <Typography variant="body2" color="text.secondary">AI: {reason}</Typography>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => void run(async () => {
          const r = await suggestAgain(book.id);
          const tree2 = await loadCategories();
          setTree(tree2);
          setMain(tree2.find((c) => c.path === r.category)?.id ?? null);
          setSecond(tree2.find((c) => c.path === r.second)?.id ?? null);
          setReason(r.reason);
          onSaved();
        })} sx={{ mr: 'auto' }}>Suggest again</Button>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy} onClick={() => void run(async () => {
          await setBookCategory(book.id, main, main ? second : null);
          onSaved();
          onClose();
        })}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

import { useEffect, useState, type ReactElement } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem,
  ListItemText, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { CategoryPicker } from '@/components/categories';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/services/api';
import { children, loadCategories, pretty, type Category } from '@/services/categories';

type Edit = { kind: 'rename' | 'add' | 'merge'; node: Category | null };

/** Admins: the category tree with book counts; approve the AI's suggestions, rename, add, merge, delete. */
export default function CategoriesPage() {
  const { reader } = useAuth();
  const [tree, setTree] = useState<Category[]>([]);
  const [menu, setMenu] = useState<{ el: HTMLElement; node: Category } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [text, setText] = useState('');
  const [into, setInto] = useState<number | null>(null);
  const [error, setError] = useState('');
  const reload = () => void loadCategories().then(setTree);
  useEffect(reload, []);
  if (!reader?.is_admin) return <Alert severity="info">Only admins manage the categories.</Alert>;

  const run = async (path: string, method: string, body?: object) => {
    setError('');
    try {
      await api(path, { method, body });
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const suggested = tree.filter((c) => c.status === 'suggested');

  const rows = (parent: number | null): ReactElement[] => children(tree, parent).flatMap((c) => [
    <ListItem key={c.id} disableGutters sx={{ pl: (c.depth - 1) * 3 }} secondaryAction={
      <IconButton size="small" aria-label={`${c.name}: manage`} onClick={(e) => setMenu({ el: e.currentTarget, node: c })}>
        <MoreVertIcon fontSize="small" />
      </IconButton>}>
      <ListItemText primary={<>
        <Box component="span" sx={{ fontWeight: c.depth === 1 ? 600 : 400 }}>{c.name}</Box>
        {c.status === 'suggested' && <Chip size="small" color="warning" label="new" sx={{ ml: 1, height: 20 }} />}
      </>} secondary={`${c.books} book${c.books === 1 ? '' : 's'}`} />
    </ListItem>,
    ...rows(c.id),
  ]);

  return (
    <Box sx={{ maxWidth: 680 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Categories</Typography>
        <Button onClick={() => { setText(''); setEdit({ kind: 'add', node: null }); }}>Add top level</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The AI files new books here after indexing. It suggests a new category only when none fits; those are marked
        “new” until you approve, rename or merge them.
      </Typography>
      {suggested.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          New from the AI: {suggested.map((c) => pretty(c.path)).join(', ')}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <List dense>{rows(null)}</List>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu?.node.status === 'suggested' && (
          <MenuItem onClick={() => { const n = menu.node; setMenu(null); void run(`/api/admin/categories/${n.id}`, 'PUT', { status: 'approved' }); }}>Approve</MenuItem>
        )}
        <MenuItem onClick={() => { const n = menu!.node; setMenu(null); setText(n.name); setEdit({ kind: 'rename', node: n }); }}>Rename…</MenuItem>
        {menu && menu.node.depth < 3 && (
          <MenuItem onClick={() => { const n = menu.node; setMenu(null); setText(''); setEdit({ kind: 'add', node: n }); }}>Add a subcategory…</MenuItem>
        )}
        <MenuItem onClick={() => { const n = menu!.node; setMenu(null); setInto(null); setEdit({ kind: 'merge', node: n }); }}>Merge into…</MenuItem>
        {menu && menu.node.books === 0 && !tree.some((c) => c.parent_id === menu.node.id) && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { const n = menu.node; setMenu(null); void run(`/api/admin/categories/${n.id}`, 'DELETE'); }}>Delete</MenuItem>
        )}
      </Menu>
      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {edit?.kind === 'add' ? (edit.node ? `New under ${edit.node.name}` : 'New top-level category')
            : edit?.kind === 'rename' ? `Rename ${edit.node?.name}` : `Merge ${edit?.node?.name} into…`}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {edit?.kind === 'merge' ? (
              <>
                <CategoryPicker tree={tree.filter((c) => c.id !== edit.node?.id)} value={into} onChange={setInto} label="Into" />
                <Typography variant="caption" color="text.secondary">Its books and subcategories move there; it's then deleted.</Typography>
              </>
            ) : (
              <TextField autoFocus fullWidth label="Name" value={text} onChange={(e) => setText(e.target.value)} inputProps={{ maxLength: 60 }} />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEdit(null)}>Cancel</Button>
          <Button variant="contained" disabled={edit?.kind === 'merge' ? into === null : !text.trim()} onClick={() => {
            if (!edit) return;
            if (edit.kind === 'add') void run('/api/admin/categories', 'POST', { parent_id: edit.node?.id ?? null, name: text.trim() });
            else if (edit.kind === 'rename') void run(`/api/admin/categories/${edit.node!.id}`, 'PUT', { name: text.trim() });
            else void run(`/api/admin/categories/${edit.node!.id}/merge`, 'POST', { into });
          }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

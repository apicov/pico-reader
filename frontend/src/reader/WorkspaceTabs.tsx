import { useState } from 'react';
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListItemIcon,
  Menu, MenuItem, TextField, Typography } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import { readerPath } from '@/reader/jump';
import { clearReadingNow } from '@/reader/readingNow';
import type { Book } from '@/services/types';
import { closeTab, createWorkspace, deleteWorkspace, currentWorkspace, frontBook, openInWorkspace, renameWorkspace,
  switchWorkspace, useWorkspaces } from '@/services/workspaces';

/** Under the reader's bar, with two books open or more (or more than one workspace): the workspace's name (its menu:
 *  switch, new, rename, delete) and a tab per book. Switching replaces the address, so Back leaves the reader. */
export function WorkspaceTabs({ bookId, books }: { bookId: string; books: Book[] | undefined }) {
  const { list, current } = useWorkspaces();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  if (!current) return null;
  // books gone from the library don't get a tab
  const tabs = current.book_ids.filter((id) => !books || books.some((b) => b.id === id));
  if (tabs.length < 2 && list.length < 2) return null;

  const show = (id: string | null) => {
    if (!id) clearReadingNow();
    navigate(id ? readerPath(id) : '/', { replace: true });
  };
  const close = async (id: string) => {
    const next = await closeTab(id);
    if (id === bookId) show(next);
  };
  const open = async (id: string) => {
    setMenu(null);
    show(await switchWorkspace(id));
  };
  const remove = async () => {
    setDeleting(false);
    await deleteWorkspace(current.id);
    const front = await frontBook(await currentWorkspace());
    if (front) show(front);
    else void openInWorkspace(bookId); // the book being read stays open, in the workspace that's current now
  };
  const startNaming = (kind: 'new' | 'rename') => {
    setMenu(null);
    setName(kind === 'rename' ? current.name : '');
    setNaming(kind);
  };
  const saveName = async () => {
    const n = name.trim();
    if (!n) return;
    if (naming === 'new') await createWorkspace(n, bookId);
    else await renameWorkspace(current.id, n);
    setNaming(null);
  };
  const title = (id: string) => books?.find((b) => b.id === id)?.title ?? '…';

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', minHeight: 36, borderTop: 1, borderColor: 'divider' }}>
      <Button color="inherit" endIcon={<ArrowDropDownIcon />} aria-label={`Workspace: ${current.name}`}
        onClick={(e) => setMenu(e.currentTarget)}
        sx={{ flexShrink: 0, maxWidth: 140, px: 1.5, fontWeight: 600, textTransform: 'none', borderRadius: 0 }}>
        <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>{current.name}</Typography>
      </Button>
      <Box role="tablist" aria-label="Open books" sx={{ display: 'flex', overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
        {tabs.map((id) => {
          const selected = id === bookId;
          return (
            <Box key={id} sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, borderLeft: 1, borderColor: 'divider',
              borderBottom: 2, borderBottomColor: selected ? 'primary.main' : 'transparent' }}>
              <ButtonBase role="tab" aria-selected={selected} onClick={() => !selected && show(id)}
                sx={{ pl: 1.5, pr: 0.5, height: '100%', maxWidth: { xs: 130, sm: 220 } }}>
                <Typography noWrap sx={{ fontSize: 14, fontWeight: selected ? 600 : 400, opacity: selected ? 1 : 0.75 }}>
                  {title(id)}
                </Typography>
              </ButtonBase>
              <IconButton size="small" aria-label={`Close ${title(id)}`} onClick={() => void close(id)}
                sx={{ mr: 0.5, p: 0.5, '& .MuiSvgIcon-root': { fontSize: 16 } }}>
                <CloseIcon />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)}>
        {list.map((w) => (
          <MenuItem key={w.id} selected={w.id === current.id} onClick={() => void open(w.id)}>
            <ListItemIcon>{w.id === current.id && <CheckIcon fontSize="small" />}</ListItemIcon>
            {w.name} <Typography component="span" color="text.secondary" sx={{ ml: 1, fontSize: 13 }}>{w.book_ids.length}</Typography>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => startNaming('new')}>New workspace…</MenuItem>
        <MenuItem onClick={() => startNaming('rename')}>Rename…</MenuItem>
        <MenuItem onClick={() => { setMenu(null); setDeleting(true); }}>Delete workspace</MenuItem>
      </Menu>

      <Dialog open={naming !== null} onClose={() => setNaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>{naming === 'new' ? 'New workspace' : 'Rename workspace'}</DialogTitle>
        <DialogContent>
          {naming === 'new' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              It starts with the book you're reading; books you open next join it.
            </Typography>
          )}
          <TextField autoFocus fullWidth label="Name" value={name} slotProps={{ htmlInput: { maxLength: 60 } }}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNaming(null)}>Cancel</Button>
          <Button onClick={() => void saveName()} disabled={!name.trim()}>{naming === 'new' ? 'Create' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleting} onClose={() => setDeleting(false)}>
        <DialogTitle>Delete “{current.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Its tabs close. The books themselves stay in the library, at their place.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)}>Cancel</Button>
          <Button color="error" onClick={() => void remove()}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

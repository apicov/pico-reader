import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, List, ListItemButton,
  ListItemText, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { deleteConversation, listConversations, localConversations, updateConversation, type Conversation } from '@/services/chat';
import { markdownSnippet } from '@/utils/text';

/** The conversation list: search, new, pick, rename, delete. */
export function ConversationList({ current, onPick, onNew, refreshKey, online }: {
  current: string | null; onPick: (id: string) => void; onNew: () => void; refreshKey: number; online: boolean;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ el: HTMLElement; c: Conversation } | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const q = query.trim();
    try {
      setItems(online ? await listConversations(q) : await localConversations(q));
    } catch {
      setItems(await localConversations(q));
    }
  }, [query, online]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query, refreshKey]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack spacing={1} sx={{ p: 1.5 }}>
        <Button variant="outlined" startIcon={<AddCommentOutlinedIcon />} onClick={onNew}>New chat</Button>
        <TextField size="small" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      </Stack>
      <List dense sx={{ overflowY: 'auto', flex: 1, pt: 0 }}>
        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {query ? 'No chat matches.' : 'No chats yet.'}
          </Typography>
        )}
        {items.map((c) => (
          <ListItemButton key={c.id} selected={c.id === current} onClick={() => onPick(c.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ el: e.currentTarget, c }); }}
            sx={{ pr: 5, position: 'relative' }}>
            <ListItemText primary={c.title || 'New chat'} secondary={markdownSnippet(c.snippet)}
              slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
            <IconButton size="small" aria-label="Chat actions" disabled={!online}
              sx={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, c }); }}>
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setRenaming(menu!.c); setName(menu!.c.title); setMenu(null); }}>
          <DriveFileRenameOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Rename
        </MenuItem>
        <MenuItem onClick={() => {
          const c = menu!.c;
          setMenu(null);
          void deleteConversation(c.id).then(() => { if (c.id === current) onNew(); void load(); });
        }}>
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>
      <Dialog open={!!renaming} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rename chat</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
          <Button onClick={() => {
            const c = renaming!;
            setRenaming(null);
            void updateConversation(c.id, { title: name.trim() }).then(() => void load());
          }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

import { useState } from 'react';
import { Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, Stack, TextField } from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { createCollection, deleteCollection, moveCollection, renameCollection, setInCollection,
  type Collection } from '@/services/shelf';

/** Which books My shelf shows: all, one collection, or those in none */
export type CollectionFilter = 'all' | 'none' | string;

const MAX_NAME = 60;

/** The chips above My shelf; the last one opens the dialog that manages the collections */
export function CollectionChips({ collections, value, onChange, counts, unsorted }: {
  collections: Collection[]; value: CollectionFilter; onChange: (v: CollectionFilter) => void;
  counts: Record<string, number>; unsorted: number;
}) {
  const [managing, setManaging] = useState(false);
  const chip = (v: CollectionFilter, label: string) => (
    <Chip key={v} label={label} size="small" clickable color={value === v ? 'primary' : 'default'}
      variant={value === v ? 'filled' : 'outlined'} onClick={() => onChange(v)} />
  );
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
      {chip('all', 'All')}
      {collections.map((c) => chip(c.id, `${c.name} (${counts[c.id] ?? 0})`))}
      {collections.length > 0 && unsorted > 0 && chip('none', `Not in a collection (${unsorted})`)}
      <Chip size="small" variant="outlined" icon={<FolderOutlinedIcon />} label="Collections…" onClick={() => setManaging(true)} />
      <ManageCollections open={managing} collections={collections} onClose={() => setManaging(false)}
        onDeleted={(id) => value === id && onChange('all')} />
    </Stack>
  );
}

function ManageCollections({ open, collections, onClose, onDeleted }: {
  open: boolean; collections: Collection[]; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const add = () => { if (name.trim()) void createCollection(name.slice(0, MAX_NAME)).then(() => setName('')); };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Collections</DialogTitle>
      <DialogContent>
        <List dense>
          {collections.map((c, i) => (
            <ListItem key={c.id} disableGutters secondaryAction={
              <>
                <IconButton size="small" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => void moveCollection(c.id, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Move ${c.name} down`} disabled={i === collections.length - 1} onClick={() => void moveCollection(c.id, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}><EditOutlinedIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Delete ${c.name}`} onClick={() => {
                  if (window.confirm(`Delete the collection “${c.name}”? Its books stay on My shelf.`)) {
                    void deleteCollection(c.id).then(() => onDeleted(c.id));
                  }
                }}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </>
            }>
              {editing?.id === c.id ? (
                <TextField size="small" autoFocus value={editing.name} sx={{ mr: 18 }}
                  slotProps={{ htmlInput: { maxLength: MAX_NAME, 'aria-label': 'Collection name' } }}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editing.name.trim()) void renameCollection(c.id, editing.name).then(() => setEditing(null));
                    if (e.key === 'Escape') setEditing(null);
                  }} />
              ) : (
                <ListItemText primary={c.name} secondary={`${c.book_ids.length} book${c.book_ids.length === 1 ? '' : 's'}`} sx={{ pr: 18 }} />
              )}
            </ListItem>
          ))}
        </List>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" fullWidth placeholder="New collection" value={name}
            slotProps={{ htmlInput: { maxLength: MAX_NAME } }}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add} disabled={!name.trim()}>Add</Button>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  );
}

/** A book's ⋮ → Collections…: tick the collections it's in, or make a new one for it */
export function BookCollections({ bookId, title, collections, open, onClose }: {
  bookId: string; title: string; collections: Collection[]; open: boolean; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    void createCollection(name.slice(0, MAX_NAME)).then((id) => setInCollection(id, bookId, true)).then(() => setName(''));
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 0 }}>Collections</DialogTitle>
      <DialogContent>
        <ListItemText secondary={title} sx={{ mb: 1 }} />
        <List dense disablePadding>
          {collections.map((c) => {
            const inIt = c.book_ids.includes(bookId);
            return (
              <ListItemButton key={c.id} onClick={() => void setInCollection(c.id, bookId, !inIt)} sx={{ px: 0 }}>
                <ListItemIcon sx={{ minWidth: 36 }}><Checkbox edge="start" checked={inIt} tabIndex={-1} disableRipple /></ListItemIcon>
                <ListItemText primary={c.name} />
              </ListItemButton>
            );
          })}
        </List>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" fullWidth placeholder="New collection" value={name}
            slotProps={{ htmlInput: { maxLength: MAX_NAME } }}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add} disabled={!name.trim()}>Add</Button>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  );
}

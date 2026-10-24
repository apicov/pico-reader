import { Drawer, List, ListItemButton, ListItemText, ListSubheader, Typography } from '@mui/material';
import type { TocItem } from './types';

export function TocDrawer({ open, onClose, title, items, current, onPick }: {
  open: boolean; onClose: () => void; title: string; items: TocItem[]; current: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <Drawer open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 320, maxWidth: '85vw' } } }}>
      <Typography variant="h6" sx={{ px: 2, pt: 'calc(env(safe-area-inset-top) + 16px)', pb: 1 }}>{title}</Typography>
      <List dense>
        {items.length === 0 && <ListSubheader disableSticky>This book has no table of contents.</ListSubheader>}
        {items.map((item) => item.header ? (
          <ListSubheader key={item.id} disableSticky sx={{ bgcolor: 'transparent' }}>{item.label}</ListSubheader>
        ) : (
          <ListItemButton key={item.id} selected={item.id === current} sx={{ pl: 2 + item.depth * 2 }}
            onClick={() => { onPick(item.id); onClose(); }}>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}

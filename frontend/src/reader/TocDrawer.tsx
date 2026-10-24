import { Drawer, List, ListItemButton, ListItemText, ListSubheader, Typography } from '@mui/material';
import type { ReflowChapter } from './reflow/bundle';

export function TocDrawer({ open, onClose, title, chapters, current, onPick }: {
  open: boolean; onClose: () => void; title: string; chapters: ReflowChapter[]; current: number;
  onPick: (index: number) => void;
}) {
  let lastPart = '';
  return (
    <Drawer open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 320, maxWidth: '85vw' } } }}>
      <Typography variant="h6" sx={{ px: 2, pt: 'calc(env(safe-area-inset-top) + 16px)', pb: 1 }}>{title}</Typography>
      <List dense>
        {chapters.map((c, i) => {
          const header = c.part && c.part !== lastPart ? c.part : null;
          lastPart = c.part;
          return [
            header && <ListSubheader key={`p${i}`} disableSticky sx={{ bgcolor: 'transparent' }}>{header}</ListSubheader>,
            <ListItemButton key={c.file} selected={i === current} onClick={() => { onPick(i); onClose(); }}>
              <ListItemText primary={c.title} />
            </ListItemButton>,
          ];
        })}
      </List>
    </Drawer>
  );
}

import { ListItemText, Menu, MenuItem } from '@mui/material';
import type { BookFormat } from '@/services/types';
import { FORMATS } from './formats';

/** The book's formats to switch between, each with what it's like */
export function FormatMenu({ anchor, formats, current, onPick, onClose }: {
  anchor: HTMLElement | null; formats: BookFormat[]; current: BookFormat | null;
  onPick: (format: BookFormat) => void; onClose: () => void;
}) {
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose}>
      {formats.map((f) => (
        <MenuItem key={f} selected={f === current} onClick={() => { onClose(); onPick(f); }}>
          <ListItemText primary={FORMATS[f].label} secondary={FORMATS[f].description} />
        </MenuItem>
      ))}
    </Menu>
  );
}

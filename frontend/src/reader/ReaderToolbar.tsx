import { Button, IconButton, Toolbar, Typography } from '@mui/material';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TocIcon from '@mui/icons-material/Toc';

/** The book's own bar: thumb-sized buttons, bigger and further apart on a tablet. Bookmark and contents only once
 *  the book is open (`ready`). */
export function ReaderToolbar({ title, formatLabel, onFormats, ready, bookmarked, canBookmark, onBookmark, onContents,
  onSettings }: {
  title: string | undefined;
  /** the open format's name, with a button to switch; undefined when the book has only one */
  formatLabel?: string;
  onFormats: (anchor: HTMLElement) => void;
  ready: boolean;
  bookmarked: boolean;
  canBookmark: boolean;
  onBookmark: () => void;
  onContents: () => void;
  onSettings: (anchor: HTMLElement) => void;
}) {
  return (
    <Toolbar variant="dense" sx={{ minHeight: { xs: 48, sm: 60 }, gap: { xs: 0.5, sm: 2.5 }, borderTop: 1, borderColor: 'divider',
      '& .MuiIconButton-root': { p: { xs: 1.25, sm: 1.75 } }, '& .MuiSvgIcon-root': { fontSize: { xs: 24, sm: 34 } } }}>
      <Typography noWrap sx={{ flex: 1, mx: 1, fontSize: { xs: 15, sm: 20 } }}>{title}</Typography>
      {formatLabel !== undefined && (
        <Button color="inherit" startIcon={<SwapHorizIcon />} aria-label="Switch format"
          sx={{ minHeight: 44, px: { xs: 1, sm: 2 }, fontSize: { xs: 14, sm: 16 } }}
          onClick={(e) => onFormats(e.currentTarget)}>{formatLabel}</Button>
      )}
      {ready && (
        <IconButton aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this place'} onClick={onBookmark} disabled={!canBookmark}>
          {bookmarked ? <BookmarkIcon /> : <BookmarkBorderIcon />}
        </IconButton>
      )}
      {ready && <IconButton aria-label="Contents" onClick={onContents}><TocIcon /></IconButton>}
      <IconButton edge="end" aria-label="Text settings" onClick={(e) => onSettings(e.currentTarget)}>
        <FormatSizeIcon />
      </IconButton>
    </Toolbar>
  );
}

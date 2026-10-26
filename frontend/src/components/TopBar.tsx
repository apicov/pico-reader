import { IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readingNow } from '@/reader/readingNow';
import { READING_FONT } from '@/theme/readingThemes';
import { ToolLinks } from './ToolLinks';

/** The app's bar, the same at the top of every page (Library and the tools); a page's own bar goes under it.
 *  `bookId`: in the book (a chat started from it asks about it). On the other pages, the open book is one tap away. */
export function TopBar({ bookId }: { bookId?: string }) {
  const online = useOnlineStatus();
  const open = bookId ? null : readingNow();
  return (
    // on a tablet: bigger icons, further apart (a phone has no room to spare for seven of them)
    <Toolbar sx={{ minHeight: { sm: 72 }, gap: { xs: 0, sm: 1.5 }, px: { xs: 1.5, sm: 3 },
      '& .MuiIconButton-root': { p: { xs: 0.75, sm: 1.5 } }, '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: { sm: 32 } } }}>
      <Typography component={RouterLink} to="/" variant="h6"
        sx={{ flexGrow: 1, fontFamily: READING_FONT, fontSize: { sm: 24 }, color: 'inherit', textDecoration: 'none' }}>
        Library
      </Typography>
      {!online && (
        <Tooltip title="Offline: downloaded books still open">
          <CloudOffOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />
        </Tooltip>
      )}
      {open && (
        <Tooltip title={`Back to the book: ${open.title}`}>
          <IconButton component={RouterLink} to={`/read/${encodeURIComponent(open.id)}`} aria-label="Back to the book"
            color="primary">
            <MenuBookOutlinedIcon />
          </IconButton>
        </Tooltip>
      )}
      <ToolLinks bookId={bookId} />
    </Toolbar>
  );
}


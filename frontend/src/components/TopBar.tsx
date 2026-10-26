import { Box, Button, Toolbar, Tooltip, Typography } from '@mui/material';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readingNow } from '@/reader/readingNow';
import { READING_FONT } from '@/theme/readingThemes';
import { ToolLinks } from './ToolLinks';

/** The app's bar, the same at the top of every page (Library and the tools); a page's own bar goes under it.
 *  `bookId`: the book open now (a chat started from it asks about it). */
export function TopBar({ bookId }: { bookId?: string }) {
  const online = useOnlineStatus();
  return (
    // on a tablet: bigger icons, further apart (a phone has no room to spare for seven of them)
    <Toolbar sx={{ minHeight: { sm: 72 }, gap: { xs: 0, sm: 1.5 },
      '& .MuiIconButton-root': { p: { sm: 1.5 } }, '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: { sm: 32 } } }}>
      <Typography component={RouterLink} to="/" variant="h6"
        sx={{ flexGrow: 1, fontFamily: READING_FONT, fontSize: { sm: 24 }, color: 'inherit', textDecoration: 'none' }}>
        Library
      </Typography>
      {!online && (
        <Tooltip title="Offline: downloaded books still open">
          <CloudOffOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />
        </Tooltip>
      )}
      <ToolLinks bookId={bookId} />
    </Toolbar>
  );
}

/** "Continue reading: …" under the top bar, back to the book left last (this session) at its place */
export function ContinueReading() {
  const reading = readingNow();
  if (!reading) return null;
  return (
    <Button component={RouterLink} to={`/read/${encodeURIComponent(reading.id)}`} color="inherit" size="small"
      startIcon={<MenuBookOutlinedIcon />}
      sx={{ justifyContent: 'flex-start', px: { xs: 2, sm: 3 }, py: 0.75, borderRadius: 0, borderTop: 1,
        borderColor: 'divider', fontSize: { xs: 14, sm: 16 }, textTransform: 'none' }}>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Continue reading: {reading.title}
      </Box>
    </Button>
  );
}

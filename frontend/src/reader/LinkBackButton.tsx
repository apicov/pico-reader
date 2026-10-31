import { Button, type SxProps, type Theme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/** After following a link in the book: back to where it was. `sx` places it (over the pages, or at the bottom
 *  of a scrolling text). */
export function LinkBackButton({ onClick, sx }: { onClick: () => void; sx?: SxProps<Theme> }) {
  return (
    <Button variant="contained" size="small" startIcon={<ArrowBackIcon />} onClick={onClick}
      sx={[{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      Back
    </Button>
  );
}

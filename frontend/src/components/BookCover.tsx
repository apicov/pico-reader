import { Box, Typography } from '@mui/material';
import type { Book } from '@/services/types';
import { READING_FONT } from '@/theme/readingThemes';

/** The cover image, or a plain typeset card when there is none (or it can't load offline). */
export function BookCover({ book, src }: { book: Book; src?: string }) {
  return (
    <Box sx={{ aspectRatio: '2 / 3', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider',
      bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', justifyContent: 'center', p: src ? 0 : 1.5 }}>
      {src ? (
        <Box component="img" src={src} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <>
          <Typography sx={{ fontFamily: READING_FONT, fontSize: 15, lineHeight: 1.25, textAlign: 'center' }}>{book.title}</Typography>
          {book.author && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mt: 1 }}>{book.author}</Typography>
          )}
        </>
      )}
    </Box>
  );
}

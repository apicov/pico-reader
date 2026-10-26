import { lazy, Suspense, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { matchPath, useLocation } from 'react-router-dom';

// The readers (pdf.js, foliate, KaTeX) load only when a book is opened
const ReaderPage = lazy(() => import('@/pages/ReaderPage'));

/** The open book stays open while the other pages are shown: hidden, at its full size (nothing is laid out again),
 *  so going back to it is instant, at the same place. Opening another book replaces it. */
export function ReaderHost() {
  const location = useLocation();
  const shown = matchPath('/read/:bookId', location.pathname)?.params.bookId;
  const [kept, setKept] = useState<string | null>(null);
  useEffect(() => { if (shown) setKept(shown); }, [shown]);
  const bookId = shown ?? kept;
  if (!bookId) return null;
  const active = !!shown;
  return (
    <Box aria-hidden={!active} inert={!active}
      sx={active ? undefined : { position: 'fixed', inset: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}>
      <Suspense fallback={null}>
        <ReaderPage key={bookId} bookId={bookId} active={active} />
      </Suspense>
    </Box>
  );
}

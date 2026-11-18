import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { readerPath } from '@/reader/jump';
import { nextLoaded } from '@/reader/loadedBooks';
import { currentWorkspace, frontBook, readerWasOpen, setReaderOpen, useWorkspaces } from '@/services/workspaces';

// The readers (pdf.js, foliate, KaTeX) load only when a book is opened
const ReaderPage = lazy(() => import('@/pages/ReaderPage'));

/** The open books stay open while the other pages are shown, and while another tab of the workspace is: hidden, at
 *  their full size (nothing is laid out again), so going back to one is instant, at the same place. */
export function ReaderHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = matchPath('/read/:bookId', location.pathname)?.params.bookId;
  const { current } = useWorkspaces();
  const [loaded, setLoaded] = useState<string[]>([]);
  const recent = useRef<string[]>([]);
  useEffect(() => {
    if (!shown) return;
    setLoaded((l) => nextLoaded(l, recent.current, shown));
    recent.current = [shown, ...recent.current.filter((id) => id !== shown)];
  }, [shown]);
  // another workspace (or a tab closed): its books are let go
  const books = current?.book_ids.join('\n');
  useEffect(() => {
    if (current) setLoaded((l) => l.filter((id) => id === shown || current.book_ids.includes(id)));
  }, [books]); // eslint-disable-line react-hooks/exhaustive-deps

  // At start, left in a book last time: open again in it (the workspace's book in front)
  const [started, setStarted] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        if (location.pathname !== '/' || !(await readerWasOpen())) return;
        const front = await frontBook(await currentWorkspace());
        if (front) navigate(readerPath(front), { replace: true });
      } finally {
        setStarted(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (started) void setReaderOpen(!!shown); }, [shown, started]);

  const list = shown && !loaded.includes(shown) ? [...loaded, shown] : loaded;
  return (
    <>
      {list.map((id) => {
        const active = id === shown;
        return (
          <Box key={id} aria-hidden={!active} inert={!active}
            sx={active ? undefined : { position: 'fixed', inset: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}>
            <Suspense fallback={null}>
              <ReaderPage bookId={id} active={active} />
            </Suspense>
          </Box>
        );
      })}
    </>
  );
}

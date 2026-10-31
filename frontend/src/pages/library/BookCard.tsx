import { useEffect, useState } from 'react';
import { Box, Card, CardActionArea, Chip, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import DownloadDoneIcon from '@mui/icons-material/DownloadDone';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useNavigate } from 'react-router-dom';
import { BookCover } from '@/components/BookCover';
import { BookCategoryDialog } from '@/components/categories';
import { BookCollections } from '@/components/collections';
import { useCoverUrl } from '@/hooks/useCoverUrl';
import { formatLabel } from '@/reader/formats';
import { readerPath } from '@/reader/jump';
import { localPosition } from '@/reader/position';
import { api } from '@/services/api';
import type { CachedFile } from '@/services/bookCache';
import type { RatingSummary } from '@/services/community';
import { languageName } from '@/services/languages';
import { setOnMyShelf, setShelfStatus, type Collection, type ShelfEntry, type ShelfStatus } from '@/services/shelf';
import type { Book } from '@/services/types';

export interface IndexJob { book_id: string; status: 'queued' | 'running' | 'failed'; position?: number; error: string }

/** A book in the library grid: cover, reading status, download state, its menu (shelf, collections, category) */
export function BookCard({ book, files, online, shelf, mine, collections, badge, job, rating, category, canDelete, onDeleted, onChanged }: {
  book: Book; files: Record<string, CachedFile>; online: boolean; shelf?: ShelfEntry;
  /** on My shelf; `badge`: show the reading status on the cover (where the tab doesn't already say it) */
  mine: boolean; collections: Collection[]; badge: boolean; job?: IndexJob; rating?: RatingSummary; category?: string; canDelete: boolean; onDeleted: () => void; onChanged: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const choose = (status: ShelfStatus) => { setMenu(null); void setShelfStatus(book.id, status); };
  const navigate = useNavigate();
  const cover = useCoverUrl(book, files[`${book.id}/cover`], online);
  const [progress, setProgress] = useState(0);
  useEffect(() => { void localPosition(book.id).then((p) => setProgress(p?.progress ?? 0)); }, [book.id]);
  const downloaded = Object.keys(book.formats).some((k) => files[`${book.id}/${k}`]);
  // Offline, only downloaded books open
  const available = online || downloaded;
  return (
    <Card sx={{ border: 0, bgcolor: 'transparent', opacity: available ? 1 : 0.45, position: 'relative', overflow: 'visible' }}>
      <CardActionArea disabled={!available} onClick={() => navigate(readerPath(book.id))} sx={{ p: 0.5, borderRadius: 1 }}>
        <Box sx={{ position: 'relative' }}>
          <BookCover book={book} src={cover} />
          {badge && (shelf?.status === 'reading' || shelf?.status === 'finished') && (
            <Chip size="small" color={shelf.status === 'finished' ? 'success' : 'primary'}
              label={shelf.status === 'finished' ? 'Finished ✓' : `Reading · ${Math.max(1, Math.round(progress * 100))}%`}
              sx={{ position: 'absolute', left: 6, top: 6, height: 20, fontSize: 11, maxWidth: 'calc(100% - 48px)' }} />
          )}
          {progress > 0 && (
            <Box sx={{ position: 'absolute', left: 4, right: 4, bottom: 2, height: 3, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 2, bgcolor: 'primary.main' }} />
            </Box>
          )}
          {(downloaded || !available) && (
            <Box sx={{ position: 'absolute', right: 6, bottom: 6, bgcolor: 'background.paper', borderRadius: '50%',
              width: 26, height: 26, display: 'grid', placeItems: 'center', border: 1, borderColor: 'divider' }}
              title={downloaded ? 'On this device' : 'Not downloaded'}>
              {downloaded ? <DownloadDoneIcon sx={{ fontSize: 16 }} /> : <CloudOffOutlinedIcon sx={{ fontSize: 16 }} />}
            </Box>
          )}
        </Box>
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 500, lineHeight: 1.3 }} noWrap title={book.title}>
          {mine && <BookmarkIcon color="primary" titleAccess="On My shelf" sx={{ fontSize: 14, mr: 0.25, verticalAlign: '-2px' }} />}
          {book.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">{book.author || '\u00a0'}</Typography>
        {category && <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ fontStyle: 'italic' }}>{category}</Typography>}
        {rating && rating.review_count > 0 && (
          <Typography variant="caption" color="text.secondary" component="div"
            title={`${rating.review_count} review${rating.review_count === 1 ? '' : 's'}`}>
            ★ {rating.avg_score}/10 · {rating.review_count}
          </Typography>
        )}
        {job && (
          <Typography variant="caption" color={job.status === 'failed' ? 'error' : 'text.secondary'} component="div"
            title={job.error || undefined}>
            {job.status === 'queued' ? `Queued for search (${job.position})` : job.status === 'running' ? 'Making it searchable…' : 'Search index failed'}
          </Typography>
        )}
        {!badge && shelf?.status === 'reading' && progress > 0 && (
          <Typography variant="caption" color="text.secondary" component="div">{Math.max(1, Math.round(progress * 100))}% read</Typography>
        )}
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={languageName(book.language)} />
          {Object.keys(book.formats).map((f) => <Chip key={f} size="small" variant="outlined" label={formatLabel(f)} />)}
        </Stack>
      </CardActionArea>
      <IconButton size="small" aria-label={`${book.title}: shelf`} onClick={(e) => setMenu(e.currentTarget)}
        sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
          '&:hover': { bgcolor: 'background.paper' } }}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem disabled={!online} onClick={() => { setMenu(null); navigate(`/book/${encodeURIComponent(book.id)}`); }}>
          Reviews & discussion
        </MenuItem>
        {canDelete && <MenuItem disabled={!online} onClick={() => { setMenu(null); setCategoryOpen(true); }}>Category…</MenuItem>}
        <MenuItem onClick={() => { setMenu(null); setCollectionsOpen(true); }}>Collections…</MenuItem>
        <MenuItem onClick={() => { setMenu(null); void setOnMyShelf(book.id, !mine); }}>
          {mine ? 'Remove from My shelf' : 'Add to My shelf'}
        </MenuItem>
        {shelf?.status !== 'reading' && <MenuItem onClick={() => choose('reading')}>{shelf?.status === 'finished' ? 'Read again' : 'Add to Currently reading'}</MenuItem>}
        {shelf?.status !== 'finished' && <MenuItem onClick={() => choose('finished')}>Mark as finished</MenuItem>}
        {shelf && shelf.status !== 'removed' && <MenuItem onClick={() => choose('removed')}>Remove from my lists</MenuItem>}
        {canDelete && (
          <MenuItem disabled={!online} sx={{ color: 'error.main' }} onClick={() => {
            setMenu(null);
            if (window.confirm(`Delete “${book.title}” from the library for everyone? Its files are removed.`)) {
              void api(`/api/books/${encodeURIComponent(book.id)}`, { method: 'DELETE' }).then(onDeleted)
                .catch((e) => window.alert((e as Error).message));
            }
          }}>Delete book…</MenuItem>
        )}
      </Menu>
      {collectionsOpen && <BookCollections bookId={book.id} title={book.title} collections={collections} open
        onClose={() => setCollectionsOpen(false)} />}
      {canDelete && <BookCategoryDialog book={book} open={categoryOpen} onClose={() => setCategoryOpen(false)} onSaved={onChanged} />}
    </Card>
  );
}

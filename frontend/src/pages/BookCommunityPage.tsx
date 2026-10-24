import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, Divider, FormControlLabel, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate, useParams } from 'react-router-dom';
import { BookCover } from '@/components/BookCover';
import { Markdown } from '@/components/Markdown';
import { AuthorLine, Loading, LikeButton, NeedsConnection, PostCard, ScoreBadge, ScorePicker, Spoiler } from '@/components/community/parts';
import { useAuth } from '@/contexts/AuthContext';
import { useBookCache } from '@/hooks/useBookCache';
import { useCoverUrl } from '@/hooks/useCoverUrl';
import { useLibrary } from '@/hooks/useLibrary';
import { useLoad } from '@/hooks/useLoad';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { bookCommunity, deleteReview, saveReview, setHidden, type Review } from '@/services/community';
import type { Book } from '@/services/types';

function Cover({ book }: { book: Book }) {
  const online = useOnlineStatus();
  const files = useBookCache();
  const src = useCoverUrl(book, files[`${book.id}/cover`], online);
  return <BookCover book={book} src={src} />;
}

function ReviewForm({ bookId, mine, onSaved }: { bookId: string; mine: Review | null; onSaved: () => void }) {
  const [score, setScore] = useState<number | null>(mine?.score ?? null);
  const [recommend, setRecommend] = useState(mine?.recommend ?? false);
  const [body, setBody] = useState(mine?.body ?? '');
  const [spoiler, setSpoiler] = useState(mine?.spoiler ?? false);
  const [editing, setEditing] = useState(!mine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setEditing(!mine); }, [mine]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (mine && !editing) {
    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ flex: 1 }}>Your review:</Typography>
        <ScoreBadge score={mine.score} recommend={mine.recommend} size="small" />
        <Button size="small" onClick={() => setEditing(true)}>Edit</Button>
      </Stack>
    );
  }
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{mine ? 'Your review' : 'Rate this book'}</Typography>
      <ScorePicker value={score} onChange={setScore} />
      <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap' }}>
        <FormControlLabel control={<Switch checked={recommend} onChange={(e) => setRecommend(e.target.checked)} />} label="I recommend it" />
        <FormControlLabel control={<Switch checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />} label="Contains spoilers" />
      </Stack>
      <TextField value={body} onChange={(e) => setBody(e.target.value)} label="Your impressions (optional)" multiline minRows={3}
        fullWidth sx={{ mt: 1 }} inputProps={{ maxLength: 20000 }} />
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button variant="contained" disabled={busy || score === null}
          onClick={() => void run(() => saveReview(bookId, { score: score!, recommend, body, spoiler }))}>Save review</Button>
        {mine && <Button color="inherit" onClick={() => setEditing(false)}>Cancel</Button>}
        <Box sx={{ flex: 1 }} />
        {mine && <Button color="error" disabled={busy} onClick={() => {
          if (window.confirm('Delete your review?')) void run(() => deleteReview(bookId));
        }}>Delete</Button>}
      </Stack>
    </Card>
  );
}

export function ReviewItem({ review, showBook, onChanged }: { review: Review; showBook?: boolean; onChanged?: () => void }) {
  const { reader } = useAuth();
  const navigate = useNavigate();
  return (
    <Box sx={{ py: 1.5, opacity: review.hidden ? 0.5 : 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}><AuthorLine author={review.author} when={review.updated_at} /></Box>
        <ScoreBadge score={review.score} recommend={review.recommend} size="small" />
      </Stack>
      {showBook && (
        <Button size="small" sx={{ mt: 0.5, textTransform: 'none' }} disabled={!review.book.available}
          onClick={() => navigate(`/book/${encodeURIComponent(review.book.id)}`)}>
          {review.book.title || 'A deleted book'}
        </Button>
      )}
      {review.body && (
        <Box sx={{ mt: 0.5, pl: { xs: 0, sm: 4.5 } }}>
          <Spoiler on={review.spoiler}><Markdown text={review.body} sx={{ fontSize: 15 }} /></Spoiler>
        </Box>
      )}
      <Stack direction="row" alignItems="center" sx={{ pl: { xs: 0, sm: 3.5 } }}>
        <LikeButton kind="review" id={review.id} likes={review.likes} liked={review.liked_by_me} />
        {reader?.is_admin && onChanged && (
          <Button size="small" color="inherit" sx={{ color: 'text.secondary' }}
            onClick={() => void setHidden('review', review.id, !review.hidden).then(onChanged)}>
            {review.hidden ? 'Show again' : 'Hide'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function BookView({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const { library } = useLibrary();
  const book = library?.books.find((b) => b.id === bookId);
  const { data, error, reload } = useLoad(() => bookCommunity(bookId), [bookId]);
  if (!data) return <Loading error={error} retry={() => void reload()} />;
  const { summary } = data;
  const others = data.reviews.filter((r) => !r.mine);
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)} sx={{ mb: 1 }}><ArrowBackIcon /></IconButton>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {book && <Box sx={{ width: 96, flexShrink: 0 }}><Cover book={book} /></Box>}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ lineHeight: 1.25 }}>{data.book.title || 'No longer in the library'}</Typography>
          {data.book.author && <Typography color="text.secondary">{data.book.author}</Typography>}
          <Typography variant="body2" sx={{ mt: 1 }}>
            {summary.review_count
              ? <><b>{summary.avg_score}</b>/10 from {summary.review_count} review{summary.review_count === 1 ? '' : 's'}
                {summary.recommend_count > 0 && ` · ${summary.recommend_count} recommend${summary.recommend_count === 1 ? 's' : ''} it`}</>
              : 'No reviews yet'}
          </Typography>
          {data.book.available && (
            <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={() => navigate(`/read/${encodeURIComponent(bookId)}`)}>Open</Button>
          )}
        </Box>
      </Stack>
      {data.book.available && <ReviewForm bookId={bookId} mine={data.my_review} onSaved={() => void reload()} />}
      {others.length > 0 && (
        <>
          <Typography variant="subtitle1" sx={{ mt: 3, fontWeight: 600 }}>Reviews</Typography>
          {others.map((r, i) => (
            <Box key={r.id}>{i > 0 && <Divider />}<ReviewItem review={r} onChanged={() => void reload()} /></Box>
          ))}
        </>
      )}
      <Stack direction="row" alignItems="center" sx={{ mt: 3, mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>Discussions</Typography>
        <Button size="small" startIcon={<AddIcon />} disabled={!data.book.available}
          onClick={() => navigate('/community/new', { state: { bookIds: [bookId] } })}>New post</Button>
      </Stack>
      {data.posts.length === 0
        ? <Typography variant="body2" color="text.secondary">Nobody has posted about this book yet.</Typography>
        : <Stack spacing={1.5}>{data.posts.map((p) => <PostCard key={p.id} post={p} />)}</Stack>}
    </Box>
  );
}

export default function BookCommunityPage() {
  const { bookId } = useParams();
  return <NeedsConnection>{bookId && <BookView bookId={bookId} />}</NeedsConnection>;
}

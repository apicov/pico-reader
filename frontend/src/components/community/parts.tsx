/** The pieces community pages are made of: who wrote it, likes, scores, quotes, spoilers, a Markdown editor. */
import { useState, type ReactNode } from 'react';
import { Alert, Avatar, Box, Button, Card, CardActionArea, Chip, IconButton, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ago, avatarSrc, quoteLink, setLike, type Author, type BookStub, type LikeKind, type PostSummary, type Quote } from '@/services/community';
import { READING_FONT } from '@/theme/readingThemes';

export function MemberAvatar({ author, size = 32 }: { author: Author; size?: number }) {
  return (
    <Avatar src={avatarSrc(author)} alt="" sx={{ width: size, height: size, fontSize: size * 0.45, bgcolor: 'primary.main' }}>
      {(author.display_name || author.handle).slice(0, 1).toUpperCase()}
    </Avatar>
  );
}

/** Avatar, name and when; the name opens the profile. */
export function AuthorLine({ author, when, extra }: { author: Author | null; when?: string; extra?: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      {author ? <MemberAvatar author={author} size={28} /> : <Avatar sx={{ width: 28, height: 28 }} />}
      <Box sx={{ minWidth: 0 }}>
        {author ? (
          <Typography component={RouterLink} to={`/u/${author.handle}`} variant="body2"
            sx={{ fontWeight: 600, color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            {author.display_name || author.handle}
          </Typography>
        ) : <Typography variant="body2" color="text.secondary">—</Typography>}
        {when && <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{ago(when)}</Typography>}
        {extra}
      </Box>
    </Stack>
  );
}

/** Optimistic: shows the change at once, puts it back if the server says no. */
export function LikeButton({ kind, id, likes, liked }: { kind: LikeKind; id: string; likes: number; liked: boolean }) {
  const [state, setState] = useState({ likes, liked });
  const online = useOnlineStatus();
  const toggle = () => {
    const before = state;
    const on = !state.liked;
    setState({ liked: on, likes: state.likes + (on ? 1 : -1) });
    setLike(kind, id, on).catch(() => setState(before));
  };
  return (
    <Button size="small" color={state.liked ? 'error' : 'inherit'} disabled={!online} onClick={toggle}
      aria-label={state.liked ? 'Unlike' : 'Like'} aria-pressed={state.liked}
      startIcon={state.liked ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
      sx={{ minWidth: 0, color: state.liked ? undefined : 'text.secondary' }}>
      {state.likes || ''}
    </Button>
  );
}

export function ScoreBadge({ score, recommend, size = 'medium' }: { score: number; recommend?: boolean; size?: 'small' | 'medium' }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" component="span">
      <Box component="span" sx={{ fontWeight: 700, fontSize: size === 'small' ? 13 : 16, px: 0.75, py: 0.1, borderRadius: 1,
        border: 1, borderColor: 'divider', fontVariantNumeric: 'tabular-nums' }} aria-label={`${score} out of 10`}>
        {score}<Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: '0.8em' }}>/10</Box>
      </Box>
      {recommend && <Chip size="small" icon={<ThumbUpAltOutlinedIcon />} label="Recommends" variant="outlined" />}
    </Stack>
  );
}

/** 0–10 as a row of buttons: easier to hit on a phone than a slider. */
export function ScorePicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <Box role="radiogroup" aria-label="Score" sx={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 0.5 }}>
      {Array.from({ length: 11 }, (_, n) => (
        <Button key={n} role="radio" aria-checked={value === n} size="small" variant={value === n ? 'contained' : 'outlined'}
          onClick={() => onChange(n)} sx={{ minWidth: 0, px: 0, py: 0.75, fontVariantNumeric: 'tabular-nums' }}>{n}</Button>
      ))}
    </Box>
  );
}

/** Text that hides a plot twist until tapped. */
export function Spoiler({ on, children }: { on: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (!on || shown) return <>{children}</>;
  return (
    <Box onClick={() => setShown(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setShown(true)}
      sx={{ position: 'relative', cursor: 'pointer' }}>
      <Box sx={{ filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }} aria-hidden>{children}</Box>
      <Chip label="Spoiler: tap to show" size="small" sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
    </Box>
  );
}

export function BookLink({ book }: { book: BookStub }) {
  if (!book.available) return <Chip size="small" variant="outlined" label="No longer in the library" />;
  return (
    <Chip size="small" variant="outlined" icon={<MenuBookOutlinedIcon />} label={book.title} clickable
      component={RouterLink} to={`/book/${encodeURIComponent(book.id)}`} sx={{ maxWidth: '100%' }} />
  );
}

/** A passage from a book; "Open here" jumps into the reader at that place. */
export function QuoteCard({ quote, onRemove }: { quote: Quote; onRemove?: () => void }) {
  const navigate = useNavigate();
  return (
    <Box sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 1.5, py: 0.5, my: 1.5 }}>
      <Typography sx={{ fontFamily: READING_FONT, fontSize: 16, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        “{quote.text}”
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {quote.book.title || 'A deleted book'} · {Math.round(quote.progress * 100)}%
        </Typography>
        {quote.book.available && !onRemove && (
          <Button size="small" onClick={() => navigate(quoteLink(quote))}>Open here</Button>
        )}
        {onRemove && <Button size="small" color="inherit" onClick={onRemove}>Remove</Button>}
      </Stack>
    </Box>
  );
}

export function PostCard({ post }: { post: PostSummary }) {
  const navigate = useNavigate();
  return (
    <Card variant="outlined" sx={{ opacity: post.hidden ? 0.5 : 1 }}>
      <CardActionArea onClick={() => navigate(`/community/post/${post.id}`)} sx={{ p: 2 }}>
        <AuthorLine author={post.author} when={post.created_at} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1, lineHeight: 1.3 }}>
          {post.title}{post.hidden && ' (hidden)'}
        </Typography>
        {post.body && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {post.body.replace(/\|\|[^|\n]+\|\|/g, '▒▒▒')}
          </Typography>
        )}
      </CardActionArea>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.5, pb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
        {post.books.map((b) => <BookLink key={b.id} book={b} />)}
        <Box sx={{ flex: 1 }} />
        <LikeButton kind="post" id={post.id} likes={post.likes} liked={post.liked_by_me} />
        <Button size="small" color="inherit" startIcon={<ChatBubbleOutlineIcon fontSize="small" />}
          onClick={() => navigate(`/community/post/${post.id}`)} sx={{ color: 'text.secondary', minWidth: 0 }}>
          {post.comment_count || ''}
        </Button>
      </Stack>
    </Card>
  );
}

/** Write / Preview, with the spoiler syntax explained. */
export function MarkdownEditor({ value, onChange, label, minRows = 5, placeholder }: {
  value: string; onChange: (v: string) => void; label: string; minRows?: number; placeholder?: string;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0 } }}>
        <Tab value="write" label="Write" />
        <Tab value="preview" label="Preview" />
      </Tabs>
      {tab === 'write' ? (
        <TextField value={value} onChange={(e) => onChange(e.target.value)} label={label} placeholder={placeholder}
          multiline minRows={minRows} fullWidth sx={{ mt: 1 }}
          helperText="Markdown: **bold**, *italic*, > quote, - list. Hide a spoiler with ||like this||." />
      ) : (
        <Box sx={{ mt: 1, p: 1.5, minHeight: 120, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {value.trim() ? <Markdown text={value} /> : <Typography color="text.secondary">Nothing to preview</Typography>}
        </Box>
      )}
    </Box>
  );
}

/** Community pages need the server. */
export function NeedsConnection({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  if (!online) return <Alert severity="info">The community needs a connection. Your downloaded books still open.</Alert>;
  return <>{children}</>;
}

export function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  if (error) return <Alert severity="error" action={retry && <Button color="inherit" onClick={retry}>Retry</Button>}>{error}</Alert>;
  return <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading…</Typography>;
}

export function IconAction({ label, onClick, children, color }: {
  label: string; onClick: () => void; children: ReactNode; color?: 'error' | 'inherit';
}) {
  return <IconButton size="small" aria-label={label} title={label} onClick={onClick} color={color}>{children}</IconButton>;
}

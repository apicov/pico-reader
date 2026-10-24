import { useState } from 'react';
import { Box, Button, Card, CardActionArea, Chip, Divider, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { BookLink, Loading, MemberAvatar, NeedsConnection, PostCard } from '@/components/community/parts';
import { useLoad } from '@/hooks/useLoad';
import { getProfile, type TopList } from '@/services/community';
import { ReviewItem } from './BookCommunityPage';

export function ListCard({ list }: { list: TopList }) {
  const navigate = useNavigate();
  return (
    <Card variant="outlined" sx={{ opacity: list.hidden ? 0.5 : 1 }}>
      <CardActionArea sx={{ p: 2 }} onClick={() => navigate(`/lists/${list.id}`)}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{list.title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {list.items.length} book{list.items.length === 1 ? '' : 's'}
          {list.items.length > 0 && `: ${list.items.slice(0, 3).map((i) => i.book.title || '—').join(', ')}${list.items.length > 3 ? '…' : ''}`}
        </Typography>
      </CardActionArea>
    </Card>
  );
}

type TabName = 'reviews' | 'posts' | 'lists';

function ProfileView({ handle }: { handle: string }) {
  const navigate = useNavigate();
  const { data: p, error, reload } = useLoad(() => getProfile(handle), [handle]);
  const [tab, setTab] = useState<TabName>('reviews');
  if (!p) return <Loading error={error} retry={() => void reload()} />;
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)} sx={{ mb: 1 }}><ArrowBackIcon /></IconButton>
      <Stack direction="row" spacing={2} alignItems="center">
        <MemberAvatar author={p} size={72} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>{p.display_name || p.handle}</Typography>
          <Typography variant="body2" color="text.secondary">@{p.handle} · {p.finished_count} finished</Typography>
        </Box>
        {p.mine && <Button size="small" component={RouterLink} to="/profile">Edit</Button>}
      </Stack>
      {p.bio && <Typography sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>{p.bio}</Typography>}
      {p.reading.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Reading now</Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {p.reading.map((b) => <BookLink key={b.id} book={b} />)}
          </Stack>
        </Box>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }} variant="fullWidth">
        <Tab value="reviews" label={`Reviews (${p.reviews.length})`} />
        <Tab value="posts" label={`Posts (${p.posts.length})`} />
        <Tab value="lists" label={`Lists (${p.lists.length})`} />
      </Tabs>
      <Box sx={{ mt: 1.5 }}>
        {tab === 'reviews' && (p.reviews.length === 0
          ? <Typography color="text.secondary">No reviews yet.</Typography>
          : p.reviews.map((r, i) => <Box key={r.id}>{i > 0 && <Divider />}<ReviewItem review={r} showBook onChanged={() => void reload()} /></Box>))}
        {tab === 'posts' && (p.posts.length === 0
          ? <Typography color="text.secondary">No posts yet.</Typography>
          : <Stack spacing={1.5}>{p.posts.map((x) => <PostCard key={x.id} post={x} />)}</Stack>)}
        {tab === 'lists' && (
          <Stack spacing={1.5}>
            {p.mine && (
              <Box><Button startIcon={<AddIcon />} onClick={() => navigate('/lists/new')}>New list</Button></Box>
            )}
            {p.lists.length === 0 && !p.mine && <Typography color="text.secondary">No lists yet.</Typography>}
            {p.lists.map((l) => <ListCard key={l.id} list={l} />)}
          </Stack>
        )}
      </Box>
      {p.mine && <Chip sx={{ mt: 3 }} size="small" variant="outlined" label="This is how other readers see you" />}
    </Box>
  );
}

export default function ProfilePage() {
  const { handle } = useParams();
  return <NeedsConnection>{handle && <ProfileView handle={handle} />}</NeedsConnection>;
}

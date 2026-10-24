import { useEffect, useState } from 'react';
import { Avatar, AvatarGroup, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { ProfileEditor } from '@/components/community/ProfileEditor';
import { Loading, NeedsConnection, PostCard } from '@/components/community/parts';
import { useLoad } from '@/hooks/useLoad';
import { avatarSrc, listPosts, members, myProfile, type MyProfile, type PostFilter, type PostSummary } from '@/services/community';
import { getPref, setPref } from '@/services/prefs';

type Filter = 'all' | 'my_books' | 'mine';
const PAGE = 30;

/** Everyone's posts, newest first. */
function Feed() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [me, setMe] = useState<MyProfile | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [more, setMore] = useState<PostSummary[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    void myProfile().then(async (p) => {
      setMe(p);
      // once: choose how others see you (the handle made from the email isn't nice)
      if (!p.chosen && !(await getPref<boolean>('community_welcomed'))) setWelcome(true);
    }).catch(() => undefined);
  }, []);
  const query = (before?: string): PostFilter => ({
    before, mine_books: filter === 'my_books', author: filter === 'mine' ? me?.handle : undefined });
  const { data: posts, error, reload } = useLoad(async () => {
    if (filter === 'mine' && !me) return [];
    setMore([]);
    const first = await listPosts(query());
    setDone(first.length < PAGE);
    return first;
  }, [filter, me?.handle]);
  const { data: people } = useLoad(members, []);
  const all = [...(posts ?? []), ...more];

  const loadMore = async () => {
    const next = await listPosts(query(all[all.length - 1]?.created_at));
    setMore([...more, ...next]);
    setDone(next.length < PAGE);
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Community</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/community/new')}>New post</Button>
      </Stack>
      {people && people.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
          <AvatarGroup max={8} sx={{ '& .MuiAvatar-root': { width: 32, height: 32, fontSize: 14 } }}>
            {people.map((p) => (
              <Avatar key={p.handle} component={RouterLink} to={`/u/${p.handle}`} title={p.display_name}
                src={avatarSrc(p)} alt="" sx={{ bgcolor: 'primary.main', textDecoration: 'none' }}>
                {(p.display_name || p.handle).slice(0, 1).toUpperCase()}
              </Avatar>
            ))}
          </AvatarGroup>
          <Typography variant="body2" color="text.secondary">{people.length} readers</Typography>
          <Box sx={{ flex: 1 }} />
          {me && <Button size="small" component={RouterLink} to={`/u/${me.handle}`}>Your profile</Button>}
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {([['all', 'All'], ['my_books', 'About my books'], ['mine', 'Mine']] as const).map(([v, label]) => (
          <Chip key={v} label={label} color={filter === v ? 'primary' : 'default'} variant={filter === v ? 'filled' : 'outlined'}
            onClick={() => setFilter(v)} />
        ))}
      </Stack>
      {!posts ? <Loading error={error} retry={() => void reload()} /> : all.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {filter === 'all' ? 'No posts yet. Start a discussion about a book, or anything else.'
            : filter === 'my_books' ? 'No posts about the books on your lists yet.' : "You haven't posted yet."}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {all.map((p) => <PostCard key={p.id} post={p} />)}
          {!done && <Button onClick={() => void loadMore()}>Older posts</Button>}
        </Stack>
      )}
      <Dialog open={welcome && !!me} fullWidth maxWidth="xs"
        onClose={() => { setWelcome(false); void setPref('community_welcomed', true); }}>
        <DialogTitle>How others see you</DialogTitle>
        <DialogContent>
          {me && <ProfileEditor profile={me} submitLabel="Done" onSaved={(p) => {
            setMe(p);
            setWelcome(false);
            void setPref('community_welcomed', true);
          }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function CommunityPage() {
  return <NeedsConnection><Feed /></NeedsConnection>;
}

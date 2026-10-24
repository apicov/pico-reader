import { Box, Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { ProfileEditor } from '@/components/community/ProfileEditor';
import { Loading, NeedsConnection } from '@/components/community/parts';
import { useLoad } from '@/hooks/useLoad';
import { myProfile } from '@/services/community';
import { setPref } from '@/services/prefs';

function Editor() {
  const navigate = useNavigate();
  const { data: me, error, reload } = useLoad(() => myProfile(true), []);
  if (!me) return <Loading error={error} retry={() => void reload()} />;
  return (
    <Box sx={{ maxWidth: 520, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Your profile</Typography>
        <Button size="small" component={RouterLink} to={`/u/${me.handle}`}>View</Button>
      </Stack>
      <ProfileEditor profile={me} onSaved={(p) => { void setPref('community_welcomed', true); navigate(`/u/${p.handle}`); }} />
    </Box>
  );
}

export default function MyProfilePage() {
  return <NeedsConnection><Editor /></NeedsConnection>;
}

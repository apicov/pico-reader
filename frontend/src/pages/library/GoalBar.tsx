import { useEffect, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cachedStats, getReadingGoal, getStats, type ReadingGoal } from '@/services/stats';
import { formatMinutes } from '@/utils/time';

/** Today's reading against the goal, when the goal is on */
export function GoalBar() {
  const online = useOnlineStatus();
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [today, setToday] = useState(0);
  useEffect(() => {
    void getReadingGoal().then(setGoal);
    void cachedStats('week').then((s) => s && setToday(s.today_seconds));
    if (online) void getStats('week').then((s) => setToday(s.today_seconds)).catch(() => undefined);
  }, [online]);
  if (!goal?.enabled) return null;
  const done = today >= goal.minutes * 60;
  return (
    <Box component={RouterLink} to="/stats" sx={{ display: 'block', mb: 2, color: 'inherit', textDecoration: 'none' }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">Today {formatMinutes(today)} of {goal.minutes} min{done ? ' ✓' : ''}</Typography>
        <Typography variant="body2" color="primary">Statistics</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(100, (today / (goal.minutes * 60)) * 100)} sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
    </Box>
  );
}

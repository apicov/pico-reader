import { useEffect, useState } from 'react';
import { Alert, Box, Chip, FormControlLabel, Slider, Stack, Switch, Typography } from '@mui/material';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getReadingGoal, saveReadingGoal, type ReadingGoal } from '@/services/stats';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The daily reading goal: off by default; on, with minutes and days. Kept on the server for every device. */
export function ReadingGoalSettings() {
  const online = useOnlineStatus();
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { void getReadingGoal().then(setGoal); }, []);

  const save = (next: ReadingGoal) => {
    setGoal(next);
    setError('');
    void saveReadingGoal(next).catch((e) => setError((e as Error).message));
  };

  if (!goal) return null;
  return (
    <Box>
      <Typography variant="h6">Reading goal</Typography>
      <FormControlLabel disabled={!online} label={goal.enabled ? `On: ${goal.minutes} min a day` : 'Off'}
        control={<Switch checked={goal.enabled} onChange={(e) => save({ ...goal, enabled: e.target.checked })} />} />
      {goal.enabled && (
        <Stack spacing={1} sx={{ mt: 1, maxWidth: 420 }}>
          <Typography variant="caption" color="text.secondary">Minutes a day</Typography>
          <Slider value={goal.minutes} min={5} max={120} step={5} valueLabelDisplay="auto" disabled={!online}
            marks={[{ value: 20, label: '20' }, { value: 60, label: '60' }, { value: 120, label: '120' }]}
            onChange={(_, v) => setGoal({ ...goal, minutes: v as number })}
            onChangeCommitted={(_, v) => save({ ...goal, minutes: v as number })} />
          <Typography variant="caption" color="text.secondary">On these days</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {DAYS.map((d, i) => {
              const on = goal.days.includes(i);
              return (
                <Chip key={d} label={d} size="small" variant={on ? 'filled' : 'outlined'} disabled={!online}
                  color={on ? 'primary' : 'default'}
                  onClick={() => save({ ...goal, days: on ? goal.days.filter((x) => x !== i) : [...goal.days, i].sort() })} />
              );
            })}
          </Stack>
        </Stack>
      )}
      {!online && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Changing the goal needs a connection.</Typography>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}

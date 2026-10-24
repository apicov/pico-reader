import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, LinearProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import { useNavigate } from 'react-router-dom';
import { BarChart, DataTable, GoalRing, Heatmap, LineChart } from '@/components/charts';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { languageName } from '@/services/languages';
import { cachedStats, formatMinutes, getStats, type Stats } from '@/services/stats';
import { READING_FONT } from '@/theme/readingThemes';

type Period = 'week' | 'month' | 'year' | 'all';

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function shortLabel(iso: string, bucket: 'day' | 'week'): string {
  const d = new Date(`${iso}T12:00:00`);
  return bucket === 'day' && d.getTime() > Date.now() - 8 * 86_400_000
    ? d.toLocaleDateString(undefined, { weekday: 'short' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
        {hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{hint}</Typography>}
        {children}
      </CardContent>
    </Card>
  );
}

/** Reading time, goal, streak, books, and how the language learning goes. */
export default function StatsPage() {
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError('');
    void cachedStats(period).then((c) => { if (c && !cancelled) setStats(c); });
    if (online) {
      void getStats(period).then((s) => { if (!cancelled) setStats(s); }).catch((e) => !cancelled && setError((e as Error).message));
    }
    return () => { cancelled = true; };
  }, [period, online]);

  const languages = useMemo(() => Object.keys(stats?.density ?? {}), [stats]);
  const lang = language && languages.includes(language) ? language : languages[0];

  if (!stats) {
    return error ? <Alert severity="warning">{error}</Alert> : <LinearProgress />;
  }
  const goal = stats.goal;
  const minutes = (s: number) => Math.round(s / 60);
  const bucketWord = stats.bucket === 'day' ? 'day' : 'week';
  const density = lang ? stats.density[lang] : null;

  return (
    <Stack spacing={2} sx={{ maxWidth: 820 }}>
      <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Reading</Typography>
        <ToggleButtonGroup exclusive size="small" value={period} onChange={(_, v: Period | null) => v && setPeriod(v)}>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
          <ToggleButton value="year">Year</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {!online && <Alert severity="info">Offline: these are the last statistics loaded.</Alert>}

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2.5} alignItems="center">
            {goal && (
              <GoalRing fraction={stats.today_seconds / (goal.minutes * 60)}>
                {minutes(stats.today_seconds)}/{goal.minutes}
              </GoalRing>
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary">Today</Typography>
              <Typography sx={{ fontSize: 34, fontFamily: READING_FONT, lineHeight: 1.1 }}>{formatMinutes(stats.today_seconds)}</Typography>
              {goal && (
                <Typography variant="body2" color="text.secondary">
                  {stats.today_seconds >= goal.minutes * 60 ? 'Goal reached ✓' : `${goal.minutes - minutes(stats.today_seconds)} min to your goal`}
                  {goal.days_due > 0 ? ` · goal met ${goal.days_met} of ${goal.days_due} days` : ''}
                </Typography>
              )}
            </Box>
            <Stack alignItems="center">
              <LocalFireDepartmentOutlinedIcon color={stats.streak.current ? 'primary' : 'disabled'} />
              <Typography sx={{ fontWeight: 600 }}>{stats.streak.current}</Typography>
              <Typography variant="caption" color="text.secondary">day streak</Typography>
              <Typography variant="caption" color="text.secondary">best {stats.streak.best}</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Review</Typography>
            <Typography variant="body2" color="text.secondary">
              {stats.review_due ? `${plural(stats.review_due, 'word')} due` : 'Nothing due'} · {plural(stats.known_words, 'word')} marked known
            </Typography>
          </Box>
          <Button variant={stats.review_due ? 'contained' : 'outlined'} disableElevation onClick={() => navigate('/review')}>Review</Button>
        </CardContent>
      </Card>

      <Section title={`Minutes read per ${bucketWord}`}
        hint={`${formatMinutes(stats.totals.seconds)} · ${stats.totals.words.toLocaleString()} words · ${plural(stats.totals.lookups, 'lookup')}`}>
        <BarChart format={(v) => `${Math.round(v)}`}
          reference={goal && stats.bucket === 'day' ? goal.minutes : undefined} referenceLabel="goal"
          data={stats.buckets.map((b) => ({ label: shortLabel(b.start, stats.bucket), value: b.seconds / 60,
            tip: `${shortLabel(b.start, stats.bucket)}: ${formatMinutes(b.seconds)}, ${b.words.toLocaleString()} words, ${plural(b.lookups, 'lookup')}` }))} />
        <DataTable head={[stats.bucket === 'day' ? 'Day' : 'Week of', 'Minutes', 'Words', 'Lookups']}
          rows={stats.buckets.map((b) => [b.start, minutes(b.seconds), b.words, b.lookups])} />
      </Section>

      <Section title="Books">
        {stats.books.length === 0 && <Typography variant="body2" color="text.secondary">No reading in this period yet.</Typography>}
        <Stack spacing={1.5}>
          {stats.books.map((b) => (
            <Box key={b.book_id} sx={{ cursor: 'pointer' }} onClick={() => navigate(`/read/${encodeURIComponent(b.book_id)}`)}>
              <Stack direction="row" justifyContent="space-between" sx={{ gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{b.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 'none' }}>{formatMinutes(b.seconds)}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={b.progress * 100} sx={{ my: 0.5, height: 4, borderRadius: 2 }} />
              <Typography variant="caption" color="text.secondary">
                {Math.round(b.progress * 100)}% read{b.wpm ? ` · ${b.wpm} words/min` : ''}
                {b.minutes_left !== null ? ` · about ${formatMinutes(b.minutes_left * 60)} left` : ''}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Section>

      {languages.length > 0 && density && (
        <Section title="Lookups per 1,000 words read"
          hint="How often you needed the dictionary: falling over time means the language is getting easier for you.">
          {languages.length > 1 && (
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              {languages.map((l) => (
                <Chip key={l} label={languageName(l)} size="small" variant={l === lang ? 'filled' : 'outlined'} onClick={() => setLanguage(l)} />
              ))}
            </Stack>
          )}
          <Typography variant="body2" sx={{ mb: 1 }}>
            {languageName(lang!)}: <b>{density.per_1000 ?? '–'}</b> per 1,000 words ({plural(density.lookups, 'lookup')} in {density.words.toLocaleString()} words)
          </Typography>
          <LineChart format={(v) => v.toFixed(v < 10 ? 1 : 0)}
            data={density.series.map((p) => ({ label: shortLabel(p.start, stats.bucket), value: p.value,
              tip: p.value === null ? 'too little reading to tell' : `${shortLabel(p.start, stats.bucket)}: ${p.value} per 1,000 words` }))} />
        </Section>
      )}

      <Section title="Words you keep looking up" hint="Good candidates for review.">
        {stats.repeated.length === 0 ? (
          <Typography variant="body2" color="text.secondary">None yet: a word shows here after its second lookup.</Typography>
        ) : (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {stats.repeated.map((w) => <Chip key={`${w.language}-${w.word}`} label={`${w.word} ×${w.times}`} variant="outlined" lang={w.language} />)}
          </Stack>
        )}
      </Section>

      {stats.not_found.length > 0 && (
        <Section title="Not found in your dictionaries" hint="Missing words or word forms the lookup doesn't recognise yet.">
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {stats.not_found.map((w) => <Chip key={`${w.language}-${w.word}`} label={`${w.word}${w.times > 1 ? ` ×${w.times}` : ''}`} variant="outlined" lang={w.language} />)}
          </Stack>
        </Section>
      )}

      {stats.translations.length > 0 && (
        <Section title="Translated passages" hint="Average length of what you translated: shorter over time means you need help with less.">
          <LineChart format={(v) => `${Math.round(v)}`}
            data={stats.translations.map((t) => ({ label: shortLabel(t.start, stats.bucket), value: t.avg_chars,
              tip: `${shortLabel(t.start, stats.bucket)}: ${t.count} translations, ${t.avg_chars} characters on average` }))} />
        </Section>
      )}

      <Section title="When you read" hint="Lighter = less, by weekday and hour.">
        <Heatmap cells={stats.heatmap} format={formatMinutes} />
      </Section>
    </Stack>
  );
}

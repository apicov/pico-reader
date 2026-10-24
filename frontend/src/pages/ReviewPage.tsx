import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { languageName } from '@/services/languages';
import { allCards, dueCards, previews, rate, Rating, subscribeReview, syncReview, type ReviewCard } from '@/services/review';
import { markKnown } from '@/services/words';
import { READING_FONT } from '@/theme/readingThemes';

const GRADES = [
  { grade: Rating.Again, label: 'Again' },
  { grade: Rating.Hard, label: 'Hard' },
  { grade: Rating.Good, label: 'Good' },
  { grade: Rating.Easy, label: 'Easy' },
] as const;

function until(date: Date): string {
  const minutes = Math.max(1, Math.round((date.getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days} d` : `${Math.round(days / 30)} mo`;
}

/** The term in bold inside its sentence (its last word, so "die Mühe" marks "Mühe") */
function Example({ text, term }: { text: string; term: string }) {
  const word = term.split(/\s+/).pop() ?? term;
  const at = text.toLowerCase().indexOf(word.toLowerCase());
  if (!text) return null;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<b>{text.slice(at, at + word.length)}</b>{text.slice(at + word.length)}</>;
}

/** Spaced repetition of looked-up words and translation vocabulary (FSRS). Works offline. */
export default function ReviewPage() {
  const online = useOnlineStatus();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [due, setDue] = useState<ReviewCard[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);

  const load = useCallback(async () => {
    setCards(await allCards());
    setDue(await dueCards(language ?? undefined));
  }, [language]);

  useEffect(() => {
    void load();
    if (online) void syncReview().catch(() => undefined);
    return subscribeReview(() => void load());
  }, [load, online]);

  const languages = useMemo(() => [...new Set(cards.map((c) => c.language))], [cards]);
  const card = due[0];
  const next = useMemo(() => (card ? previews(card) : null), [card]);
  const nextDue = useMemo(() => cards.filter((c) => !due.includes(c)).sort((a, b) => a.due.localeCompare(b.due))[0], [cards, due]);

  const answer = async (grade: (typeof GRADES)[number]['grade']) => {
    if (!card) return;
    setShown(false);
    setDone((d) => d + 1);
    await rate(card, grade);
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Review</Typography>
        <Typography variant="body2" color="text.secondary">{due.length} due · {cards.length} cards</Typography>
      </Stack>
      {languages.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Chip label="All" variant={language ? 'outlined' : 'filled'} onClick={() => setLanguage(null)} />
          {languages.map((l) => (
            <Chip key={l} label={languageName(l)} variant={l === language ? 'filled' : 'outlined'} onClick={() => setLanguage(l)} />
          ))}
        </Stack>
      )}
      {done > 0 && card && <LinearProgress variant="determinate" value={(done / (done + due.length)) * 100} sx={{ mb: 2, borderRadius: 2 }} />}
      {!card ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 5 }}>
            <Typography variant="h6" sx={{ fontFamily: READING_FONT }}>{done ? `Done: ${done} reviewed ✓` : 'Nothing to review now'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {cards.length === 0
                ? 'Words you look up while reading (and translation vocabulary you add) come here.'
                : nextDue ? `Next card in ${until(new Date(nextDue.due))}.` : ''}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent sx={{ py: 4, px: 3 }}>
            <Typography variant="caption" color="text.secondary">{languageName(card.language)}</Typography>
            <Typography lang={card.language} sx={{ fontFamily: READING_FONT, fontSize: 30, fontWeight: 600, my: 1 }}>{card.term}</Typography>
            {card.example && (
              <Typography lang={card.language} sx={{ fontFamily: READING_FONT, color: 'text.secondary', fontSize: 16 }}>
                <Example text={card.example} term={card.term} />
              </Typography>
            )}
            {shown ? (
              <>
                <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 3, pt: 2 }}>
                  <Typography sx={{ fontFamily: READING_FONT, fontSize: 18 }}>{card.meaning || '—'}</Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
                  {GRADES.map(({ grade, label }) => (
                    <Button key={label} fullWidth variant={grade === Rating.Good ? 'contained' : 'outlined'} disableElevation
                      onClick={() => void answer(grade)} sx={{ flexDirection: 'column', py: 1 }}>
                      {label}
                      <Typography variant="caption" sx={{ opacity: 0.75 }}>{next ? until(next[grade]) : ''}</Typography>
                    </Button>
                  ))}
                </Stack>
              </>
            ) : (
              <Button fullWidth variant="contained" disableElevation sx={{ mt: 3 }} onClick={() => setShown(true)}>Show answer</Button>
            )}
            <Button size="small" color="inherit" sx={{ mt: 2, color: 'text.secondary' }} disabled={!online}
              onClick={() => { setShown(false); void markKnown(card.language, card.term); }}>
              I know this word — stop reviewing it
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

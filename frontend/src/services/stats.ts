/** Statistics and the server-side settings (reading goal), with the last answers kept for offline use. */
import { api } from '@/services/api';
import { getPref, setPref } from '@/services/prefs';

export interface ReadingGoal {
  enabled: boolean;
  minutes: number;
  days: number[]; // 0 = Monday
}

export interface Stats {
  review_due: number;
  known_words: number;
  period: string;
  bucket: 'day' | 'week';
  today: string;
  buckets: { start: string; seconds: number; words: number; lookups: number }[];
  totals: { seconds: number; words: number; lookups: number };
  today_seconds: number;
  streak: { current: number; best: number };
  goal: (ReadingGoal & { days_met: number; days_due: number }) | null;
  books: { book_id: string; title: string; language: string; seconds: number; words: number; sessions: number;
    last_read: string; progress: number; wpm: number | null; minutes_left: number | null }[];
  heatmap: number[][]; // [weekday 0=Mon][hour] seconds
  density: Record<string, { series: { start: string; value: number | null }[]; words: number; lookups: number; per_1000: number | null }>;
  repeated: { word: string; language: string; times: number; last: string }[];
  not_found: { word: string; language: string; times: number }[];
  translations: { start: string; count: number; avg_chars: number }[];
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export async function getStats(period: string, bookId?: string): Promise<Stats> {
  const q = new URLSearchParams({ period, tz: TZ, ...(bookId ? { book_id: bookId } : {}) });
  const stats = await api<Stats>(`/api/stats?${q}`);
  if (!bookId) await setPref(`stats:${period}`, stats);
  return stats;
}

export const cachedStats = (period: string) => getPref<Stats>(`stats:${period}`);

export async function getReadingGoal(): Promise<ReadingGoal> {
  try {
    const s = await api<{ reading_goal: ReadingGoal }>('/api/settings');
    await setPref('reading_goal', s.reading_goal);
    return s.reading_goal;
  } catch {
    return (await getPref<ReadingGoal>('reading_goal')) ?? { enabled: false, minutes: 20, days: [0, 1, 2, 3, 4, 5, 6] };
  }
}

export async function saveReadingGoal(goal: ReadingGoal): Promise<ReadingGoal> {
  const s = await api<{ reading_goal: ReadingGoal }>('/api/settings', { method: 'PUT', body: { reading_goal: goal } });
  await setPref('reading_goal', s.reading_goal);
  return s.reading_goal;
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export interface Usage {
  period: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens: number;
  by_purpose: { purpose: string; calls: number; prompt_tokens: number; completion_tokens: number }[];
  by_day: { day: string; tokens: number; calls: number }[];
}

export async function getUsage(period: string): Promise<Usage> {
  const usage = await api<Usage>(`/api/usage?period=${period}&tz=${encodeURIComponent(TZ)}`);
  await setPref(`usage:${period}`, usage);
  return usage;
}

export const cachedUsage = (period: string) => getPref<Usage>(`usage:${period}`);

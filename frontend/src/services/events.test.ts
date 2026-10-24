import { SessionTracker } from './events';

function tracker() {
  let t = 0;
  let n = 0;
  const tr = new SessionTracker('b', 'epub', { idleMs: 120_000, breakMs: 600_000, minMs: 15_000 },
    () => t, () => `s${++n}`);
  return { tr, at: (ms: number) => { t = ms; } };
}

describe('SessionTracker', () => {
  it('counts the time between signs of reading', () => {
    const { tr, at } = tracker();
    at(0); tr.activity(0.1);
    at(60_000); tr.activity(0.11);
    at(90_000);
    const s = tr.activity(0.12)!;
    expect(s.seconds).toBe(90);
    expect([s.progress_start, s.progress_end]).toEqual([0.1, 0.12]);
  });

  it('caps a long pause at the idle limit', () => {
    const { tr, at } = tracker();
    at(0); tr.activity(0.1);
    at(300_000); // 5 min on one page: counts 2 min
    expect(tr.activity(0.2)!.seconds).toBe(120);
  });

  it('a break starts a new session', () => {
    const { tr, at } = tracker();
    at(0); tr.activity(0.1);
    at(60_000); tr.activity(0.2);
    at(60_000 + 700_000);
    expect(tr.activity(0.3)).toBeNull(); // the first sign of a new session
    at(60_000 + 760_000);
    expect(tr.activity(0.31)!.id).toBe('s2');
  });

  it('drops sessions shorter than the minimum', () => {
    const { tr, at } = tracker();
    at(0); tr.activity(0.1);
    at(5_000); tr.activity(0.1);
    expect(tr.end()).toBeNull();
  });
});

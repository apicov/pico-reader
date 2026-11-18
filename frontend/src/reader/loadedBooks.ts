/** At most this many books stay loaded (a PDF holds its whole file in memory); one left out opens again at its place */
export const MAX_LOADED = 4;

/** The books loaded after `shown` is shown: in the order they were first loaded (the page keeps their DOM where it is:
 *  moving an EPUB's iframe would load it again), without the one viewed longest ago beyond `max`. `recent`: the ids,
 *  most recently shown first. */
export function nextLoaded(loaded: string[], recent: string[], shown: string, max = MAX_LOADED): string[] {
  const next = loaded.includes(shown) ? loaded : [...loaded, shown];
  if (next.length <= max) return next;
  const order = [shown, ...recent.filter((id) => id !== shown)];
  const drop = [...next].sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
  return next.filter((id) => id !== drop);
}

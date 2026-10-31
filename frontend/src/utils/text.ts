/** Text as searches compare it: lower case, accents off ("Müller" finds "muller", "Mueller" doesn't) */
export const foldForSearch = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A line of Markdown as plain text, for a list: no code blocks, markup or citations ("[3]"); at most `max` characters */
export function markdownSnippet(md = '', max = 160): string {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*[-*+]\s+/gm, ' ').replace(/[#*_>`|]+/g, ' ')
    .replace(/\s?\[\d+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

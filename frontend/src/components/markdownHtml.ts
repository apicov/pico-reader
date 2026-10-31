/** Text steps around the Markdown renderer: spoilers before it, citation buttons after it. */

/** `||hidden||` → a spoiler span, blurred until tapped (community posts and comments). Not inside code. */
export function withSpoilers(md: string): string {
  return md.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part
    : part.replace(/\|\|([^|\n]+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>'))).join('');
}

/** "[3]" → a citation button, except inside code (a diagram's `A[1]` is a node, not a citation) */
export function citeButtons(html: string): string {
  return html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/).map((part, i) => (i % 2 ? part
    : part.replace(/\[(\d{1,3})\]/g, '<button type="button" class="cite" data-n="$1">$1</button>'))).join('');
}

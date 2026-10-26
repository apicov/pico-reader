/**
 * Plain text of a manual section, for the manual's search box. Walks the JSX tree without rendering it:
 * text children, plus string props and props holding nodes/arrays/objects (e.g. Controls rows), so a
 * label inside a table row or a picture caption is findable too. Function props are skipped.
 */
import { isValidElement } from 'react';

/** Styling / wiring props whose values aren't words a reader would search for. */
const SKIP_PROPS = new Set(['className', 'variant', 'color', 'fontSize', 'device', 'kind', 'to', 'size', 'sx', 'name']);

export function nodeText(node: unknown, depth = 0): string {
  if (depth > 40 || node == null || typeof node === 'boolean' || typeof node === 'function') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => nodeText(n, depth + 1)).join(' ');
  if (isValidElement(node)) return nodeText(node.props, depth + 1);
  if (typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>)
      .filter(([key]) => !SKIP_PROPS.has(key))
      .map(([, v]) => nodeText(v, depth + 1))
      .join(' ');
  }
  return '';
}

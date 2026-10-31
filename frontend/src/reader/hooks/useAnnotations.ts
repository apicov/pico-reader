import { useEffect, useMemo, useState } from 'react';
import { annotationsFor, subscribeAnnotations, syncAnnotations, type Annotation } from '@/services/annotations';
import type { BookFormat } from '@/services/types';
import type { Highlight } from '../types';

/** The book's highlights and bookmarks (synced with the other devices), and the highlights the open format shows */
export function useAnnotations(bookId: string, format: BookFormat | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    const load = () => void annotationsFor(bookId).then(setAnnotations);
    load();
    void syncAnnotations().catch(() => undefined);
    return subscribeAnnotations(load);
  }, [bookId]);
  const highlights = useMemo<Highlight[]>(() => annotations.filter((a) => a.kind === 'highlight' && a.format === format)
    .map((a) => ({ id: a.id, location: a.location, text: a.text, color: a.color })), [annotations, format]);
  return { annotations, highlights };
}

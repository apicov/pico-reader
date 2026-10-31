import { useEffect, useState } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cachedNotes, loadNotes, subscribeNotes, type Note } from '@/services/notes';
import { cachedProjects, loadProjects, type Project } from '@/services/projects';

/** The reader's notes, or those about one book; read offline from the device's copy. */
export function useNotes(bookId?: string): Note[] | null {
  const online = useOnlineStatus();
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    const load = () => void cachedNotes(bookId).then(setNotes);
    load();
    void loadNotes().then(load);
    return subscribeNotes(load);
  }, [bookId, online]);
  return notes;
}

/** The projects on the study computer (kept on the device for offline use) */
export function useProjects(): Project[] {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    void cachedProjects().then(setProjects);
    void loadProjects().then(setProjects);
  }, []);
  return projects;
}

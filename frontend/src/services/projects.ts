/** The reader's projects: folders on their study computer (`reader project add` there), each with its own notes/
 *  and inbox/. Made on the computer; the app lists them (kept on the device for offline use), files notes in them
 *  and sends things to them. */
import { fetchCached } from '@/services/cachedFetch';
import { getPref } from '@/services/prefs';

export interface Project {
  id: string;
  name: string;
  notes: number;
}

const KEY = 'projects';

export async function cachedProjects(): Promise<Project[]> {
  return (await getPref<Project[]>(KEY)) ?? [];
}

export const loadProjects = () => fetchCached<Project[]>('/api/projects', KEY, []);

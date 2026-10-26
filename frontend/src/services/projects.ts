/** The reader's projects: folders on their study computer (`reader project add` there), each with its own notes/
 *  and inbox/. Made on the computer; the app lists them (kept on the device for offline use), files notes in them
 *  and sends things to them. */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

export interface Project {
  id: string;
  name: string;
  notes: number;
}

const KEY = 'projects';

export async function cachedProjects(): Promise<Project[]> {
  return (await getPref<Project[]>(KEY)) ?? [];
}

export async function loadProjects(): Promise<Project[]> {
  if (!isOnline()) return cachedProjects();
  try {
    const projects = await api<Project[]>('/api/projects');
    await setPref(KEY, projects);
    return projects;
  } catch {
    return cachedProjects();
  }
}

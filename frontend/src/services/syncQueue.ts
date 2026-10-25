/** Shared by the offline queues (highlights, review cards, the shelf): what to do when sending one item fails. */
import { ApiError } from '@/services/api';

/** The server will never take this item as it is (a 4xx other than "sign in again", a timeout or a rate
 *  limit): the queue drops it and goes on, so one bad item can't block every change after it. Network errors
 *  and 5xx return false: the queue stops and the item is sent again later. */
export function rejectedForGood(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);
}

export function dropRejected(what: string, id: string, e: unknown): void {
  console.warn(`Not synced: the server refused ${what} ${id}: ${(e as Error).message}`);
}

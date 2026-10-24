/**
 * Conversations with the library. The server keeps them (Postgres, backed up to R2); the device keeps a copy
 * (IndexedDB) so past conversations read offline. Answers stream as server-sent events.
 */
import Dexie, { type Table } from 'dexie';
import { api, getToken } from '@/services/api';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export interface Passage {
  book_id: string;
  title: string;
  heading: string;
  format: string;
  location: string;
  progress: number;
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
  book_ids: string[] | null;
  created_at: string;
  updated_at: string;
  snippet?: string;
}

export interface Message {
  id: number;
  conversation_id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Passage[];
  created_at: string;
}

class ChatDb extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message & { conversation_id: string }, [string, number]>;
  constructor() {
    super('pico-reader-chats');
    this.version(1).stores({ conversations: 'id, updated_at', messages: '[conversation_id+id], conversation_id' });
  }
}

const db = new ChatDb();

export async function listConversations(q = ''): Promise<Conversation[]> {
  const list = await api<Conversation[]>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  if (!q) {
    await db.transaction('rw', db.conversations, async () => {
      const ids = new Set(list.map((c) => c.id));
      const gone = (await db.conversations.toCollection().primaryKeys()).filter((id) => !ids.has(id));
      await db.conversations.bulkDelete(gone);
      await db.conversations.bulkPut(list);
    });
  }
  return list;
}

/** The offline copy, newest first (`q` matches titles only) */
export async function localConversations(q = ''): Promise<Conversation[]> {
  const all = await db.conversations.orderBy('updated_at').reverse().toArray();
  const needle = q.trim().toLowerCase();
  return needle ? all.filter((c) => c.title.toLowerCase().includes(needle)) : all;
}

export async function loadConversation(id: string, online: boolean): Promise<{ conversation: Conversation; messages: Message[] } | null> {
  if (online) {
    const res = await api<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}`);
    await db.conversations.put(res.conversation);
    await db.messages.where('conversation_id').equals(id).delete();
    await db.messages.bulkPut(res.messages.map((m) => ({ ...m, conversation_id: id })));
    return res;
  }
  const conversation = await db.conversations.get(id);
  if (!conversation) return null;
  const messages = await db.messages.where('conversation_id').equals(id).sortBy('id');
  return { conversation, messages };
}

export async function createConversation(id: string, bookIds: string[] | null): Promise<Conversation> {
  const c = await api<Conversation>('/api/conversations', { method: 'POST', body: { id, book_ids: bookIds } });
  await db.conversations.put(c);
  return c;
}

export async function updateConversation(id: string, patch: { title?: string; book_ids?: string[]; all_books?: boolean }): Promise<Conversation> {
  const c = await api<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  await db.conversations.put(c);
  return c;
}

export async function deleteConversation(id: string): Promise<void> {
  await api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await db.conversations.delete(id);
  await db.messages.where('conversation_id').equals(id).delete();
}

export interface StreamHandlers {
  onSources: (sources: Passage[]) => void;
  onDelta: (text: string) => void;
}

/** Split a server-sent event stream into (event, data) pairs; `feed` returns the complete ones so far. */
export function sseParser() {
  let buffer = '';
  return (chunk: string): { event: string; data: unknown }[] => {
    buffer += chunk.replace(/\r\n/g, '\n');
    const out: { event: string; data: unknown }[] = [];
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) out.push({ event, data: JSON.parse(data.join('\n')) });
    }
    return out;
  };
}

/** Send a message; resolves when the answer is complete. Uses fetch on every platform (streams). */
export async function sendMessage(conversationId: string, content: string, h: StreamHandlers,
                                  signal?: AbortSignal): Promise<{ title: string }> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().then((d) => d.detail).catch(() => null);
    throw new Error(typeof detail === 'string' ? detail : `The question couldn't be sent (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = sseParser();
  let result: { title: string } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const { event, data } of feed(decoder.decode(value, { stream: true }))) {
      if (event === 'sources') h.onSources(data as Passage[]);
      else if (event === 'delta') h.onDelta(data as string);
      else if (event === 'error') throw new Error((data as { message: string }).message);
      else if (event === 'done') result = { title: (data as { title: string }).title };
    }
  }
  if (!result) throw new Error('The answer was cut off');
  return result;
}

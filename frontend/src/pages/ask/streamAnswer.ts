import type { Dispatch, SetStateAction } from 'react';
import { sendMessage, type ChatLink, type Message } from '@/services/chat';

/** Ids of the messages shown while an answer streams in, until the stored ones replace them */
export const PENDING_QUESTION = -2;
export const PENDING_ANSWER = -1;

/** Sends a question and shows the answer as it comes: the question, then the answer growing (its sources, text,
 *  tools used, links and proposed changes). Resolves with the chat's title once the answer is complete. */
export async function streamAnswer(conversationId: string, question: string,
                                   setMessages: Dispatch<SetStateAction<Message[]>>): Promise<{ title: string }> {
  const now = new Date().toISOString();
  setMessages((m) => [...m, { id: PENDING_QUESTION, role: 'user', content: question, sources: [], created_at: now },
    { id: PENDING_ANSWER, role: 'assistant', content: '', sources: [], created_at: now }]);
  const update = (patch: Partial<Message>) => setMessages((m) => m.map((x) => (x.id === PENDING_ANSWER ? { ...x, ...patch } : x)));
  let text = '';
  const extras = { tools: [] as string[], links: [] as ChatLink[], actions: [] as NonNullable<Message['extras']>['actions'] };
  return sendMessage(conversationId, question, {
    onSources: (sources) => update({ sources }),
    onDelta: (piece) => { text += piece; update({ content: text }); },
    onTool: (label) => { extras.tools.push(label); update({ extras: { ...extras } }); },
    onLink: (link) => { extras.links.push(link); update({ extras: { ...extras } }); },
    onAction: (action) => { extras.actions!.push(action); update({ extras: { ...extras } }); },
  });
}

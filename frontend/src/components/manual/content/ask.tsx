/** Manual chapter: Ask your library (the chat, what it can do, changes it proposes, offline search). */
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import type { ManualChapter } from '../types';
import { Callout, ManualLink, Screenshot, Ui } from '../parts';

export const ask: ManualChapter = {
  id: 'ask',
  title: 'Ask your library',
  icon: QuestionAnswerOutlinedIcon,
  summary: 'A chat that answers from your books and knows your reading, notes and words.',
  sections: [
    {
      id: 'asking',
      title: 'Asking',
      body: (
        <>
          <p>The speech-bubble button in the top bar opens the chat. Ask in any language, e.g. <em>"What does the author mean
            by pruning?"</em> or <em>"Summarise chapter 3 of Die Wolke."</em></p>
          <ul>
            <li>The answer cites passages as <strong>[1]</strong>, <strong>[2]</strong>…: tap one to open the book right there.</li>
            <li><Ui>All books</Ui> at the top picks which books to search, e.g. only the one you're studying.</li>
            <li>Ask follow-ups: the chat remembers the conversation.</li>
            <li>A grey line under each answer says which AI model wrote it (two, when a second one took over halfway).</li>
          </ul>
          <Screenshot name="ask" caption="An answer with the passages it comes from" />
          <p>The list of chats (the button at the top left on a phone) keeps every conversation: <Ui>New chat</Ui>, search
            them, rename or delete one.</p>
        </>
      ),
    },
    {
      id: 'more',
      title: 'What else it knows',
      body: (
        <>
          <p>Besides the books, the chat can look at your own data. For example:</p>
          <ul>
            <li><em>"How much did I read this week?"</em>, <em>"How long until I finish Fluent Python?"</em> (your statistics)</li>
            <li><em>"Which words do I keep looking up?"</em>, <em>"What did I translate from Die Wolke?"</em></li>
            <li><em>"Show my highlights in chapter 2"</em>, <em>"What's on my shelf?"</em></li>
            <li><em>"What did the others think of this book?"</em>, <em>"What did Anna post?"</em> (the community; spoilers stay hidden)</li>
            <li><em>"Open Die Wolke at 40%"</em>: a button that opens it.</li>
            <li><em>"Give me my vocabulary as an Anki deck"</em>: a download button.</li>
            <li>Your notes: <em>"What's in my note on chapter 3?"</em></li>
          </ul>
        </>
      ),
    },
    {
      id: 'changes',
      title: 'Changes wait for you',
      body: (
        <>
          <p>When the chat would change something, it only proposes it. A card shows what it would do, with
            <Ui>Confirm</Ui> and <Ui>Cancel</Ui>; nothing happens before you confirm. It can:</p>
          <ul>
            <li>save a note (<Ui>Show the note</Ui> previews it) or add a section to one (<ManualLink to="notes">Notes</ManualLink>);</li>
            <li>send text or code to your computer, into a project or its running file (<ManualLink to="computer">The study computer</ManualLink>);</li>
            <li>set your reading goal, mark words as known, make review cards.</li>
          </ul>
          <Screenshot name="ask-confirm" caption="A note the chat proposes: confirm or cancel" />
        </>
      ),
    },
    {
      id: 'offline',
      title: 'Without a connection',
      body: (
        <>
          <p>The chat needs a connection to answer. Offline, its page shows a search over your downloaded books instead:
            type a question or words, and the matching passages are listed; tap one to open the book there.</p>
          <Callout kind="note">Switch it on first: Settings → <em>Offline search</em> (<ManualLink to="offline.search">Offline search</ManualLink>).</Callout>
        </>
      ),
    },
  ],
};

/** Manual chapter: Words (dictionaries, review cards, translations and the Anki deck). */
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import type { ManualChapter } from '../types';
import { Callout, ManualLink, Screenshot, Ui } from '../parts';

export const words: ManualChapter = {
  id: 'words',
  title: 'Words: dictionaries and review',
  icon: SchoolOutlinedIcon,
  summary: 'Dictionaries on the device, review cards for the words you look up, your translations.',
  sections: [
    {
      id: 'dictionaries',
      title: 'Dictionaries',
      body: (
        <>
          <p>Settings → <Ui>Manage dictionaries</Ui>. The dictionaries of the library are listed by language:</p>
          <ul>
            <li><Ui>Install</Ui> one, or all of a language at once. They're kept on the device, so looking up works offline.</li>
            <li>An installed dictionary has a switch (used for lookups or not) and ↑ ↓ to order it. Both are saved for your
              account: all your devices use the same.</li>
            <li><Ui>Update</Ui> appears when there's a newer version; <Ui>Remove</Ui> frees the space.</li>
            <li><strong>On this device</strong> says how many are installed and how much space they take.</li>
          </ul>
          <Callout kind="note">Admins can also add dictionaries there (<Ui>Upload</Ui>, StarDict files), for every reader or only themselves.</Callout>
        </>
      ),
    },
    {
      id: 'review',
      title: 'Review cards',
      body: (
        <>
          <p>Words you want to keep become <strong>review cards</strong>: <Ui>Add to review</Ui> under a looked-up word, or on
            a translation's vocabulary. With Settings → <em>Learning</em> → <strong>Add looked-up words to review</strong>,
            every word you look up becomes a card by itself.</p>
          <p>Settings → <Ui>Review words</Ui> shows the cards that are due, with the sentence you met the word in:</p>
          <ol>
            <li>Think of the meaning, then tap <Ui>Show answer</Ui>.</li>
            <li>Say how well you knew it: <Ui>Again</Ui>, <Ui>Hard</Ui>, <Ui>Good</Ui> or <Ui>Easy</Ui>. Each shows when the card
              comes back; the better you knew it, the later.</li>
          </ol>
          <Screenshot name="review" caption="A review card, with its answer shown" />
          <p>The chips at the top pick a language. Cards are scheduled on the device and kept in step across your devices.
            The chat can add cards too, e.g. "make cards of the words I keep looking up" (<ManualLink to="ask">Ask your library</ManualLink>).</p>
        </>
      ),
    },
    {
      id: 'known',
      title: 'Known words',
      body: (
        <p>
          <Ui>I know this</Ui> under a word marks it as known: it leaves your review cards, isn't underlined while reading,
          and doesn't count among the words you keep looking up (<ManualLink to="stats">Statistics</ManualLink>).
        </p>
      ),
    },
    {
      id: 'translations',
      title: 'Translations and the Anki deck',
      body: (
        <>
          <p>The translate button in the top bar lists every passage you translated, newest first, with its vocabulary.
            Search them, or pick one book.</p>
          <Screenshot name="translations" caption="Your translations" />
          <p>The download button exports the vocabulary of your translations as an <strong>Anki deck (.apkg)</strong> or a
            <strong> spreadsheet (.tsv)</strong>, of all books or the one picked.</p>
        </>
      ),
    },
  ],
};

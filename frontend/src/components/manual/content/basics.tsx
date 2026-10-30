/** Manual chapters: Getting started · Finding your way around. */
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import AddIcon from '@mui/icons-material/Add';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

export const gettingStarted: ManualChapter = {
  id: 'start',
  title: 'Getting started',
  icon: RocketLaunchOutlinedIcon,
  summary: 'What the reader does, signing in, and your first book.',
  sections: [
    {
      id: 'what',
      title: 'What the reader does',
      body: (
        <>
          <p>Pico Reader is a library and an e-reader for studying, shared with a few friends:</p>
          <ul>
            <li><strong>Read</strong> EPUB, PDF and text books, on the phone, the tablet or in the browser, also offline.</li>
            <li><strong>Understand</strong>: tap a word for its dictionary entries, select a passage for its translation.</li>
            <li><strong>Remember</strong>: highlights, bookmarks, notes, and review cards for the words you look up.</li>
            <li><strong>Ask</strong> your library questions; the answers cite the passages they come from.</li>
            <li><strong>Study on a computer</strong>: send highlights and code to a folder there, and keep your notes as files.</li>
            <li><strong>Share</strong> what you think: reviews, posts and lists in the community.</li>
          </ul>
          <p>Your place, highlights, notes and settings follow you from one device to another.</p>
        </>
      ),
    },
    {
      id: 'signin',
      title: 'Signing in',
      body: (
        <>
          <ol>
            <li>Type your email address and tap <Ui>Send sign-in code</Ui>.</li>
            <li>A 6-digit code arrives by email within a minute. Type it and tap <Ui>Sign in</Ui> (or <Ui>Use another email</Ui> to start over).</li>
          </ol>
          <Screenshot name="login" caption="Signing in with a code from your email" />
          <p>There's no password. You stay signed in until you sign out (Settings, at the end), also offline.</p>
          <Callout kind="note">
            The library is private: only readers who were invited can sign in. To invite a friend, ask the
            administrator.
          </Callout>
        </>
      ),
    },
    {
      id: 'apps',
      title: 'Phone, tablet and browser',
      body: (
        <>
          <ul>
            <li><strong>Android</strong>: the Pico Reader app. Books, dictionaries and the search model are kept on the device.</li>
            <li><strong>Browser</strong>: open <strong>books.apicov.xyz</strong>. It can be installed like an app (the browser's menu →
              <em> Install app</em> or <em>Add to home screen</em>) and then works offline too.</li>
          </ul>
          <p>The same account works everywhere; what you do on one device reaches the others when they're online.</p>
        </>
      ),
    },
    {
      id: 'first',
      title: 'Your first book in three steps',
      body: (
        <>
          <ol>
            <li>On the <strong>Library</strong>, tap a cover. The book downloads to the device and opens.</li>
            <li>Tap the right side of the page to go on, the left side to go back (or swipe).</li>
            <li>Long-press a word to see what it means. That's it: your place is saved as you read.</li>
          </ol>
          <p>Next time, the book is in the <Ui>Reading</Ui> tab, and opens where you stopped (see <ManualLink to="reading">Reading</ManualLink>).</p>
        </>
      ),
    },
  ],
};

export const findingYourWay: ManualChapter = {
  id: 'around',
  title: 'Finding your way around',
  icon: ExploreOutlinedIcon,
  summary: 'The top bar, and where each part of the app is.',
  sections: [
    {
      id: 'topbar',
      title: 'The top bar',
      body: (
        <>
          <p>This bar is at the top of every page, the book included, always in the same place: tap <strong>Library</strong>
            on the left to come back home, or a tool. A page's own bar (the book's, the chat's) is under it.</p>
          <p>The book you're reading stays open while you look at the other pages: the book button takes you back to it,
            instantly and at the same place.</p>
          <Screenshot name="topbar" caption="The top bar on a tablet" device="tablet" />
          <Controls rows={[
            { icon: <MenuBookOutlinedIcon />, label: 'Back to the book', text: 'Shown when a book is open and you\'re on another page: back to it, as you left it.' },
            { icon: <AddIcon />, label: 'Add books', text: <>Upload PDFs, EPUBs and Markdown to the shared library (<ManualLink to="adding">Adding books</ManualLink>).</> },
            { icon: <InsightsOutlinedIcon />, label: 'Statistics', text: <>Reading time, streaks, your goal, words you look up (<ManualLink to="stats">Statistics</ManualLink>).</> },
            { icon: <PeopleAltOutlinedIcon />, label: 'Community', text: <>Posts, reviews and lists of the other readers (<ManualLink to="community">Community</ManualLink>).</> },
            { icon: <QuestionAnswerOutlinedIcon />, label: 'Ask your library', text: <>Questions about your books, statistics, notes (<ManualLink to="ask">Ask your library</ManualLink>).</> },
            { icon: <NoteAltOutlinedIcon />, label: 'Notes', text: <>Your summaries, outlines and diagrams (<ManualLink to="notes">Notes</ManualLink>).</> },
            { icon: <TranslateIcon />, label: 'Dictionary and translations', text: <>Look up any word, offline dictionaries first, then the AI (<ManualLink to="words.dictionary">Dictionary</ManualLink>); the passages you translated in its second tab (<ManualLink to="words.translations">Translations</ManualLink>).</> },
            { icon: <SettingsOutlinedIcon />, label: 'Settings', text: <>Theme, languages, the computer, dictionaries, offline search… and this manual (<ManualLink to="settings">Settings</ManualLink>).</> },
            { icon: <CloudOffOutlinedIcon />, label: 'Offline', text: <>Shown when there's no connection. Downloaded books still open (<ManualLink to="offline">Offline use</ManualLink>).</> },
          ]} />
        </>
      ),
    },
  ],
};

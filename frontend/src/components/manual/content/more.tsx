/** Manual chapters: Statistics · Community · Adding books · Offline use · Settings. */
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

export const stats: ManualChapter = {
  id: 'stats',
  title: 'Statistics and your reading goal',
  icon: InsightsOutlinedIcon,
  summary: 'How much and when you read, how fast, and how your languages go.',
  sections: [
    {
      id: 'page',
      title: 'The statistics',
      body: (
        <>
          <p>The chart button in the top bar. <Ui>Week</Ui>, <Ui>Month</Ui>, <Ui>Year</Ui> or <Ui>All</Ui> at the top picks the period.</p>
          <Screenshot name="stats" caption="Today, the streak and the minutes per day" />
          <ul>
            <li><strong>Today</strong>: minutes read, and how far to your goal; the 🔥 counts the days in a row you read.</li>
            <li>Minutes per day or week, and <strong>Books</strong>: time spent, reading speed and the time left in each.</li>
            <li><strong>When you read</strong>: weekdays and hours.</li>
            <li><strong>Lookups per 1,000 words read</strong>, per language: when it falls, the language is getting easier.</li>
            <li><strong>Words you keep looking up</strong> and <strong>Not found in your dictionaries</strong>.</li>
            <li><strong>Translated passages</strong> and <strong>AI use</strong>.</li>
          </ul>
          <p>Reading time is counted on the device, also offline, and sent later.</p>
        </>
      ),
    },
    {
      id: 'goal',
      title: 'A reading goal',
      body: (
        <p>Settings → <em>Reading goal</em>: switch it on, choose <strong>Minutes a day</strong> and <strong>On these
          days</strong>. Statistics then shows the goal ring for today and on how many days you met it. Or ask the chat:
          <em> "Set me a goal of 30 minutes on weekdays."</em></p>
      ),
    },
  ],
};

export const community: ManualChapter = {
  id: 'community',
  title: 'Community',
  icon: PeopleAltOutlinedIcon,
  summary: 'Reviews, posts with quotes, comments and top lists, with the other readers.',
  sections: [
    {
      id: 'profile',
      title: 'Your profile',
      body: (
        <p>The first time you open the community, choose a name and a handle (@…). Other readers only ever see your name,
          handle and picture, never your email. Settings → <Ui>Your profile</Ui> changes them, your picture and a short
          bio, and whether others see what you're reading now.</p>
      ),
    },
    {
      id: 'reviews',
      title: 'Reviews',
      body: (
        <>
          <p>A book's ⋮ → <Ui>Reviews & discussion</Ui>: its average score, how many recommend it, the reviews and the posts
            about it. Give it a score from 0 to 10, tick <Ui>I recommend it</Ui>, add your impressions and
            <Ui> Save review</Ui>. <Ui>Contains spoilers</Ui> hides the text until someone taps it.</p>
          <Screenshot name="book-page" caption="A book's reviews and discussions" />
          <p>When you reach the end of a book, the reader offers once to <Ui>Rate it</Ui>.</p>
        </>
      ),
    },
    {
      id: 'posts',
      title: 'Posts, quotes and comments',
      body: (
        <>
          <p>The people button in the top bar shows every post, the newest first, filtered by <em>All</em>, <em>About my
            books</em> or <em>Mine</em>. <Ui>New post</Ui> writes one (Markdown), linked to books.</p>
          <ul>
            <li><strong>Quote</strong> a passage: select it while reading and tap <Ui>Quote</Ui>, or share a highlight from the
              book's Notes tab. Readers tap <em>Open here</em> to read it in the book.</li>
            <li>Comment, reply to a comment, and like.</li>
            <li>Hide a spoiler inside any text <code>||like this||</code>.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'lists',
      title: 'Lists',
      body: <p>On your profile, <Ui>New list</Ui> makes a list of books with a note for each, e.g. <em>My top 10</em>. Others see your lists on your profile.</p>,
    },
  ],
};

export const adding: ManualChapter = {
  id: 'adding',
  title: 'Adding books',
  icon: LibraryAddOutlinedIcon,
  summary: 'PDFs, EPUBs and Markdown, several at once, into the shared library.',
  sections: [
    {
      id: 'upload',
      title: 'Uploading',
      body: (
        <>
          <p>The + in the top bar. Any reader can add books; they're shared with everyone.</p>
          <ul>
            <li><Ui>Choose files</Ui>: one or several PDFs or EPUBs, or a Markdown file with its pictures.</li>
            <li><Ui>Choose a folder</Ui>, or drag files and folders onto the page.</li>
          </ul>
          <Screenshot name="upload" caption="Several books ready to upload" />
          <p>Each book gets a card: its cover, title, author and language, read from the file (or guessed from the file name
            and the text). Correct what's wrong; <em>Category, another format…</em> files it, or adds it as another format of a
            book that's there. <Ui>Upload N books</Ui> sends the ticked ones one after another.</p>
          <Callout kind="note">A title already in the library is left unticked. After the upload, the server makes the book
            searchable (a few minutes) and the AI suggests a category.</Callout>
        </>
      ),
    },
    {
      id: 'marker',
      title: 'Markdown from PDF converters',
      body: (
        <>
          <p>Books converted with <em>marker</em> are folders with a <code>.md</code> named like the folder and its pictures.
            Choose one such folder, or the folder that holds many: each becomes a book, in the clean <strong>Text</strong>
            format with formulas and code.</p>
          <p>Title and author come from the folder name (<em>Title (Author)</em>), page lines are removed, and long chapters
            are split at their sections.</p>
        </>
      ),
    },
    {
      id: 'history',
      title: 'Changing and deleting',
      body: (
        <p>Only the reader who added a book (or an admin) can change its category or delete it, from the book's ⋮ menu. The
          upload page lists the history of your books: added, changed, indexed, deleted.</p>
      ),
    },
  ],
};

export const offline: ManualChapter = {
  id: 'offline',
  title: 'Offline use',
  icon: CloudOffOutlinedIcon,
  summary: 'What works without a connection, and offline search.',
  sections: [
    {
      id: 'what',
      title: 'What works offline',
      body: (
        <>
          <ul>
            <li>Reading books you opened before (they're kept on the device), dictionaries you installed.</li>
            <li>Highlights, bookmarks, your place, review cards, My shelf and collections, sending to the computer: kept on the
              device and sent when you're back online.</li>
            <li>Reading notes, translations and the chats you had.</li>
          </ul>
          <p>Needs a connection: translating, asking the chat, the community, uploading, and changing notes.</p>
          <p>Settings → <em>On this device</em> lists the downloaded books and the space they take; remove one there.</p>
        </>
      ),
    },
    {
      id: 'search',
      title: 'Offline search',
      body: (
        <>
          <p>Settings → <em>Offline search</em> → switch it on. The device loads a small search model (about 135 MB, once),
            and the search files of your downloaded books. Without a connection the chat page then searches those books by
            meaning, not only by words.</p>
          <Callout kind="note">On an old Android System WebView the model can't load: offline search then matches words only.
            Updating <em>Android System WebView</em> from the Play Store fixes it.</Callout>
        </>
      ),
    },
  ],
};

export const settingsChapter: ManualChapter = {
  id: 'settings',
  title: 'Settings',
  icon: SettingsOutlinedIcon,
  summary: 'Everything in the settings page, from top to bottom.',
  sections: [
    {
      id: 'page',
      title: 'The settings page',
      body: (
        <>
          <Screenshot name="settings" caption="Settings" />
          <Controls rows={[
            { label: 'User manual', text: 'This manual.' },
            { label: 'Theme', text: <>Paper, Sepia, Dark, Black, Night, and the night brightness (<ManualLink to="themes">Text and themes</ManualLink>).</> },
            { label: 'Translate into', text: 'The language translations and definitions are written in.' },
            { label: 'Computer', text: <>When your computer last synced, your projects, how to set it up (<ManualLink to="computer">The study computer</ManualLink>).</> },
            { label: 'Community', text: 'Your profile.' },
            { label: 'Reading goal', text: <>Minutes a day and on which days (<ManualLink to="stats.goal">A reading goal</ManualLink>).</> },
            { label: 'Offline search', text: <>Search downloaded books without a connection (<ManualLink to="offline.search">Offline search</ManualLink>).</> },
            { label: 'Learning', text: <>Add looked-up words to review, and the review itself (<ManualLink to="words.review">Review cards</ManualLink>).</> },
            { label: 'Dictionaries', text: <>Install and order them (<ManualLink to="words.dictionaries">Dictionaries</ManualLink>).</> },
            { label: 'On this device', text: 'Downloaded books and their size.' },
            { label: 'Sign out', text: 'At the end, with the account you are signed in with.' },
          ]} />
        </>
      ),
    },
  ],
};

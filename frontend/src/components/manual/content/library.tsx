/** Manual chapter: The library (tabs, the book cards and their menu, My shelf and collections). */
import LocalLibraryOutlinedIcon from '@mui/icons-material/LocalLibraryOutlined';
import DownloadDoneIcon from '@mui/icons-material/DownloadDone';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

export const library: ManualChapter = {
  id: 'library',
  title: 'The library',
  icon: LocalLibraryOutlinedIcon,
  summary: 'Every book of the shared library, your shelf, what you are reading and what you finished.',
  sections: [
    {
      id: 'tabs',
      title: 'The four tabs',
      body: (
        <>
          <Screenshot name="library" caption="The library: tabs, search, and the books as cards" />
          <ul>
            <li><Ui>All books</Ui>: everything in the shared library. Chips filter by category
              (e.g. <em>Literature › Science fiction</em>); the AI files new books after they're indexed.</li>
            <li><Ui>My shelf</Ui>: the books you picked to keep in sight, read or not, grouped in your own
              collections (<ManualLink to="library.shelf">below</ManualLink>).</li>
            <li><Ui>Reading</Ui>: the books you've opened, the latest first, with how far you are.</li>
            <li><Ui>Finished</Ui>: the books you marked as finished, or read to the end.</li>
          </ul>
          <p>The search box above the books finds titles and authors. The app remembers the tab you were on.</p>
        </>
      ),
    },
    {
      id: 'cards',
      title: 'A book card',
      body: (
        <>
          <p>Each card shows the cover, title, author, category, your progress, the book's language and the formats it
            comes in (<strong>EPUB</strong>, <strong>PDF</strong>, <strong>Text</strong>). Tap it to read.</p>
          <Controls rows={[
            { icon: <DownloadDoneIcon />, label: 'On this device', text: 'Downloaded: it opens offline.' },
            { icon: <CloudOffOutlinedIcon />, label: 'Not downloaded yet', text: 'Opening it once while online keeps it on the device.' },
            { icon: <span>★</span>, label: 'Score', text: 'The readers\' average score and how many reviewed it.' },
            { icon: <MoreVertIcon />, label: 'The book\'s menu', text: 'See the next section.' },
          ]} />
          <p>On <Ui>All books</Ui> and <Ui>My shelf</Ui> a cover also says <em>Reading · 35%</em> or <em>Finished ✓</em>.</p>
        </>
      ),
    },
    {
      id: 'menu',
      title: 'The book\'s menu (⋮)',
      body: (
        <>
          <Screenshot name="book-menu" caption="⋮ on a book card" />
          <Controls rows={[
            { label: 'Reviews & discussion', text: <>The book's page in the community: scores, reviews, posts (<ManualLink to="community">Community</ManualLink>).</> },
            { label: 'Collections…', text: 'Tick the collections the book is in, or make a new one for it.' },
            { label: 'Add to My shelf / Remove from My shelf', text: 'Keep it in sight on My shelf.' },
            { label: 'Add to Currently reading / Read again', text: 'Put it in the Reading tab (again).' },
            { label: 'Mark as finished', text: 'Move it to Finished.' },
            { label: 'Remove from my lists', text: 'Take it out of Reading and Finished. The book stays in the library.' },
            { label: 'Category…', text: 'Only for the reader who added the book (and admins): file it elsewhere.' },
            { label: 'Delete book…', text: 'Only for the reader who added it (and admins): removes it for everyone.' },
          ]} />
        </>
      ),
    },
    {
      id: 'shelf',
      title: 'My shelf and collections',
      body: (
        <>
          <p><strong>My shelf</strong> is your own pick of books, apart from what you're reading: the ones you want to keep
            at hand. Collections group them, e.g. <em>Uni</em>, <em>Krimis</em>, <em>To read in summer</em>.</p>
          <Screenshot name="shelf" caption="My shelf, its collections as folders" />
          <ul>
            <li>Each collection is a <strong>folder</strong>: tap it to see its books, tap ← (or Back) to close it. The books in
              no collection lie loose after the folders.</li>
            <li>Searching shows every matching book on the shelf; inside a folder, only the ones in it.</li>
            <li>The two buttons next to the search switch between <Ui>Folders</Ui> and <Ui>All books flat</Ui>. Flat, chips
              above the books filter: <Ui>All</Ui>, each collection with its count, and <Ui>Not in a collection</Ui>.</li>
            <li><Ui>Collections…</Ui> (the last tile, or the last chip) makes, renames, orders and deletes collections.
              Deleting a collection never removes its books.</li>
            <li>A book can be in several collections. Putting it in one also puts it on My shelf; taking it off My shelf
              takes it out of its collections.</li>
          </ul>
          <Callout kind="tip">All of this works offline too; the changes go to the server, in order, when you're back online.</Callout>
        </>
      ),
    },
  ],
};

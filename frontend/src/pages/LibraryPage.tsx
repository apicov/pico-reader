import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, LinearProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CategoryBrowser } from '@/components/categories';
import { CollectionChips, CollectionFolder, ManageCollectionsTile, ShelfViewToggle, type CollectionFilter,
  type ShelfView } from '@/components/collections';
import { useBookCache } from '@/hooks/useBookCache';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePolledJobs } from '@/hooks/usePolledJobs';
import { cachedCategories, inCategory, loadCategories, type Category, type CategoryFilter } from '@/services/categories';
import { ratings as fetchRatings, type RatingSummary } from '@/services/community';
import { getPref, setPref } from '@/services/prefs';
import { cachedCollections, cachedMyShelf, cachedShelf, loadCollections, loadMyShelf, loadShelf, shelfFolders, subscribeShelf,
  type Collection, type MyShelfEntry, type ShelfEntry } from '@/services/shelf';
import type { Book } from '@/services/types';
import { foldForSearch } from '@/utils/text';
import { BookCard, type IndexJob } from './library/BookCard';
import { GoalBar } from './library/GoalBar';
import { emptyMessage, shownOnShelf, type LibraryTab } from './library/libraryView';


function matches(book: Book, q: string): boolean {
  const hay = foldForSearch(`${book.title} ${book.author}`);
  return hay.includes(q);
}

export default function LibraryPage() {
  const { library, loading, error, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const files = useBookCache();
  const online = useOnlineStatus();
  // Readers' average scores, from the community
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({});
  useEffect(() => { if (online) void fetchRatings().then(setRatings).catch(() => undefined); }, [online]);
  // Books waiting for (or failing) their search index; one finished: the library gains its search file
  const { jobs: jobList } = usePolledJobs<IndexJob>(online ? '/api/index-jobs' : null, () => void refresh());
  const jobs = useMemo(() => new Map(jobList.map((j) => [j.book_id, j])), [jobList]);

  // The reader's shelf: "Currently reading" first when there's anything on it
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [mine, setMine] = useState<MyShelfEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tab, setTab] = useState<LibraryTab | null>(null);
  const [collection, setCollection] = useState<CollectionFilter>('all');
  const [shelfView, setShelfView] = useState<ShelfView>('folders');
  useEffect(() => {
    const load = () => { void cachedShelf().then(setShelf); void cachedMyShelf().then(setMine); void cachedCollections().then(setCollections); };
    load();
    void loadShelf().then(setShelf);
    void loadMyShelf().then(setMine);
    void loadCollections().then(setCollections);
    return subscribeShelf(load);
  }, [online]);
  useEffect(() => {
    void getPref<LibraryTab>('library_tab').then((saved) => setTab((t) => t ?? saved ?? null));
    void getPref<CollectionFilter>('shelf_collection').then((c) => c && setCollection(c));
    void getPref<ShelfView>('shelf_view').then((v) => v && setShelfView(v));
  }, []);
  const pickCollection = (c: CollectionFilter) => { setCollection(c); void setPref('shelf_collection', c); };
  // My shelf as folders: the open one is in the address, so Back (Android's too) closes it
  const pickShelfView = (v: ShelfView) => { setShelfView(v); void setPref('shelf_view', v); };
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const openFolder = (id: string) => setParams({ folder: id }, { state: { folder: true } });
  const closeFolder = () => {
    if ((location.state as { folder?: boolean } | null)?.folder) navigate(-1);
    else setParams({}, { replace: true });
  };
  // Categories: browse All books by them (the last choice is remembered)
  const [tree, setTree] = useState<Category[]>([]);
  const [category, setCategory] = useState<CategoryFilter>(null);
  const reloadTree = () => void loadCategories().then(setTree);
  useEffect(() => {
    void cachedCategories().then((t) => setTree((cur) => (cur.length ? cur : t)));
    reloadTree();
    void getPref<CategoryFilter>('library_category').then((c) => c !== undefined && setCategory(c ?? null));
  }, [online, library]);
  const pickCategory = (c: CategoryFilter) => { setCategory(c); void setPref('library_category', c); };
  const leafName = useMemo(() => new Map(tree.map((c) => [c.id, c.name])), [tree]);
  const byId = useMemo(() => new Map(shelf.map((e) => [e.book_id, e])), [shelf]);
  const reading = shelf.filter((e) => e.status === 'reading');
  const finished = shelf.filter((e) => e.status === 'finished');
  const current = tab ?? (reading.length ? 'reading' : 'all');
  const mineIds = useMemo(() => new Set(mine.map((e) => e.book_id)), [mine]);
  // a collection deleted (maybe on another device) shows everything again
  const shownCollection = collection === 'all' || collection === 'none' || collections.some((c) => c.id === collection) ? collection : 'all';
  const inLibrary = useMemo(() => new Set((library?.books ?? []).map((b) => b.id)), [library]);
  const collectionCounts = useMemo(() => Object.fromEntries(collections.map((c) =>
    [c.id, c.book_ids.filter((b) => inLibrary.has(b) && mineIds.has(b)).length])), [collections, inLibrary, mineIds]);
  const inSomeCollection = useMemo(() => new Set(collections.flatMap((c) => c.book_ids)), [collections]);
  const unsorted = mine.filter((e) => inLibrary.has(e.book_id) && !inSomeCollection.has(e.book_id)).length;
  const pickTab = (t: LibraryTab) => { setTab(t); void setPref('library_tab', t); if (params.has('folder')) setParams({}, { replace: true }); };
  const asFolders = current === 'mine' && shelfView === 'folders';
  const bookById = useMemo(() => new Map((library?.books ?? []).map((b) => [b.id, b])), [library]);
  const split = useMemo(() => shelfFolders(collections, mine.map((e) => e.book_id).filter((b) => inLibrary.has(b))),
    [collections, mine, inLibrary]);
  // a folder deleted (maybe on another device) shows the shelf again
  const folder = asFolders ? split.folders.find((f) => f.collection.id === params.get('folder')) : undefined;
  const showFolders = asFolders && !folder && !query.trim();

  const books = useMemo(() => {
    const q = foldForSearch(query.trim());
    const all = (library?.books ?? []).filter((b) => !q || matches(b, q));
    if (current === 'all') return all.filter(inCategory(tree, typeof category === 'number' && !tree.some((c) => c.id === category) ? null : category));
    const order = new Map((current === 'mine' ? mine : shelf.filter((e) => e.status === current)).map((e, i) => [e.book_id, i]));
    const shown = current !== 'mine' ? () => true : shownOnShelf({ asFolders, folder, topLevel: showFolders,
      collection: shownCollection, collections, inSomeCollection });
    return all.filter((b) => order.has(b.id) && shown(b.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }, [library, query, shelf, mine, current, tree, category, collections, shownCollection, inSomeCollection, asFolders, folder, showFolders]);

  return (
    <>
      {loading && <LinearProgress sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000 }} />}
      <GoalBar />
      <Tabs value={current} onChange={(_, v) => pickTab(v)} variant="scrollable" scrollButtons={false} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="all" label="All books" />
        <Tab value="mine" label={`My shelf${mine.length ? ` (${mine.length})` : ''}`} />
        <Tab value="reading" label={`Reading${reading.length ? ` (${reading.length})` : ''}`} />
        <Tab value="finished" label={`Finished${finished.length ? ` (${finished.length})` : ''}`} />
      </Tabs>
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <TextField fullWidth size="small" placeholder={folder ? `Search in ${folder.collection.name}` : 'Search title or author'} value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
        {current === 'mine' && mine.length > 0 && <ShelfViewToggle value={shelfView} onChange={pickShelfView} />}
      </Stack>
      {folder && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton size="small" aria-label="Back to My shelf" onClick={closeFolder}><ArrowBackIcon fontSize="small" /></IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }} noWrap>{folder.collection.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            · {folder.books.length} book{folder.books.length === 1 ? '' : 's'}
          </Typography>
        </Stack>
      )}
      {current === 'mine' && !asFolders && mine.length > 0 && (
        <CollectionChips collections={collections} value={shownCollection} onChange={pickCollection}
          counts={collectionCounts} unsorted={unsorted} />
      )}
      {current === 'all' && tree.length > 0 && (
        <CategoryBrowser tree={tree} value={category} onChange={pickCategory}
          uncategorised={(library?.books ?? []).filter((b) => !b.category_id).length} />
      )}
      {error && !library && (
        <Alert severity="warning" action={<Button onClick={() => void refresh()}>Retry</Button>}>{error}</Alert>
      )}
      {library && books.length === 0 && !(showFolders && mine.length) && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 6 }}>
          {emptyMessage({ libraryEmpty: library.books.length === 0, searching: !!query, inFolder: !!folder, tab: current,
            onShelf: mine.length, collection: shownCollection })}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {showFolders && mine.length > 0 && split.folders.map((f) => (
          <CollectionFolder key={f.collection.id} name={f.collection.name} files={files} online={online}
            books={f.books.map((b) => bookById.get(b)!)} onOpen={() => openFolder(f.collection.id)} />
        ))}
        {books.map((book) => <BookCard key={book.id} book={book} files={files} online={online} shelf={byId.get(book.id)}
            mine={mineIds.has(book.id)} collections={collections} badge={current === 'mine' || current === 'all'}
            job={jobs.get(book.id)} rating={ratings[book.id]} canDelete={!!book.can_change}
            category={book.category_id ? leafName.get(book.category_id) : undefined}
            onDeleted={() => void refresh()} onChanged={() => { void refresh(); reloadTree(); }} />)}
        {showFolders && mine.length > 0 && <ManageCollectionsTile collections={collections} />}
      </Box>
    </>
  );
}

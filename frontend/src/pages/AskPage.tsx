import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Alert, AppBar, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, Drawer, IconButton, InputAdornment, List, ListItemButton, ListItemText, Menu, MenuItem,
  Stack, TextField, Toolbar, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  createConversation, deleteConversation, listConversations, loadConversation, localConversations, sendMessage,
  updateConversation, type Conversation, type Message, type Passage,
} from '@/services/chat';
import { READING_FONT } from '@/theme/readingThemes';

const SIDEBAR = 300;

/** The last message without Markdown marks and citations, for the list */
const plainSnippet = (s = '') => s.replace(/\[\d+\]/g, '').replace(/[*_#>`]+/g, '').replace(/\s+/g, ' ').trim();

/** The conversation list: search, new, pick, rename, delete. */
function ConversationList({ current, onPick, onNew, refreshKey, online }: {
  current: string | null; onPick: (id: string) => void; onNew: () => void; refreshKey: number; online: boolean;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ el: HTMLElement; c: Conversation } | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const q = query.trim();
    try {
      setItems(online ? await listConversations(q) : await localConversations(q));
    } catch {
      setItems(await localConversations(q));
    }
  }, [query, online]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query, refreshKey]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack spacing={1} sx={{ p: 1.5 }}>
        <Button variant="outlined" startIcon={<AddCommentOutlinedIcon />} onClick={onNew}>New chat</Button>
        <TextField size="small" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
      </Stack>
      <List dense sx={{ overflowY: 'auto', flex: 1, pt: 0 }}>
        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {query ? 'No chat matches.' : 'No chats yet.'}
          </Typography>
        )}
        {items.map((c) => (
          <ListItemButton key={c.id} selected={c.id === current} onClick={() => onPick(c.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ el: e.currentTarget, c }); }}
            sx={{ pr: 5, position: 'relative' }}>
            <ListItemText primary={c.title || 'New chat'} secondary={plainSnippet(c.snippet)}
              slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
            <IconButton size="small" aria-label="Chat actions" disabled={!online}
              sx={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, c }); }}>
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setRenaming(menu!.c); setName(menu!.c.title); setMenu(null); }}>
          <DriveFileRenameOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Rename
        </MenuItem>
        <MenuItem onClick={() => {
          const c = menu!.c;
          setMenu(null);
          void deleteConversation(c.id).then(() => { if (c.id === current) onNew(); void load(); });
        }}>
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>
      <Dialog open={!!renaming} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rename chat</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
          <Button onClick={() => {
            const c = renaming!;
            setRenaming(null);
            void updateConversation(c.id, { title: name.trim() }).then(() => void load());
          }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function Sources({ sources, onOpen }: { sources: Passage[]; onOpen: (p: Passage) => void }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Button size="small" color="inherit" onClick={() => setOpen(!open)}
        endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />}
        sx={{ color: 'text.secondary' }}>
        {sources.length} source{sources.length > 1 ? 's' : ''}
      </Button>
      <Collapse in={open}>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {sources.map((p, i) => (
            <Card key={`${p.book_id}-${p.location}-${i}`}>
              <CardActionArea onClick={() => onOpen(p)}>
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Typography variant="caption" color="text.secondary">[{i + 1}] {p.title}{p.heading ? ` · ${p.heading}` : ''}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: READING_FONT, mt: 0.25 }}>
                    {p.text.length > 260 ? `${p.text.slice(0, 260)}…` : p.text}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

const newId = () => `c-${crypto.randomUUID()}`;

/** Chat with the library: follow-up questions use the conversation so far; chats are kept on the server. */
export default function AskPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const online = useOnlineStatus();
  const { library } = useLibrary();
  const indexed = useMemo(() => (library?.books ?? []).filter((b) => b.index), [library]);

  const [drawer, setDrawer] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [scope, setScope] = useState<string[] | null>(null); // for a chat not created yet
  const [scopeMenu, setScopeMenu] = useState<HTMLElement | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const creating = useRef<string | null>(null); // a chat made by the first message: already on screen

  // Open the chat in the address, or a new one
  useEffect(() => {
    setError('');
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      return;
    }
    if (conversation?.id === conversationId || creating.current === conversationId) return;
    void loadConversation(conversationId, online).then((res) => {
      if (!res) { setError("This chat isn't on this device."); return; }
      setConversation(res.conversation);
      setMessages(res.messages);
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, online]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const openPassage = (p: Passage) => navigate(`/read/${encodeURIComponent(p.book_id)}?${new URLSearchParams({
    format: p.format, location: p.location, progress: String(p.progress) })}`);

  const activeScope = conversation ? conversation.book_ids : scope;
  const scopeLabel = activeScope?.length
    ? indexed.filter((b) => activeScope.includes(b.id)).map((b) => b.title).join(', ') || 'One book'
    : 'All books';

  const pickScope = async (bookId: string | null) => {
    setScopeMenu(null);
    if (!conversation) { setScope(bookId ? [bookId] : null); return; }
    setConversation(await updateConversation(conversation.id, bookId ? { book_ids: [bookId] } : { all_books: true }));
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const content = input.trim();
    if (!content || busy || !online) return;
    setBusy(true);
    setError('');
    setInput('');
    let convo = conversation;
    try {
      if (!convo) {
        const id = newId();
        creating.current = id;
        convo = await createConversation(id, scope);
        setConversation(convo);
        navigate(`/ask/${convo.id}`, { replace: true });
      }
      const now = new Date().toISOString();
      const pending: Message = { id: -1, role: 'assistant', content: '', sources: [], created_at: now };
      setMessages((m) => [...m, { id: -2, role: 'user', content, sources: [], created_at: now }, pending]);
      const update = (patch: Partial<Message>) => setMessages((m) => m.map((x) => (x.id === -1 ? { ...x, ...patch } : x)));
      let text = '';
      const { title } = await sendMessage(convo.id, content, {
        onSources: (sources) => update({ sources }),
        onDelta: (piece) => { text += piece; update({ content: text }); },
      });
      if (title && !convo.title) setConversation({ ...convo, title });
      // replace the provisional messages with the stored ones (real ids, for the offline copy)
      const saved = await loadConversation(convo.id, true);
      if (saved) setMessages(saved.messages);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => m.filter((x) => x.id !== -1));
    } finally {
      setBusy(false);
    }
  };

  const list = (
    <ConversationList current={conversation?.id ?? null} refreshKey={refreshKey} online={online}
      onPick={(id) => { setDrawer(false); navigate(`/ask/${id}`); }}
      onNew={() => { setDrawer(false); setScope(null); navigate('/ask'); }} />
  );

  return (
    <Box sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, display: 'flex', flexDirection: 'column',
      bgcolor: 'background.default' }}>
      <AppBar position="static" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" aria-label="Back to the library" onClick={() => navigate('/')}><ArrowBackIcon /></IconButton>
          {!wide && <IconButton aria-label="Chats" onClick={() => setDrawer(true)}><MenuIcon /></IconButton>}
          <Typography noWrap sx={{ flex: 1, mx: 1, fontSize: 15 }}>{conversation?.title || 'Ask your library'}</Typography>
          <Tooltip title="Which books to search">
            <Button size="small" color="inherit" startIcon={<LibraryBooksOutlinedIcon />} onClick={(e) => setScopeMenu(e.currentTarget)}
              sx={{ maxWidth: 180, '& .MuiButton-startIcon': { flex: 'none' } }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scopeLabel}</Box>
            </Button>
          </Tooltip>
          <Menu anchorEl={scopeMenu} open={!!scopeMenu} onClose={() => setScopeMenu(null)}>
            <MenuItem selected={!activeScope?.length} onClick={() => void pickScope(null)}>All books</MenuItem>
            {indexed.map((b) => (
              <MenuItem key={b.id} selected={activeScope?.includes(b.id)} onClick={() => void pickScope(b.id)}>{b.title}</MenuItem>
            ))}
          </Menu>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {wide ? (
          <Box sx={{ width: SIDEBAR, flex: 'none', borderRight: 1, borderColor: 'divider' }}>{list}</Box>
        ) : (
          <Drawer open={drawer} onClose={() => setDrawer(false)} slotProps={{ paper: { sx: { width: SIDEBAR, maxWidth: '85vw', pt: 'env(safe-area-inset-top)' } } }}>
            {list}
          </Drawer>
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 3 }}>
            <Box sx={{ maxWidth: 760, mx: 'auto' }}>
              {messages.length === 0 && !error && (
                <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: { xs: 4, md: 10 } }}>
                  <Typography variant="h5" sx={{ fontFamily: READING_FONT, color: 'text.primary', mb: 1 }}>Ask your library</Typography>
                  <Typography variant="body2">
                    Questions in any language about your books; follow-up questions use the conversation so far.
                  </Typography>
                  {library && indexed.length === 0 && (
                    <Alert severity="info" sx={{ mt: 3, textAlign: 'left' }}>
                      No book is indexed yet: run <code>reader index --all</code> on your computer.
                    </Alert>
                  )}
                </Box>
              )}
              <Stack spacing={2.5}>
                {messages.map((m, i) => m.role === 'user' ? (
                  <Box key={`${m.id}-${i}`} sx={{ alignSelf: 'flex-end', maxWidth: '85%', bgcolor: 'action.hover',
                    px: 2, py: 1.25, borderRadius: 3, borderBottomRightRadius: 6, whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </Box>
                ) : (
                  <Box key={`${m.id}-${i}`} sx={{ fontFamily: READING_FONT, fontSize: 17, lineHeight: 1.6 }}>
                    {m.content ? (
                      <Markdown text={m.content} onCite={(n) => m.sources[n - 1] && openPassage(m.sources[n - 1])} />
                    ) : (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', fontSize: 14 }}>
                        <CircularProgress size={14} />
                        <span>{m.sources.length ? 'Writing…' : 'Searching your books…'}</span>
                      </Stack>
                    )}
                    {(m.id !== -1 || !busy) && <Sources sources={m.sources} onOpen={openPassage} />}
                  </Box>
                ))}
              </Stack>
              {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
              <div ref={endRef} />
            </Box>
          </Box>
          <Box component="form" onSubmit={send} sx={{ px: 2, pt: 1, pb: 'calc(12px + env(safe-area-inset-bottom))',
            borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ maxWidth: 760, mx: 'auto' }}>
              <TextField fullWidth multiline maxRows={6} value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={online ? (messages.length ? 'Ask a follow-up…' : 'Ask about your books…') : 'Asking needs a connection'}
                disabled={!online}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                slotProps={{ input: { sx: { borderRadius: 3 }, endAdornment: (
                  <InputAdornment position="end">
                    <IconButton type="submit" aria-label="Send" disabled={busy || !online || !input.trim()} color="primary">
                      {busy ? <CircularProgress size={20} /> : <ArrowUpwardIcon />}
                    </IconButton>
                  </InputAdornment>
                ) } }} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

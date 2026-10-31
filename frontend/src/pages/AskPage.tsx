import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, AppBar, Box, Button, CircularProgress, Drawer, IconButton, InputAdornment, Menu, MenuItem, Stack, TextField,
  Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/TopBar';
import { useLibrary } from '@/hooks/useLibrary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readerPath } from '@/reader/jump';
import { OfflineSearchPanel } from '@/search/OfflineSearchPanel';
import { createConversation, decideAction, loadConversation, updateConversation, type ChatLink, type Conversation,
  type Message, type Passage } from '@/services/chat';
import { downloadExport } from '@/services/download';
import { READING_FONT } from '@/theme/readingThemes';
import { AssistantMessage, UserBubble } from './ask/ChatMessage';
import { ConversationList } from './ask/ConversationList';
import { PENDING_ANSWER, streamAnswer } from './ask/streamAnswer';

const SIDEBAR = 300;

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
  // for a chat not created yet; opened from a book, it asks about that book
  const location = useLocation();
  const startBook = (location.state as { bookId?: string } | null)?.bookId;
  const [scope, setScope] = useState<string[] | null>(startBook ? [startBook] : null);
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

  const openLink = (l: ChatLink) => {
    if (l.kind === 'download' && l.path) { void downloadExport(l.path, l.filename ?? 'download').catch((e) => setError((e as Error).message)); return; }
    if (!l.book_id) return;
    navigate(readerPath(l.book_id, l));
  };

  const decide = async (actionId: string, approve: boolean) => {
    if (!conversation) return;
    try {
      const outcome = await decideAction(conversation.id, actionId, approve);
      // the stored chat has the action's outcome (done, cancelled, or failed) and the message saying it
      const saved = await loadConversation(conversation.id, true);
      setMessages((ms) => saved?.messages ?? [...ms, outcome]);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openPassage = (p: Passage) => navigate(readerPath(p.book_id, p));

  const activeScope = conversation ? conversation.book_ids : scope;
  const scopeLabel = activeScope?.length
    ? indexed.filter((b) => activeScope.includes(b.id)).map((b) => b.title).join(', ') || 'One book'
    : 'All books';

  const pickScope = async (bookId: string | null) => {
    setScopeMenu(null);
    if (!conversation) { setScope(bookId ? [bookId] : null); return; }
    try {
      setConversation(await updateConversation(conversation.id, bookId ? { book_ids: [bookId] } : { all_books: true }));
    } catch (e) {
      setError((e as Error).message);
    }
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
      const { title } = await streamAnswer(convo.id, content, setMessages);
      if (title && !convo.title) setConversation({ ...convo, title });
      // replace the provisional messages with the stored ones (real ids, for the offline copy)
      const saved = await loadConversation(convo.id, true);
      if (saved) setMessages(saved.messages);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => m.filter((x) => x.id !== PENDING_ANSWER));
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
        <TopBar />
        {/* the chat's own bar */}
        <Toolbar variant="dense" sx={{ borderTop: 1, borderColor: 'divider' }}>
          {!wide && <IconButton edge="start" aria-label="Chats" onClick={() => setDrawer(true)}><MenuIcon /></IconButton>}
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
              {!online && (
                <Box sx={{ mb: 3 }}>
                  <OfflineSearchPanel books={library?.books ?? []} onOpen={openPassage} />
                </Box>
              )}
              {messages.length === 0 && !error && online && (
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
                {messages.map((m, i) => m.role === 'user'
                  ? <UserBubble key={`${m.id}-${i}`} text={m.content} />
                  : <AssistantMessage key={`${m.id}-${i}`} message={m} streaming={m.id === PENDING_ANSWER && busy} online={online}
                      onPassage={openPassage} onLink={openLink} onDecide={(actionId, approve) => void decide(actionId, approve)} />)}
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

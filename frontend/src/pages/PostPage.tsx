import { useState } from 'react';
import { Alert, Box, Button, Divider, FormControlLabel, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { AuthorLine, BookLink, LikeButton, Loading, NeedsConnection, QuoteCard, Spoiler } from '@/components/community/parts';
import { useAuth } from '@/contexts/AuthContext';
import { useLoad } from '@/hooks/useLoad';
import { addComment, deleteComment, deletePost, editComment, getPost, setHidden, type Comment, type HideKind } from '@/services/community';

/** Author or admin actions on one thing: edit (author), delete (author or admin), hide (admin). */
function ItemMenu({ mine, kind, id, hidden, onEdit, onDelete, onChanged }: {
  mine: boolean; kind: HideKind; id: string; hidden: boolean;
  onEdit?: () => void; onDelete: () => Promise<void>; onChanged: () => void;
}) {
  const { reader } = useAuth();
  const admin = !!reader?.is_admin;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!mine && !admin) return null;
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton size="small" aria-label="More" onClick={(e) => setAnchor(e.currentTarget)}><MoreHorizIcon fontSize="small" /></IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        {mine && onEdit && <MenuItem onClick={() => { close(); onEdit(); }}>Edit</MenuItem>}
        {admin && <MenuItem onClick={() => { close(); void setHidden(kind, id, !hidden).then(onChanged); }}>
          {hidden ? 'Show again (admin)' : 'Hide from everyone (admin)'}
        </MenuItem>}
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          close();
          if (window.confirm('Delete this for everyone?')) void onDelete();
        }}>Delete</MenuItem>
      </Menu>
    </>
  );
}

function CommentForm({ initial, submitLabel, onSubmit, onCancel, autoFocus }: {
  initial?: { body: string; spoiler: boolean }; submitLabel: string; autoFocus?: boolean;
  onSubmit: (c: { body: string; spoiler: boolean }) => Promise<void>; onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial?.body ?? '');
  const [spoiler, setSpoiler] = useState(initial?.spoiler ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit({ body: body.trim(), spoiler });
      setBody('');
      setSpoiler(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box>
      <TextField value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" multiline minRows={2}
        fullWidth size="small" autoFocus={autoFocus} inputProps={{ maxLength: 5000 }} />
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
        <FormControlLabel control={<Switch size="small" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />}
          label={<Typography variant="body2">Spoiler</Typography>} />
        <Box sx={{ flex: 1 }} />
        {onCancel && <Button size="small" color="inherit" onClick={onCancel}>Cancel</Button>}
        <Button size="small" variant="contained" disabled={busy || !body.trim()} onClick={() => void send()}>{submitLabel}</Button>
      </Stack>
    </Box>
  );
}

function CommentView({ comment, postId, onChanged, replyTo }: {
  comment: Comment; postId: string; onChanged: (all?: Comment[]) => void; replyTo?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  if (comment.deleted || (comment.hidden && !comment.author)) {
    return <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
      {comment.deleted ? 'Comment deleted' : 'Comment hidden'}
    </Typography>;
  }
  return (
    <Box sx={{ py: 1, opacity: comment.hidden ? 0.5 : 1 }}>
      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AuthorLine author={comment.author} when={comment.created_at}
            extra={comment.edited && <Typography variant="caption" color="text.secondary"> · edited</Typography>} />
        </Box>
        <ItemMenu mine={comment.mine} kind="comment" id={comment.id} hidden={comment.hidden} onEdit={() => setEditing(true)}
          onDelete={() => deleteComment(comment.id).then(() => onChanged())} onChanged={() => onChanged()} />
      </Stack>
      <Box sx={{ pl: 4.5 }}>
        {editing ? (
          <CommentForm initial={comment} submitLabel="Save" autoFocus onCancel={() => setEditing(false)}
            onSubmit={async (c) => { onChanged(await editComment(comment.id, c)); setEditing(false); }} />
        ) : (
          <Spoiler on={comment.spoiler}><Markdown text={comment.body} sx={{ fontSize: 15 }} /></Spoiler>
        )}
        <Stack direction="row" alignItems="center">
          <LikeButton kind="comment" id={comment.id} likes={comment.likes} liked={comment.liked_by_me} />
          <Button size="small" color="inherit" sx={{ color: 'text.secondary' }} onClick={() => setReplying(!replying)}>Reply</Button>
        </Stack>
        {replying && (
          <CommentForm submitLabel="Reply" autoFocus onCancel={() => setReplying(false)}
            onSubmit={async (c) => { onChanged(await addComment(postId, { ...c, parent_id: replyTo ?? comment.id })); setReplying(false); }} />
        )}
      </Box>
    </Box>
  );
}

function PostView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: post, setData, error, reload } = useLoad(() => getPost(id), [id]);
  if (!post) return <Loading error={error} retry={() => void reload()} />;
  const setComments = (comments?: Comment[]) => {
    if (comments) setData({ ...post, comments, comment_count: comments.filter((c) => !c.deleted).length });
    else void reload();
  };
  const top = post.comments.filter((c) => !c.parent_id);
  const replies = (cid: string) => post.comments.filter((c) => c.parent_id === cid);
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }} />
        <ItemMenu mine={post.mine} kind="post" id={post.id} hidden={post.hidden}
          onEdit={() => navigate(`/community/post/${post.id}/edit`)}
          onDelete={() => deletePost(post.id).then(() => navigate('/community', { replace: true }))}
          onChanged={() => void reload()} />
      </Stack>
      <AuthorLine author={post.author} when={post.created_at}
        extra={post.edited && <Typography variant="caption" color="text.secondary"> · edited</Typography>} />
      <Typography variant="h5" sx={{ mt: 1.5, mb: 1, lineHeight: 1.25 }}>{post.title}{post.hidden && ' (hidden)'}</Typography>
      {post.books.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          {post.books.map((b) => <BookLink key={b.id} book={b} />)}
        </Stack>
      )}
      {post.quotes.map((q, i) => <QuoteCard key={i} quote={q} />)}
      {post.body && <Markdown text={post.body} sx={{ fontSize: 16, lineHeight: 1.6 }} />}
      <Stack direction="row" sx={{ mt: 1 }}>
        <LikeButton kind="post" id={post.id} likes={post.likes} liked={post.liked_by_me} />
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {post.comment_count ? `${post.comment_count} comment${post.comment_count === 1 ? '' : 's'}` : 'No comments yet'}
      </Typography>
      <CommentForm submitLabel="Comment" onSubmit={async (c) => setComments(await addComment(post.id, c))} />
      <Box sx={{ mt: 1 }}>
        {top.map((c) => (
          <Box key={c.id}>
            <CommentView comment={c} postId={post.id} onChanged={setComments} />
            {replies(c.id).length > 0 && (
              <Box sx={{ ml: 4.5, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
                {replies(c.id).map((r) => (
                  <CommentView key={r.id} comment={r} postId={post.id} replyTo={c.id} onChanged={setComments} />
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function PostPage() {
  const { postId } = useParams();
  return <NeedsConnection>{postId && <PostView id={postId} />}</NeedsConnection>;
}

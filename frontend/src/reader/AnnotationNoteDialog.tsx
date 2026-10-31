import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { updateAnnotation, type Annotation } from '@/services/annotations';

/** The reader's note on a highlight or bookmark (open while `annotation` is set) */
export function AnnotationNoteDialog({ annotation, onClose }: { annotation: Annotation | null; onClose: () => void }) {
  const [text, setText] = useState('');
  useEffect(() => { if (annotation) setText(annotation.note); }, [annotation]);
  const save = () => {
    if (annotation) void updateAnnotation(annotation.id, { note: text.trim() });
    onClose();
  };
  return (
    <Dialog open={!!annotation} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Note</DialogTitle>
      <DialogContent>
        {annotation?.kind === 'highlight' && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontStyle: 'italic' }}>“{annotation.text}”</Typography>
        )}
        <TextField autoFocus fullWidth multiline minRows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

import { Typography } from '@mui/material';
import { useParams } from 'react-router-dom';

// Phase 2–3: download to the book cache, then the PDF / EPUB / mdbook renderers
export default function ReaderPage() {
  const { bookId } = useParams();
  return <Typography color="text.secondary">Reader for {bookId} comes next.</Typography>;
}

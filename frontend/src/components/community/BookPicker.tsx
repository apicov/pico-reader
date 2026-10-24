import { Autocomplete, TextField } from '@mui/material';
import { useLibrary } from '@/hooks/useLibrary';
import type { Book } from '@/services/types';

/** Choose books from the library (search by title or author). */
export function BookPicker({ value, onChange, label = 'About these books', multiple = true }: {
  value: string[]; onChange: (ids: string[]) => void; label?: string; multiple?: boolean;
}) {
  const { library } = useLibrary();
  const books = library?.books ?? [];
  const byId = new Map(books.map((b) => [b.id, b]));
  const chosen = value.map((id) => byId.get(id)).filter((b): b is Book => !!b);
  return (
    <Autocomplete<Book, true>
      multiple
      options={books}
      value={chosen}
      onChange={(_, v) => onChange(multiple ? v.map((b) => b.id) : v.slice(-1).map((b) => b.id))}
      getOptionLabel={(b) => b.author ? `${b.title} — ${b.author}` : b.title}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterSelectedOptions
      renderInput={(params) => <TextField {...params} label={label} placeholder={chosen.length ? '' : 'Search the library'} />}
    />
  );
}

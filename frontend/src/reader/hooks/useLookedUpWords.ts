import { useEffect, useState } from 'react';
import { cachedLookedUpWords, lookedUpWords, subscribeLookedUp } from '@/services/words';

/** The words looked up before in `language` (underlined in the book, and its "Words" tab); null until loaded. A
 *  lookup, or a word marked known, changes them at once. */
export function useLookedUpWords(language: string | undefined): Set<string> | null {
  const [words, setWords] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!language) return;
    void lookedUpWords(language).then(setWords);
    return subscribeLookedUp((changed) => {
      if (changed === language) void cachedLookedUpWords(language).then(setWords);
    });
  }, [language]);
  return words;
}

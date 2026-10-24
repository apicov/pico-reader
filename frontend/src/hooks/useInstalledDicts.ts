import { useEffect, useState } from 'react';
import { installedDicts, subscribeDicts, type InstalledDict } from '@/dict/store';

export function useInstalledDicts(): Record<string, InstalledDict> {
  const [dicts, setDicts] = useState<Record<string, InstalledDict>>({});
  useEffect(() => {
    const load = () => void installedDicts().then(setDicts);
    load();
    return subscribeDicts(load);
  }, []);
  return dicts;
}

import { useEffect, useState } from 'react';
import { isOnline, subscribeOnline } from '@/services/connectivity';

/** Online or offline, re-rendering when it changes (services/connectivity). It's the device's connection, not
 *  whether the server can be reached: on a Wi-Fi without internet it still says online. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(isOnline());
  useEffect(() => subscribeOnline(setOnline), []);
  return online;
}

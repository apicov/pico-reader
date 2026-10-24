/** Files made by the backend (exports): saved by the browser on the web, handed to Android's share sheet
 *  in the app (e.g. straight into AnkiDroid). */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { Share } from '@capacitor/share';
import { ApiError, getToken } from '@/services/api';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export async function downloadExport(path: string, filename: string): Promise<void> {
  const token = await getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: filename });
    await FileTransfer.downloadFile({ url: API_URL + path, path: uri, headers });
    await Share.share({ title: filename, files: [uri] });
    return;
  }
  const res = await fetch(API_URL + path, { headers });
  if (!res.ok) {
    const detail = await res.json().then((d) => d.detail).catch(() => null);
    throw new ApiError(res.status, typeof detail === 'string' ? detail : `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

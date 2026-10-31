/** Files made by the backend (exports): saved by the browser on the web, handed to Android's share sheet
 *  in the app (e.g. straight into AnkiDroid). */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { Share } from '@capacitor/share';
import { apiUrl, authFetch, errorFrom, getToken } from '@/services/api';

export async function downloadExport(path: string, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const token = await getToken();
    const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: filename });
    await FileTransfer.downloadFile({ url: apiUrl(path), path: uri, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    await Share.share({ title: filename, files: [uri] });
    return;
  }
  const res = await authFetch(path);
  if (!res.ok) throw await errorFrom(res, 'Download failed');
  saveInBrowser(await res.blob(), filename);
}

/** Text made on the device (a note as .md): saved by the browser, or handed to Android's share sheet. */
export async function exportText(text: string, filename: string, type = 'text/markdown'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path: filename, data: text, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [uri] });
    return;
  }
  saveInBrowser(new Blob([text], { type }), filename);
}

/** The browser saves the file (its download) */
function saveInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // after the browser has taken it
}

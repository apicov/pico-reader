/** Android store: files in the app's data folder, downloaded by the native FileTransfer plugin. */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { FileStore } from './index';

const path = (name: string) => `books/${name}`;

export const nativeStore: FileStore = {
  async save(name, url, size, onProgress) {
    const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: path(name) });
    const listener = onProgress
      ? await FileTransfer.addListener('progress', (p) => {
          if (p.url === url) onProgress(Math.min(1, p.bytes / (p.lengthComputable ? p.contentLength : size)));
        })
      : null;
    try {
      // a .part file first, so an interrupted download never looks complete
      await Filesystem.mkdir({ directory: Directory.Data, path: path(name).replace(/\/[^/]+$/, ''), recursive: true })
        .catch(() => undefined);
      await FileTransfer.downloadFile({ url, path: `${uri}.part`, progress: !!onProgress });
      await Filesystem.rename({ directory: Directory.Data, from: `${path(name)}.part`, to: path(name) });
    } finally {
      await listener?.remove();
    }
  },
  async url(name) {
    const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: path(name) });
    return Capacitor.convertFileSrc(uri);
  },
  async blob(name) {
    const res = await fetch(await this.url(name));
    if (!res.ok) throw new Error('Not on this device');
    return res.blob();
  },
  async remove(name) {
    await Filesystem.deleteFile({ directory: Directory.Data, path: path(name) }).catch(() => undefined);
  },
};

import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

// jsdom's Blob/File lack text() and arrayBuffer(); Node's have them
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

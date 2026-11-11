import type { CloudConfig, SongFileType } from '../types/models';

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PPT_MIME = 'application/vnd.ms-powerpoint';

export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function cleanSongTitleFromFilename(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  return withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled Song';
}

export function matchesSongTitle(song: { title: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return song.title.toLowerCase().includes(q);
}

export function sanitizeStorageFileName(fileName: string): string {
  return fileName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

export function detectFileType(file: { name: string; type: string }): SongFileType | null {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    name.endsWith('.pptx') ||
    name.endsWith('.ppsx') ||
    mime.includes('presentationml.presentation') ||
    mime.includes('presentationml.slideshow')
  ) {
    return 'pptx';
  }
  if (
    name.endsWith('.ppt') ||
    name.endsWith('.pps') ||
    mime === PPT_MIME ||
    mime === 'application/mspowerpoint' ||
    mime === 'application/powerpoint' ||
    mime === 'application/x-mspowerpoint'
  ) {
    return 'ppt';
  }
  if (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif)$/i.test(name)
  ) {
    return 'image';
  }
  return null;
}

export function isPowerPointType(fileType: SongFileType): boolean {
  return fileType === 'ppt' || fileType === 'pptx';
}

export function defaultMimeForFileType(fileType: SongFileType): string {
  if (fileType === 'pdf') return 'application/pdf';
  if (fileType === 'pptx') return PPTX_MIME;
  if (fileType === 'ppt') return PPT_MIME;
  return 'image/png';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const sliceSize = 8192;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const chunk = bytes.subarray(i, i + sliceSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function parseFirebaseConfigSnippet(raw: string): Partial<CloudConfig> | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.apiKey === 'string' && typeof parsed.projectId === 'string') {
      return {
        apiKey: parsed.apiKey.trim(),
        authDomain: typeof parsed.authDomain === 'string' ? parsed.authDomain.trim() : undefined,
        projectId: parsed.projectId.trim(),
        storageBucket:
          typeof parsed.storageBucket === 'string' ? parsed.storageBucket.trim() : undefined,
        messagingSenderId:
          typeof parsed.messagingSenderId === 'string'
            ? parsed.messagingSenderId.trim()
            : undefined,
        appId: typeof parsed.appId === 'string' ? parsed.appId.trim() : undefined,
      };
    }
  } catch {
    // Fallback to JS object snippet extraction
  }

  const pick = (key: string): string | undefined => {
    const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
    const match = text.match(re);
    return match?.[1]?.trim();
  };

  const apiKey = pick('apiKey');
  const projectId = pick('projectId');
  const appId = pick('appId');
  if (!apiKey && !projectId) return null;

  return {
    apiKey,
    authDomain: pick('authDomain'),
    projectId,
    storageBucket: pick('storageBucket'),
    messagingSenderId: pick('messagingSenderId'),
    appId,
  };
}

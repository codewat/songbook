import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  LEGACY_DEFAULT_FOLDER_IDS,
  UNFILED_FOLDER_ID,
  type CloudConfig,
  type Folder,
  type LocalBlobRecord,
  type OutboxAction,
  type OutboxEntity,
  type OutboxOp,
  type Playlist,
  type PlaylistItem,
  type Song,
  type StagePreferences,
} from '../types/models';
import {
  cleanSongTitleFromFilename,
  createUuid,
  defaultMimeForFileType,
  detectFileType,
  sanitizeStorageFileName,
} from '../utils/format';

export const DB_NAME = 'worshipdeck-songbook-db';
export const DB_VERSION = 1;

interface SongbookDB extends DBSchema {
  folders: {
    key: string;
    value: Folder;
  };
  songs: {
    key: string;
    value: Song;
    indexes: { 'by-folder': string };
  };
  blobs: {
    key: string;
    value: LocalBlobRecord;
  };
  playlists: {
    key: string;
    value: Playlist;
  };
  playlistItems: {
    key: string;
    value: PlaylistItem;
    indexes: { 'by-playlist': string; 'by-song': string };
  };
  outbox: {
    key: string;
    value: OutboxOp;
    indexes: { 'by-entity': [OutboxEntity, string] };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<SongbookDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<SongbookDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SongbookDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('songs')) {
          const songStore = db.createObjectStore('songs', { keyPath: 'id' });
          songStore.createIndex('by-folder', 'folderId');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'songId' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('playlistItems')) {
          const itemStore = db.createObjectStore('playlistItems', { keyPath: 'id' });
          itemStore.createIndex('by-playlist', 'playlistId');
          itemStore.createIndex('by-song', 'songId');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('by-entity', ['entity', 'entityId']);
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function resetDbConnectionForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

const LEGACY_DEFAULT_FOLDER_SET = new Set<string>(LEGACY_DEFAULT_FOLDER_IDS);

export function isLegacyDefaultFolderId(folderId: string): boolean {
  return LEGACY_DEFAULT_FOLDER_SET.has(folderId);
}

/**
 * Migrate any existing songs out of the removed legacy default folders
 * (`1. Chords` and `2. Lyrics`) into `All Songs` (`UNFILED_FOLDER_ID`)
 * and remove/soft-delete those two legacy folders without losing files.
 */
export async function cleanupLegacyDefaultFolders(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  for (const legacyId of LEGACY_DEFAULT_FOLDER_IDS) {
    const legacySongs = await db.getAllFromIndex('songs', 'by-folder', legacyId);
    for (const song of legacySongs) {
      if (!song.deletedAt) {
        const migrated: Song = {
          ...song,
          folderId: UNFILED_FOLDER_ID,
          updatedAt: now,
        };
        await db.put('songs', migrated);
        await enqueueOutbox('song', song.id, 'upsert');
      }
    }

    const legacyFolder = await db.get('folders', legacyId);
    if (!legacyFolder) continue;

    if (!legacyFolder.syncedAt) {
      const existingOp = await db.getFromIndex('outbox', 'by-entity', ['folder', legacyId]);
      if (existingOp) await db.delete('outbox', existingOp.id);
      await db.delete('folders', legacyId);
    } else if (!legacyFolder.deletedAt) {
      await db.put('folders', {
        ...legacyFolder,
        deletedAt: now,
        updatedAt: now,
      });
      await enqueueOutbox('folder', legacyId, 'delete');
    }
  }
}

async function enqueueOutbox(
  entity: OutboxEntity,
  entityId: string,
  action: OutboxAction
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('outbox', 'readwrite');
  const existing = await tx.store.index('by-entity').get([entity, entityId]);
  const now = new Date().toISOString();
  if (existing) {
    await tx.store.put({
      ...existing,
      action,
      createdAt: now,
      lastError: null,
    });
  } else {
    await tx.store.put({
      id: createUuid(),
      entity,
      entityId,
      action,
      createdAt: now,
      retryCount: 0,
      lastError: null,
    });
  }
  await tx.done;
}

// ---------------- FOLDERS ----------------

export async function getActiveFolders(): Promise<Folder[]> {
  await cleanupLegacyDefaultFolders();
  const db = await getDb();
  const all = await db.getAll('folders');
  return all
    .filter((f) => !f.deletedAt && !isLegacyDefaultFolderId(f.id))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
}

export async function createFolder(name: string): Promise<Folder> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  const db = await getDb();
  const now = new Date().toISOString();
  const folder: Folder = {
    id: createUuid(),
    name: trimmed,
    isDefault: false,
    sortOrder: 100,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncedAt: null,
  };
  await db.put('folders', folder);
  await enqueueOutbox('folder', folder.id, 'upsert');
  return folder;
}

export async function renameFolder(folderId: string, newName: string): Promise<Folder> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  const db = await getDb();
  const folder = await db.get('folders', folderId);
  if (!folder || folder.deletedAt) throw new Error('Folder not found.');
  const updated: Folder = {
    ...folder,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  };
  await db.put('folders', updated);
  await enqueueOutbox('folder', updated.id, 'upsert');
  return updated;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  const folder = await db.get('folders', folderId);
  if (!folder) return;

  const folderSongs = await db.getAllFromIndex('songs', 'by-folder', folderId);
  for (const song of folderSongs) {
    if (!song.deletedAt) {
      await deleteSong(song.id);
    }
  }

  const now = new Date().toISOString();
  if (!folder.syncedAt) {
    const existingOp = await db.getFromIndex('outbox', 'by-entity', ['folder', folderId]);
    if (existingOp) await db.delete('outbox', existingOp.id);
    await db.delete('folders', folderId);
  } else {
    await db.put('folders', {
      ...folder,
      deletedAt: now,
      updatedAt: now,
    });
    await enqueueOutbox('folder', folderId, 'delete');
  }
}

// ---------------- SONGS / FILES ----------------

export async function getActiveSongs(folderId?: string): Promise<Song[]> {
  const db = await getDb();
  const all = folderId
    ? await db.getAllFromIndex('songs', 'by-folder', folderId)
    : await db.getAll('songs');
  return all
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getSongById(songId: string): Promise<Song | undefined> {
  const db = await getDb();
  return db.get('songs', songId);
}

export interface AddSongInput {
  file: File;
  folderId: string;
  title?: string;
  songKey?: string;
  tempo?: string;
  notes?: string;
}

export async function addSongFile(input: AddSongInput): Promise<Song> {
  const fileType = detectFileType(input.file);
  if (!fileType) {
    throw new Error(
      `Unsupported file "${input.file.name}". Please upload PDF, Image, or PowerPoint (.ppt / .pptx) files.`
    );
  }

  const db = await getDb();
  const songId = createUuid();
  const now = new Date().toISOString();
  const targetFolderId = (input.folderId || '').trim() || UNFILED_FOLDER_ID;
  const fallbackExt =
    fileType === 'pdf'
      ? 'pdf'
      : fileType === 'pptx'
        ? 'pptx'
        : fileType === 'ppt'
          ? 'ppt'
          : 'png';
  const safeName = sanitizeStorageFileName(input.file.name || `song.${fallbackExt}`);
  const mimeType = input.file.type || defaultMimeForFileType(fileType);

  const song: Song = {
    id: songId,
    folderId: targetFolderId,
    title: (input.title || '').trim() || cleanSongTitleFromFilename(input.file.name),
    fileName: input.file.name,
    fileType,
    mimeType,
    fileSize: input.file.size,
    storagePath: `${targetFolderId}/${songId}_${safeName}`,
    songKey: input.songKey?.trim() || null,
    tempo: input.tempo?.trim() || null,
    notes: input.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncedAt: null,
  };

  // Store actual bytes in IndexedDB so it is immediately saved offline
  const buffer = await input.file.arrayBuffer();
  const offlineBlob = new Blob([buffer], { type: mimeType });

  await db.put('blobs', {
    songId: song.id,
    blob: offlineBlob,
    mimeType,
    size: offlineBlob.size,
    cachedAt: now,
  });
  await db.put('songs', song);
  await enqueueOutbox('song', song.id, 'upsert');

  return song;
}

export async function updateSongMeta(
  songId: string,
  updates: Partial<Pick<Song, 'title' | 'folderId' | 'songKey' | 'tempo' | 'notes'>>
): Promise<Song> {
  const db = await getDb();
  const existing = await db.get('songs', songId);
  if (!existing || existing.deletedAt) throw new Error('Song not found.');

  const updated: Song = {
    ...existing,
    title: updates.title !== undefined ? updates.title.trim() || existing.title : existing.title,
    folderId: updates.folderId !== undefined ? updates.folderId : existing.folderId,
    songKey: updates.songKey !== undefined ? updates.songKey?.trim() || null : existing.songKey,
    tempo: updates.tempo !== undefined ? updates.tempo?.trim() || null : existing.tempo,
    notes: updates.notes !== undefined ? updates.notes?.trim() || null : existing.notes,
    updatedAt: new Date().toISOString(),
  };

  await db.put('songs', updated);
  await enqueueOutbox('song', updated.id, 'upsert');
  return updated;
}

export async function deleteSong(songId: string): Promise<void> {
  const db = await getDb();
  const song = await db.get('songs', songId);
  if (!song) return;

  const now = new Date().toISOString();

  // Remove or soft-delete playlist references
  const refs = await db.getAllFromIndex('playlistItems', 'by-song', songId);
  for (const item of refs) {
    if (!item.deletedAt) {
      if (!item.syncedAt) {
        const op = await db.getFromIndex('outbox', 'by-entity', ['playlist_item', item.id]);
        if (op) await db.delete('outbox', op.id);
        await db.delete('playlistItems', item.id);
      } else {
        await db.put('playlistItems', {
          ...item,
          deletedAt: now,
          updatedAt: now,
        });
        await enqueueOutbox('playlist_item', item.id, 'delete');
      }
    }
  }

  await db.delete('blobs', songId);

  if (!song.syncedAt) {
    const op = await db.getFromIndex('outbox', 'by-entity', ['song', songId]);
    if (op) await db.delete('outbox', op.id);
    await db.delete('songs', songId);
  } else {
    await db.put('songs', {
      ...song,
      deletedAt: now,
      updatedAt: now,
    });
    await enqueueOutbox('song', songId, 'delete');
  }
}

// ---------------- BLOBS / OFFLINE CACHE ----------------

export async function saveSongBlob(
  songId: string,
  blob: Blob,
  mimeType: string
): Promise<void> {
  const db = await getDb();
  const buffer = await blob.arrayBuffer();
  const normalized = new Blob([buffer], { type: mimeType || blob.type || 'application/octet-stream' });
  await db.put('blobs', {
    songId,
    blob: normalized,
    mimeType: normalized.type,
    size: normalized.size,
    cachedAt: new Date().toISOString(),
  });
}

export async function getSongBlob(songId: string): Promise<LocalBlobRecord | undefined> {
  const db = await getDb();
  const record = await db.get('blobs', songId);
  if (!record) return undefined;
  // Normalize in case a browser/test returned raw data
  if (!(record.blob instanceof Blob)) {
    const restored = new Blob([record.blob as unknown as BlobPart], {
      type: record.mimeType || 'application/octet-stream',
    });
    return { ...record, blob: restored };
  }
  return record;
}

export async function getAllCachedSongIds(): Promise<Set<string>> {
  const db = await getDb();
  const keys = await db.getAllKeys('blobs');
  return new Set(keys);
}

export async function getOfflineStorageStats(): Promise<{
  cachedFilesCount: number;
  totalBytes: number;
}> {
  const db = await getDb();
  const blobs = await db.getAll('blobs');
  const songs = await db.getAll('songs');
  const activeSongIds = new Set(songs.filter((s) => !s.deletedAt).map((s) => s.id));
  let cachedFilesCount = 0;
  let totalBytes = 0;
  for (const b of blobs) {
    if (activeSongIds.has(b.songId)) {
      cachedFilesCount += 1;
      totalBytes += b.size || 0;
    }
  }
  return { cachedFilesCount, totalBytes };
}

// ---------------- PLAYLISTS ----------------

export async function getActivePlaylists(): Promise<Playlist[]> {
  const db = await getDb();
  const all = await db.getAll('playlists');
  return all
    .filter((p) => !p.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('playlistItems', 'by-playlist', playlistId);
  return all
    .filter((item) => !item.deletedAt)
    .sort((a, b) => a.position - b.position);
}

export async function getAllActivePlaylistItems(): Promise<PlaylistItem[]> {
  const db = await getDb();
  const all = await db.getAll('playlistItems');
  return all
    .filter((item) => !item.deletedAt)
    .sort((a, b) => a.position - b.position);
}

export async function createPlaylist(input: {
  name: string;
  description?: string;
  eventDate?: string;
}): Promise<Playlist> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Playlist name cannot be empty.');
  const db = await getDb();
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: createUuid(),
    name: trimmed,
    description: input.description?.trim() || null,
    eventDate: input.eventDate?.trim() || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncedAt: null,
  };
  await db.put('playlists', playlist);
  await enqueueOutbox('playlist', playlist.id, 'upsert');
  return playlist;
}

export async function updatePlaylist(
  playlistId: string,
  updates: Partial<Pick<Playlist, 'name' | 'description' | 'eventDate'>>
): Promise<Playlist> {
  const db = await getDb();
  const existing = await db.get('playlists', playlistId);
  if (!existing || existing.deletedAt) throw new Error('Playlist not found.');
  const updated: Playlist = {
    ...existing,
    name: updates.name !== undefined ? updates.name.trim() || existing.name : existing.name,
    description:
      updates.description !== undefined
        ? updates.description?.trim() || null
        : existing.description,
    eventDate:
      updates.eventDate !== undefined ? updates.eventDate?.trim() || null : existing.eventDate,
    updatedAt: new Date().toISOString(),
  };
  await db.put('playlists', updated);
  await enqueueOutbox('playlist', updated.id, 'upsert');
  return updated;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const db = await getDb();
  const playlist = await db.get('playlists', playlistId);
  if (!playlist) return;
  const now = new Date().toISOString();

  const items = await db.getAllFromIndex('playlistItems', 'by-playlist', playlistId);
  for (const item of items) {
    if (!item.deletedAt) {
      if (!item.syncedAt) {
        const op = await db.getFromIndex('outbox', 'by-entity', ['playlist_item', item.id]);
        if (op) await db.delete('outbox', op.id);
        await db.delete('playlistItems', item.id);
      } else {
        await db.put('playlistItems', { ...item, deletedAt: now, updatedAt: now });
        await enqueueOutbox('playlist_item', item.id, 'delete');
      }
    }
  }

  if (!playlist.syncedAt) {
    const op = await db.getFromIndex('outbox', 'by-entity', ['playlist', playlistId]);
    if (op) await db.delete('outbox', op.id);
    await db.delete('playlists', playlistId);
  } else {
    await db.put('playlists', { ...playlist, deletedAt: now, updatedAt: now });
    await enqueueOutbox('playlist', playlistId, 'delete');
  }
}

export async function addSongsToPlaylist(
  playlistId: string,
  songIds: string[]
): Promise<PlaylistItem[]> {
  if (songIds.length === 0) return [];
  const db = await getDb();
  const existing = await getPlaylistItems(playlistId);
  let nextPos = existing.length > 0 ? Math.max(...existing.map((i) => i.position)) + 1 : 0;
  const now = new Date().toISOString();
  const created: PlaylistItem[] = [];

  for (const songId of songIds) {
    const item: PlaylistItem = {
      id: createUuid(),
      playlistId,
      songId,
      position: nextPos++,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncedAt: null,
    };
    await db.put('playlistItems', item);
    await enqueueOutbox('playlist_item', item.id, 'upsert');
    created.push(item);
  }
  return created;
}

export async function removePlaylistItem(itemId: string): Promise<void> {
  const db = await getDb();
  const item = await db.get('playlistItems', itemId);
  if (!item) return;
  const now = new Date().toISOString();
  if (!item.syncedAt) {
    const op = await db.getFromIndex('outbox', 'by-entity', ['playlist_item', itemId]);
    if (op) await db.delete('outbox', op.id);
    await db.delete('playlistItems', itemId);
  } else {
    await db.put('playlistItems', { ...item, deletedAt: now, updatedAt: now });
    await enqueueOutbox('playlist_item', itemId, 'delete');
  }
}

export async function reorderPlaylistItems(
  playlistId: string,
  orderedItemIds: string[]
): Promise<void> {
  const db = await getDb();
  const current = await getPlaylistItems(playlistId);
  const byId = new Map(current.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  for (let idx = 0; idx < orderedItemIds.length; idx++) {
    const item = byId.get(orderedItemIds[idx]);
    if (item && item.position !== idx) {
      const updated: PlaylistItem = {
        ...item,
        position: idx,
        updatedAt: now,
      };
      await db.put('playlistItems', updated);
      await enqueueOutbox('playlist_item', updated.id, 'upsert');
    }
  }
}

// ---------------- OUTBOX & SYNC META ----------------

export async function getOutboxOps(): Promise<OutboxOp[]> {
  const db = await getDb();
  const all = await db.getAll('outbox');
  // Order ensures folders sync before songs, and playlists before playlist_items
  const entityPriority: Record<OutboxEntity, number> = {
    folder: 1,
    playlist: 2,
    song: 3,
    playlist_item: 4,
  };
  return all.sort((a, b) => {
    const pDiff = entityPriority[a.entity] - entityPriority[b.entity];
    if (pDiff !== 0) return pDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function getOutboxCount(): Promise<number> {
  const db = await getDb();
  return db.count('outbox');
}

export async function removeOutboxOp(opId: string): Promise<void> {
  const db = await getDb();
  await db.delete('outbox', opId);
}

export async function markOutboxError(opId: string, errorMsg: string): Promise<void> {
  const db = await getDb();
  const op = await db.get('outbox', opId);
  if (!op) return;
  await db.put('outbox', {
    ...op,
    retryCount: op.retryCount + 1,
    lastError: errorMsg,
  });
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row ? (row.value as T) : null;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}

export function hasBuiltInCloudConfig(): boolean {
  const envApiKey = import.meta.env?.VITE_FIREBASE_API_KEY?.trim();
  const envProjectId = import.meta.env?.VITE_FIREBASE_PROJECT_ID?.trim();
  const envAppId = import.meta.env?.VITE_FIREBASE_APP_ID?.trim();
  return Boolean(envApiKey && envProjectId && envAppId);
}

export const STAGE_PREFS_STORAGE_KEY = 'worshipdeck-stage-prefs';

export const DEFAULT_STAGE_PREFERENCES: StagePreferences = {
  defaultStageInvert: false,
  defaultKeepAwake: true,
};

export async function getStagePreferences(): Promise<StagePreferences> {
  const stored = await getMeta<Partial<StagePreferences>>('stagePrefs');
  if (stored && typeof stored === 'object') {
    return {
      defaultStageInvert: Boolean(stored.defaultStageInvert),
      defaultKeepAwake:
        stored.defaultKeepAwake === undefined ? true : Boolean(stored.defaultKeepAwake),
    };
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STAGE_PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StagePreferences>;
        return {
          defaultStageInvert: Boolean(parsed.defaultStageInvert),
          defaultKeepAwake:
            parsed.defaultKeepAwake === undefined ? true : Boolean(parsed.defaultKeepAwake),
        };
      }
    } catch {
      // Ignore invalid localStorage payload
    }
  }
  return { ...DEFAULT_STAGE_PREFERENCES };
}

export async function saveStagePreferences(
  prefs: StagePreferences
): Promise<StagePreferences> {
  const normalized: StagePreferences = {
    defaultStageInvert: Boolean(prefs.defaultStageInvert),
    defaultKeepAwake: Boolean(prefs.defaultKeepAwake),
  };
  await setMeta('stagePrefs', normalized);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STAGE_PREFS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota issues
    }
  }
  return normalized;
}

export async function getSavedCloudConfig(): Promise<CloudConfig | null> {
  const envApiKey = import.meta.env?.VITE_FIREBASE_API_KEY?.trim();
  const envProjectId = import.meta.env?.VITE_FIREBASE_PROJECT_ID?.trim();
  const envAppId = import.meta.env?.VITE_FIREBASE_APP_ID?.trim();
  const envAuthDomain = import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const envStorageBucket = import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const envSenderId = import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const envChurch = import.meta.env?.VITE_CHURCH_NAME?.trim();
  const envMode = import.meta.env?.VITE_FIREBASE_FILE_STORAGE_MODE?.trim();

  const stored = await getMeta<CloudConfig>('cloudConfig');
  if (stored?.apiKey && stored?.projectId && stored?.appId) {
    return {
      ...stored,
      fileStorageMode: stored.fileStorageMode || 'firestore',
    };
  }
  if (envApiKey && envProjectId && envAppId) {
    return {
      apiKey: envApiKey,
      projectId: envProjectId,
      appId: envAppId,
      authDomain: envAuthDomain || `${envProjectId}.firebaseapp.com`,
      storageBucket: envStorageBucket || `${envProjectId}.firebasestorage.app`,
      messagingSenderId: envSenderId || undefined,
      churchName: envChurch || 'Church Worship Team',
      fileStorageMode: envMode === 'storage' ? 'storage' : 'firestore',
    };
  }
  return null;
}

export async function saveCloudConfig(config: CloudConfig | null): Promise<void> {
  if (!config) {
    const db = await getDb();
    await db.delete('meta', 'cloudConfig');
  } else {
    const projectId = config.projectId.trim();
    await setMeta('cloudConfig', {
      apiKey: config.apiKey.trim(),
      projectId,
      appId: config.appId.trim(),
      authDomain: config.authDomain?.trim() || `${projectId}.firebaseapp.com`,
      storageBucket: config.storageBucket?.trim() || `${projectId}.firebasestorage.app`,
      messagingSenderId: config.messagingSenderId?.trim() || undefined,
      churchName: config.churchName?.trim() || 'Church Worship Team',
      fileStorageMode: config.fileStorageMode === 'storage' ? 'storage' : 'firestore',
    } satisfies CloudConfig);
  }
}

// ---------------- REMOTE MERGE (WITH OUTBOX PROTECTION) ----------------

export async function hasPendingOutbox(entity: OutboxEntity, entityId: string): Promise<boolean> {
  const db = await getDb();
  const existing = await db.getFromIndex('outbox', 'by-entity', [entity, entityId]);
  return Boolean(existing);
}

export async function markEntitySynced(
  entity: OutboxEntity,
  entityId: string,
  syncedAt: string
): Promise<void> {
  const db = await getDb();
  if (entity === 'folder') {
    const row = await db.get('folders', entityId);
    if (row) await db.put('folders', { ...row, syncedAt });
  } else if (entity === 'song') {
    const row = await db.get('songs', entityId);
    if (row) await db.put('songs', { ...row, syncedAt });
  } else if (entity === 'playlist') {
    const row = await db.get('playlists', entityId);
    if (row) await db.put('playlists', { ...row, syncedAt });
  } else if (entity === 'playlist_item') {
    const row = await db.get('playlistItems', entityId);
    if (row) await db.put('playlistItems', { ...row, syncedAt });
  }
}

export async function mergeRemoteData(payload: {
  folders: Folder[];
  songs: Song[];
  playlists: Playlist[];
  playlistItems: PlaylistItem[];
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  for (const remote of payload.folders) {
    if (await hasPendingOutbox('folder', remote.id)) continue;
    const local = await db.get('folders', remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      await db.put('folders', { ...remote, syncedAt: now });
    }
  }

  for (const remote of payload.songs) {
    if (await hasPendingOutbox('song', remote.id)) continue;
    const local = await db.get('songs', remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      await db.put('songs', { ...remote, syncedAt: now });
      if (remote.deletedAt) {
        await db.delete('blobs', remote.id);
      }
    }
  }

  for (const remote of payload.playlists) {
    if (await hasPendingOutbox('playlist', remote.id)) continue;
    const local = await db.get('playlists', remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      await db.put('playlists', { ...remote, syncedAt: now });
    }
  }

  for (const remote of payload.playlistItems) {
    if (await hasPendingOutbox('playlist_item', remote.id)) continue;
    const local = await db.get('playlistItems', remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      await db.put('playlistItems', { ...remote, syncedAt: now });
    }
  }
}

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  deleteObject,
  getBlob as getStorageBlob,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import {
  getActiveSongs,
  getAllCachedSongIds,
  getDb,
  getMeta,
  getOutboxCount,
  getOutboxOps,
  getSavedCloudConfig,
  getSongBlob,
  markEntitySynced,
  markOutboxError,
  mergeRemoteData,
  removeOutboxOp,
  saveSongBlob,
  setMeta,
} from '../db/localDb';
import {
  DEFAULT_CHORDS_FOLDER_ID,
  DEFAULT_LYRICS_FOLDER_ID,
  type CloudConfig,
  type Folder,
  type OutboxOp,
  type Playlist,
  type PlaylistItem,
  type Song,
  type SyncStatusInfo,
} from '../types/models';
import { base64ToBytes, bytesToBase64 } from '../utils/format';
import { getFirebaseBundle, type FirebaseBundle } from './firebaseClient';

// 450 KB raw per chunk -> ~600 KB base64 (well under Firestore's 1 MiB document cap)
const FIRESTORE_CHUNK_BYTES = 450_000;

interface RemoteFolderDoc {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface RemoteSongDoc {
  id: string;
  folderId: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'image';
  mimeType: string;
  fileSize: number;
  storagePath: string;
  storageMode?: 'firestore' | 'storage';
  chunkCount?: number | null;
  songKey: string | null;
  tempo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface RemotePlaylistDoc {
  id: string;
  name: string;
  description: string | null;
  eventDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface RemotePlaylistItemDoc {
  id: string;
  playlistId: string;
  songId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function toLocalFolder(row: RemoteFolderDoc): Folder {
  return {
    ...row,
    syncedAt: new Date().toISOString(),
  };
}

function toRemoteFolder(f: Folder): RemoteFolderDoc {
  return {
    id: f.id,
    name: f.name,
    isDefault: f.isDefault,
    sortOrder: f.sortOrder,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    deletedAt: f.deletedAt,
  };
}

function toLocalSong(row: RemoteSongDoc): Song {
  return {
    ...row,
    fileSize: Number(row.fileSize || 0),
    syncedAt: new Date().toISOString(),
  };
}

function toRemoteSong(s: Song): RemoteSongDoc {
  return {
    id: s.id,
    folderId: s.folderId,
    title: s.title,
    fileName: s.fileName,
    fileType: s.fileType,
    mimeType: s.mimeType,
    fileSize: s.fileSize,
    storagePath: s.storagePath,
    storageMode: s.storageMode || 'firestore',
    chunkCount: s.chunkCount ?? null,
    songKey: s.songKey,
    tempo: s.tempo,
    notes: s.notes,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
  };
}

function toLocalPlaylist(row: RemotePlaylistDoc): Playlist {
  return {
    ...row,
    syncedAt: new Date().toISOString(),
  };
}

function toRemotePlaylist(p: Playlist): RemotePlaylistDoc {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    eventDate: p.eventDate,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}

function toLocalPlaylistItem(row: RemotePlaylistItemDoc): PlaylistItem {
  return {
    ...row,
    syncedAt: new Date().toISOString(),
  };
}

function toRemotePlaylistItem(item: PlaylistItem): RemotePlaylistItemDoc {
  return {
    id: item.id,
    playlistId: item.playlistId,
    songId: item.songId,
    position: item.position,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

async function uploadSongChunksToFirestore(
  firestore: Firestore,
  songId: string,
  blob: Blob
): Promise<number> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const totalChunks = Math.max(1, Math.ceil(bytes.length / FIRESTORE_CHUNK_BYTES));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * FIRESTORE_CHUNK_BYTES;
    const end = Math.min(start + FIRESTORE_CHUNK_BYTES, bytes.length);
    const slice = bytes.subarray(start, end);
    const chunkId = String(i).padStart(4, '0');
    await setDoc(doc(firestore, 'songs', songId, 'chunks', chunkId), {
      songId,
      chunkIndex: i,
      totalChunks,
      data: bytesToBase64(slice),
    });
  }

  return totalChunks;
}

async function downloadSongChunksFromFirestore(
  firestore: Firestore,
  song: Song
): Promise<Blob> {
  const chunksSnap = await getDocs(
    query(
      collection(firestore, 'songs', song.id, 'chunks'),
      orderBy('chunkIndex', 'asc')
    )
  );

  if (chunksSnap.empty) {
    throw new Error(`No file chunks found in Firestore for "${song.title}".`);
  }

  const parts: Uint8Array[] = [];
  chunksSnap.forEach((d) => {
    const data = d.data() as { data?: string };
    if (typeof data.data === 'string') {
      parts.push(base64ToBytes(data.data));
    }
  });

  return new Blob(parts as unknown as BlobPart[], { type: song.mimeType });
}

async function deleteSongChunksFromFirestore(
  firestore: Firestore,
  songId: string
): Promise<void> {
  const chunksSnap = await getDocs(collection(firestore, 'songs', songId, 'chunks'));
  if (chunksSnap.empty) return;
  const batch = writeBatch(firestore);
  chunksSnap.forEach((d) => {
    batch.delete(d.ref);
  });
  await batch.commit();
}

type StatusListener = (status: SyncStatusInfo) => void;
type DataChangedListener = () => void;

class SyncManager {
  private isSyncing = false;
  private syncQueued = false;
  private downloadingCount = 0;
  private lastError: string | null = null;
  private statusListeners = new Set<StatusListener>();
  private dataListeners = new Set<DataChangedListener>();
  private unsubscribers: Unsubscribe[] = [];
  private realtimeDebounce: ReturnType<typeof setTimeout> | null = null;
  private defaultsEnsuredForProject: string | null = null;

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    void this.emitStatus();
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeDataChanged(listener: DataChangedListener): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  private notifyDataChanged(): void {
    for (const cb of this.dataListeners) {
      cb();
    }
  }

  async getStatus(): Promise<SyncStatusInfo> {
    const config = await getSavedCloudConfig();
    const isConfigured = Boolean(config?.apiKey && config?.projectId && config?.appId);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const pendingCount = await getOutboxCount();
    const lastSyncAt = await getMeta<string>('lastSyncAt');

    let state: SyncStatusInfo['state'] = 'synced';
    if (!isConfigured) {
      state = 'local-only';
    } else if (!isOnline) {
      state = 'offline';
    } else if (this.isSyncing || this.downloadingCount > 0) {
      state = 'syncing';
    } else if (this.lastError) {
      state = 'error';
    }

    return {
      state,
      isOnline,
      isConfigured,
      pendingCount,
      downloadingCount: this.downloadingCount,
      lastSyncAt,
      errorMessage: this.lastError,
    };
  }

  async emitStatus(): Promise<void> {
    const status = await this.getStatus();
    for (const cb of this.statusListeners) {
      cb(status);
    }
  }

  private async ensureRemoteDefaultFolders(bundle: FirebaseBundle): Promise<void> {
    if (this.defaultsEnsuredForProject === bundle.config.projectId) return;

    const db = await getDb();
    const defaults = [
      await db.get('folders', DEFAULT_CHORDS_FOLDER_ID),
      await db.get('folders', DEFAULT_LYRICS_FOLDER_ID),
    ].filter((f): f is Folder => Boolean(f));

    if (defaults.length > 0) {
      const remoteSnap = await getDocs(collection(bundle.firestore, 'folders'));
      const existingIds = new Set(remoteSnap.docs.map((d) => d.id));
      for (const f of defaults) {
        if (!existingIds.has(f.id)) {
          await setDoc(doc(bundle.firestore, 'folders', f.id), toRemoteFolder(f));
        }
      }
    }

    this.defaultsEnsuredForProject = bundle.config.projectId;
  }

  private async processOutboxOp(bundle: FirebaseBundle, op: OutboxOp): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    if (op.entity === 'folder') {
      const folder = await db.get('folders', op.entityId);
      if (!folder) {
        await removeOutboxOp(op.id);
        return;
      }
      await setDoc(doc(bundle.firestore, 'folders', folder.id), toRemoteFolder(folder));
      await markEntitySynced('folder', folder.id, now);
      await removeOutboxOp(op.id);
      return;
    }

    if (op.entity === 'playlist') {
      const playlist = await db.get('playlists', op.entityId);
      if (!playlist) {
        await removeOutboxOp(op.id);
        return;
      }
      await setDoc(
        doc(bundle.firestore, 'playlists', playlist.id),
        toRemotePlaylist(playlist)
      );
      await markEntitySynced('playlist', playlist.id, now);
      await removeOutboxOp(op.id);
      return;
    }

    if (op.entity === 'song') {
      const song = await db.get('songs', op.entityId);
      if (!song) {
        await removeOutboxOp(op.id);
        return;
      }

      if (op.action === 'upsert' && !song.deletedAt) {
        let storageMode = song.storageMode || bundle.config.fileStorageMode || 'firestore';
        let chunkCount = song.chunkCount;

        if (!song.syncedAt) {
          const blobRecord = await getSongBlob(song.id);
          if (!blobRecord) {
            throw new Error(`Offline file blob missing for "${song.title}"`);
          }

          if (storageMode === 'storage' && bundle.storage) {
            const fileRef = storageRef(bundle.storage, `song-files/${song.storagePath}`);
            await uploadBytes(fileRef, blobRecord.blob, {
              contentType: song.mimeType,
            });
          } else {
            storageMode = 'firestore';
            chunkCount = await uploadSongChunksToFirestore(
              bundle.firestore,
              song.id,
              blobRecord.blob
            );
          }
        }

        const updatedSong: Song = {
          ...song,
          storageMode,
          chunkCount,
        };
        await db.put('songs', updatedSong);
        await setDoc(doc(bundle.firestore, 'songs', song.id), toRemoteSong(updatedSong));
        await markEntitySynced('song', song.id, now);
        await removeOutboxOp(op.id);
        return;
      }

      // Soft delete remotely + free storage
      await setDoc(doc(bundle.firestore, 'songs', song.id), toRemoteSong(song));
      await deleteSongChunksFromFirestore(bundle.firestore, song.id);
      if (song.storageMode === 'storage' && bundle.storage) {
        try {
          await deleteObject(storageRef(bundle.storage, `song-files/${song.storagePath}`));
        } catch {
          // Ignore if already absent
        }
      }
      await markEntitySynced('song', song.id, now);
      await removeOutboxOp(op.id);
      return;
    }

    if (op.entity === 'playlist_item') {
      const item = await db.get('playlistItems', op.entityId);
      if (!item) {
        await removeOutboxOp(op.id);
        return;
      }
      await setDoc(
        doc(bundle.firestore, 'playlist_items', item.id),
        toRemotePlaylistItem(item)
      );
      await markEntitySynced('playlist_item', item.id, now);
      await removeOutboxOp(op.id);
    }
  }

  async syncAll(): Promise<void> {
    if (this.isSyncing) {
      this.syncQueued = true;
      return;
    }

    const config = await getSavedCloudConfig();
    const bundle = getFirebaseBundle(config);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (!bundle || !isOnline) {
      await this.emitStatus();
      return;
    }

    this.isSyncing = true;
    this.lastError = null;
    await this.emitStatus();

    try {
      await this.ensureRemoteDefaultFolders(bundle);

      // 1. Push pending local edits/uploads to Firebase
      const ops = await getOutboxOps();
      for (const op of ops) {
        try {
          await this.processOutboxOp(bundle, op);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Firebase upload error';
          await markOutboxError(op.id, msg);
          throw err;
        }
      }

      // 2. Pull latest metadata from Firestore
      const [foldersSnap, songsSnap, playlistsSnap, itemsSnap] = await Promise.all([
        getDocs(collection(bundle.firestore, 'folders')),
        getDocs(collection(bundle.firestore, 'songs')),
        getDocs(collection(bundle.firestore, 'playlists')),
        getDocs(collection(bundle.firestore, 'playlist_items')),
      ]);

      await mergeRemoteData({
        folders: foldersSnap.docs
          .filter((d) => !d.id.startsWith('__'))
          .map((d) => toLocalFolder(d.data() as RemoteFolderDoc)),
        songs: songsSnap.docs.map((d) => toLocalSong(d.data() as RemoteSongDoc)),
        playlists: playlistsSnap.docs.map((d) =>
          toLocalPlaylist(d.data() as RemotePlaylistDoc)
        ),
        playlistItems: itemsSnap.docs.map((d) =>
          toLocalPlaylistItem(d.data() as RemotePlaylistItemDoc)
        ),
      });

      this.notifyDataChanged();

      // 3. Cache any missing song files offline automatically
      await this.cacheMissingBlobs(bundle);

      await setMeta('lastSyncAt', new Date().toISOString());
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Firebase sync failed';
    } finally {
      this.isSyncing = false;
      this.downloadingCount = 0;
      await this.emitStatus();

      if (this.syncQueued) {
        this.syncQueued = false;
        void this.syncAll();
      }
    }
  }

  private async downloadSongBlobFromRemote(
    bundle: FirebaseBundle,
    song: Song
  ): Promise<Blob> {
    if (song.storageMode === 'storage' && bundle.storage) {
      const fileRef = storageRef(bundle.storage, `song-files/${song.storagePath}`);
      return getStorageBlob(fileRef);
    }
    return downloadSongChunksFromFirestore(bundle.firestore, song);
  }

  private async cacheMissingBlobs(bundle: FirebaseBundle): Promise<void> {
    const activeSongs = await getActiveSongs();
    const cachedIds = await getAllCachedSongIds();
    const missing = activeSongs.filter((s) => !cachedIds.has(s.id));

    if (missing.length === 0) return;

    this.downloadingCount = missing.length;
    await this.emitStatus();

    const queue = [...missing];
    const worker = async () => {
      while (queue.length > 0) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const song = queue.shift();
        if (!song) break;
        try {
          const blob = await this.downloadSongBlobFromRemote(bundle, song);
          await saveSongBlob(song.id, blob, song.mimeType);
          this.notifyDataChanged();
        } catch {
          // Keep queued for retry on next sync
        } finally {
          this.downloadingCount = Math.max(0, this.downloadingCount - 1);
          await this.emitStatus();
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
  }

  async downloadSingleSong(song: Song): Promise<Blob | null> {
    const existing = await getSongBlob(song.id);
    if (existing) return existing.blob;

    const config = await getSavedCloudConfig();
    const bundle = getFirebaseBundle(config);
    if (!bundle || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return null;
    }

    const blob = await this.downloadSongBlobFromRemote(bundle, song);
    await saveSongBlob(song.id, blob, song.mimeType);
    this.notifyDataChanged();
    const saved = await getSongBlob(song.id);
    return saved?.blob ?? blob;
  }

  async startRealtime(): Promise<void> {
    this.stopRealtime();
    const config = await getSavedCloudConfig();
    const bundle = getFirebaseBundle(config);
    if (!bundle) return;

    const triggerDebouncedSync = () => {
      if (this.realtimeDebounce) clearTimeout(this.realtimeDebounce);
      this.realtimeDebounce = setTimeout(() => {
        void this.syncAll();
      }, 700);
    };

    const collectionsToWatch = ['folders', 'songs', 'playlists', 'playlist_items'] as const;
    for (const colName of collectionsToWatch) {
      let initialSnapshot = true;
      const unsub = onSnapshot(
        collection(bundle.firestore, colName),
        () => {
          if (initialSnapshot) {
            initialSnapshot = false;
            return;
          }
          triggerDebouncedSync();
        },
        () => {
          // Ignore transient offline snapshot warnings; syncAll handles error state
        }
      );
      this.unsubscribers.push(unsub);
    }
  }

  stopRealtime(): void {
    if (this.realtimeDebounce) {
      clearTimeout(this.realtimeDebounce);
      this.realtimeDebounce = null;
    }
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}

export const syncManager = new SyncManager();

export async function testCloudConnection(config: CloudConfig): Promise<{
  ok: boolean;
  message: string;
}> {
  const bundle = getFirebaseBundle(config);
  if (!bundle) {
    return {
      ok: false,
      message: 'Please provide valid Firebase apiKey, projectId, and appId.',
    };
  }
  try {
    await getDocs(query(collection(bundle.firestore, 'folders'), limit(1)));
    // Also verify write access cleanly with a temporary healthcheck doc that gets deleted immediately
    const testRef = doc(bundle.firestore, 'folders', '__healthcheck__');
    await setDoc(testRef, { id: '__healthcheck__', ok: true, at: new Date().toISOString() });
    await deleteDoc(testRef);

    return {
      ok: true,
      message: `Connected to Firebase project "${config.projectId}"! Firestore read & write access is ready.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach Firebase.';
    return {
      ok: false,
      message: `Firebase error: ${msg}. Make sure Firestore Database is created and Firestore Rules allow access.`,
    };
  }
}

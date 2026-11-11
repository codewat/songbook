export const UNFILED_FOLDER_ID = 'unfiled';

export const LEGACY_DEFAULT_FOLDER_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
] as const;

export type SongFileType = 'pdf' | 'image' | 'ppt' | 'pptx';
export type FirebaseFileStorageMode = 'firestore' | 'storage';

export interface Folder {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncedAt: string | null;
}

export interface Song {
  id: string;
  folderId: string;
  title: string;
  fileName: string;
  fileType: SongFileType;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  storageMode?: FirebaseFileStorageMode;
  chunkCount?: number | null;
  songKey: string | null;
  tempo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncedAt: string | null;
}

export interface LocalBlobRecord {
  songId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  cachedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  eventDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncedAt: string | null;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  songId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncedAt: string | null;
}

export type OutboxEntity = 'folder' | 'song' | 'playlist' | 'playlist_item';
export type OutboxAction = 'upsert' | 'delete';

export interface OutboxOp {
  id: string;
  entity: OutboxEntity;
  entityId: string;
  action: OutboxAction;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
}

export interface CloudConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  churchName?: string;
  fileStorageMode?: FirebaseFileStorageMode;
}

export type SyncState =
  | 'local-only'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'error';

export interface SyncStatusInfo {
  state: SyncState;
  isOnline: boolean;
  isConfigured: boolean;
  pendingCount: number;
  downloadingCount: number;
  lastSyncAt: string | null;
  errorMessage: string | null;
}

export interface StagePreferences {
  defaultStageInvert: boolean;
  defaultKeepAwake: boolean;
}

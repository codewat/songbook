import { useCallback, useEffect, useState } from 'react';
import { Layers, Library, ListMusic, Upload } from 'lucide-react';
import {
  addSongFile,
  addSongsToPlaylist,
  cleanupLegacyDefaultFolders,
  createFolder,
  createPlaylist,
  deleteFolder,
  deletePlaylist,
  deleteSong,
  getActiveFolders,
  getActivePlaylists,
  getActiveSongs,
  getAllActivePlaylistItems,
  getAllCachedSongIds,
  getOfflineStorageStats,
  getSavedCloudConfig,
  removePlaylistItem,
  renameFolder,
  reorderPlaylistItems,
  saveCloudConfig,
  updatePlaylist,
  updateSongMeta,
} from './db/localDb';
import {
  UNFILED_FOLDER_ID,
  type Folder,
  type Playlist,
  type PlaylistItem,
  type Song,
  type SyncStatusInfo,
} from './types/models';
import { syncManager } from './sync/syncEngine';
import { resetFirebaseClientCache } from './sync/firebaseClient';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Header } from './components/Header';
import { Sidebar, type ActiveRoute } from './components/Sidebar';
import { FolderView } from './components/FolderView';
import { PlaylistView } from './components/PlaylistView';
import { UploadModal } from './components/UploadModal';
import { CreateModal, type CreateModalMode } from './components/CreateModal';
import {
  AddToPlaylistModal,
  type AddToPlaylistMode,
} from './components/AddToPlaylistModal';
import { ConfirmModal } from './components/ConfirmModal';
import { ViewerModal } from './components/ViewerModal';
import { SyncSettingsModal } from './components/SyncSettingsModal';

export function App() {
  const isOnline = useOnlineStatus();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [cachedSongIds, setCachedSongIds] = useState<Set<string>>(new Set());
  const [storageStats, setStorageStats] = useState({
    cachedFilesCount: 0,
    totalBytes: 0,
  });
  const [churchName, setChurchName] = useState('Church Worship Team');

  const [route, setRoute] = useState<ActiveRoute>({ type: 'all' });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [createMode, setCreateMode] = useState<CreateModalMode | null>(null);
  const [addToPlaylistMode, setAddToPlaylistMode] =
    useState<AddToPlaylistMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const [viewerState, setViewerState] = useState<{
    queue: Song[];
    index: number;
  } | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>({
    state: 'local-only',
    isOnline,
    isConfigured: false,
    pendingCount: 0,
    downloadingCount: 0,
    lastSyncAt: null,
    errorMessage: null,
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const refreshLocalData = useCallback(async () => {
    await cleanupLegacyDefaultFolders();
    const [f, s, p, pi, cached, stats, cfg] = await Promise.all([
      getActiveFolders(),
      getActiveSongs(),
      getActivePlaylists(),
      getAllActivePlaylistItems(),
      getAllCachedSongIds(),
      getOfflineStorageStats(),
      getSavedCloudConfig(),
    ]);
    setFolders(f);
    setSongs(s);
    setPlaylists(p);
    setPlaylistItems(pi);
    setCachedSongIds(cached);
    setStorageStats(stats);
    setChurchName(cfg?.churchName || 'Church Worship Team');
  }, []);

  // Bootstrap app, process #setup= invite links, and initialize sync
  useEffect(() => {
    const init = async () => {
      // Check shareable team invite link (#setup=...)
      if (window.location.hash.startsWith('#setup=')) {
        try {
          const raw = window.location.hash.slice('#setup='.length);
          const json = decodeURIComponent(escape(atob(raw)));
          const parsed = JSON.parse(json) as {
            ak?: string;
            pi?: string;
            ai?: string;
            ad?: string;
            sb?: string;
            ms?: string;
            cn?: string;
            fm?: string;
          };
          if (
            typeof parsed.ak === 'string' &&
            parsed.ak.length > 10 &&
            typeof parsed.pi === 'string' &&
            parsed.pi.length > 2 &&
            typeof parsed.ai === 'string' &&
            parsed.ai.length > 5
          ) {
            await saveCloudConfig({
              apiKey: parsed.ak,
              projectId: parsed.pi,
              appId: parsed.ai,
              authDomain: parsed.ad,
              storageBucket: parsed.sb,
              messagingSenderId: parsed.ms,
              churchName: parsed.cn || 'Church Worship Team',
              fileStorageMode: parsed.fm === 'storage' ? 'storage' : 'firestore',
            });
            await resetFirebaseClientCache();
            window.history.replaceState(null, '', window.location.pathname);
            showToast('Connected to church Firebase team sync!');
          }
        } catch {
          // Ignore invalid hash
        }
      }

      await refreshLocalData();
      await syncManager.emitStatus();
      await syncManager.syncAll();
      await syncManager.startRealtime();
    };

    void init();

    const unsubStatus = syncManager.subscribeStatus(setSyncStatus);
    const unsubData = syncManager.subscribeDataChanged(() => {
      void refreshLocalData();
    });

    return () => {
      unsubStatus();
      unsubData();
      syncManager.stopRealtime();
    };
  }, [refreshLocalData, showToast]);

  // Automatically trigger sync whenever connection comes back online
  useEffect(() => {
    if (isOnline) {
      void syncManager.syncAll();
      void syncManager.startRealtime();
    } else {
      void syncManager.emitStatus();
    }
  }, [isOnline]);

  // Ensure route stays valid if a folder or playlist gets deleted
  useEffect(() => {
    if (
      route.type === 'folder' &&
      !folders.some((f) => f.id === route.folderId)
    ) {
      setRoute({ type: 'all' });
    } else if (
      route.type === 'playlist' &&
      !playlists.some((p) => p.id === route.playlistId)
    ) {
      setRoute({ type: 'all' });
    }
  }, [route, folders, playlists]);

  const triggerSyncAfterEdit = useCallback(() => {
    void syncManager.emitStatus();
    if (navigator.onLine) {
      void syncManager.syncAll();
    }
  }, []);

  const handleUpload = async (payload: {
    files: File[];
    folderId: string;
    playlistId: string | null;
    singleMeta?: {
      title: string;
      songKey: string;
      tempo: string;
      notes: string;
    };
  }) => {
    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }

    const createdSongIds: string[] = [];
    for (const file of payload.files) {
      const created = await addSongFile({
        file,
        folderId: payload.folderId,
        title: payload.singleMeta?.title,
        songKey: payload.singleMeta?.songKey,
        tempo: payload.singleMeta?.tempo,
        notes: payload.singleMeta?.notes,
      });
      createdSongIds.push(created.id);
    }

    if (payload.playlistId && createdSongIds.length > 0) {
      await addSongsToPlaylist(payload.playlistId, createdSongIds);
    }

    await refreshLocalData();
    triggerSyncAfterEdit();
    showToast(
      `Saved ${createdSongIds.length} file${createdSongIds.length > 1 ? 's' : ''} offline!`
    );
  };

  const handleSaveFolder = async (name: string, folderId?: string) => {
    if (folderId) {
      await renameFolder(folderId, name);
      showToast('Folder renamed');
    } else {
      const created = await createFolder(name);
      setRoute({ type: 'folder', folderId: created.id });
      showToast(`Folder "${created.name}" created`);
    }
    await refreshLocalData();
    triggerSyncAfterEdit();
  };

  const handleSavePlaylist = async (
    data: { name: string; description: string; eventDate: string },
    playlistId?: string
  ) => {
    if (playlistId) {
      await updatePlaylist(playlistId, data);
      showToast('Playlist updated');
    } else {
      const created = await createPlaylist(data);
      setRoute({ type: 'playlist', playlistId: created.id });
      showToast(`Playlist "${created.name}" created`);
    }
    await refreshLocalData();
    triggerSyncAfterEdit();
  };

  const handleSaveSongMeta = async (
    songId: string,
    updates: {
      title: string;
      folderId: string;
      songKey: string;
      tempo: string;
      notes: string;
    }
  ) => {
    await updateSongMeta(songId, updates);
    await refreshLocalData();
    triggerSyncAfterEdit();
    showToast('Song updated');
  };

  const handleDeleteSong = (song: Song) => {
    setConfirmState({
      title: 'Delete Song?',
      message: `Remove "${song.title}" from your offline storage${
        syncStatus.isConfigured ? ' and team cloud library' : ''
      }?`,
      confirmLabel: 'Delete Song',
      onConfirm: async () => {
        await deleteSong(song.id);
        setConfirmState(null);
        await refreshLocalData();
        triggerSyncAfterEdit();
        showToast('Song deleted');
      },
    });
  };

  const handleDeleteFolder = (folder: Folder) => {
    setConfirmState({
      title: `Delete "${folder.name}"?`,
      message:
        'All songs inside this folder will also be removed from the library and playlists.',
      confirmLabel: 'Delete Folder',
      onConfirm: async () => {
        await deleteFolder(folder.id);
        setConfirmState(null);
        await refreshLocalData();
        triggerSyncAfterEdit();
        showToast('Folder deleted');
      },
    });
  };

  const handleDeletePlaylist = (playlist: Playlist) => {
    setConfirmState({
      title: `Delete Playlist "${playlist.name}"?`,
      message:
        'This removes the lineup order, while keeping all original chord & lyric files safe in their folders.',
      confirmLabel: 'Delete Playlist',
      onConfirm: async () => {
        await deletePlaylist(playlist.id);
        setConfirmState(null);
        await refreshLocalData();
        triggerSyncAfterEdit();
        showToast('Playlist deleted');
      },
    });
  };

  const handleReorderPlaylistItem = async (
    playlistId: string,
    itemId: string,
    direction: 'up' | 'down'
  ) => {
    const items = playlistItems
      .filter((i) => i.playlistId === playlistId)
      .sort((a, b) => a.position - b.position);
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const nextOrder = items.map((i) => i.id);
    const temp = nextOrder[idx];
    nextOrder[idx] = nextOrder[swapIdx];
    nextOrder[swapIdx] = temp;

    await reorderPlaylistItems(playlistId, nextOrder);
    await refreshLocalData();
    triggerSyncAfterEdit();
  };

  const activeFolder =
    route.type === 'folder'
      ? folders.find((f) => f.id === route.folderId) || null
      : null;

  const activePlaylist =
    route.type === 'playlist'
      ? playlists.find((p) => p.id === route.playlistId) || null
      : null;

  const defaultUploadFolderId =
    route.type === 'folder' ? route.folderId : UNFILED_FOLDER_ID;

  const defaultUploadPlaylistId =
    route.type === 'playlist' ? route.playlistId : null;

  const activePlaylistItems = activePlaylist
    ? playlistItems
        .filter((i) => i.playlistId === activePlaylist.id)
        .sort((a, b) => a.position - b.position)
    : [];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      <Header
        churchName={churchName}
        syncStatus={syncStatus}
        onToggleSidebar={() => setMobileSidebarOpen(true)}
        onSyncClick={() => void syncManager.syncAll()}
        onUploadClick={() => {
          setDroppedFiles([]);
          setUploadOpen(true);
        }}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          openMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          route={route}
          onSelectRoute={setRoute}
          folders={folders}
          playlists={playlists}
          songs={songs}
          playlistItems={playlistItems}
          storageStats={storageStats}
          onCreateFolder={() => setCreateMode({ type: 'create-folder' })}
          onRenameFolder={(folder) =>
            setCreateMode({ type: 'rename-folder', folder })
          }
          onDeleteFolder={handleDeleteFolder}
          onCreatePlaylist={() => setCreateMode({ type: 'create-playlist' })}
          onSyncNow={() => void syncManager.syncAll()}
          isSyncing={syncStatus.state === 'syncing'}
        />

        <main className="min-w-0 flex-1 overflow-hidden pb-14 md:pb-0">
          {route.type === 'playlist' && activePlaylist ? (
            <PlaylistView
              playlist={activePlaylist}
              items={activePlaylistItems}
              songs={songs}
              folders={folders}
              cachedSongIds={cachedSongIds}
              onStartStageMode={(startIdx) => {
                const songMap = new Map(songs.map((s) => [s.id, s]));
                const queue = activePlaylistItems
                  .map((i) => songMap.get(i.songId))
                  .filter((s): s is Song => Boolean(s));
                if (queue.length > 0) {
                  setViewerState({ queue, index: startIdx });
                }
              }}
              onAddSongsClick={() =>
                setAddToPlaylistMode({
                  type: 'pick-songs-for-playlist',
                  playlist: activePlaylist,
                })
              }
              onUploadToPlaylistClick={() => {
                setDroppedFiles([]);
                setUploadOpen(true);
              }}
              onEditPlaylist={() =>
                setCreateMode({ type: 'edit-playlist', playlist: activePlaylist })
              }
              onDeletePlaylist={() => handleDeletePlaylist(activePlaylist)}
              onReorderItem={(itemId, dir) =>
                void handleReorderPlaylistItem(activePlaylist.id, itemId, dir)
              }
              onRemoveItem={(itemId) => {
                void removePlaylistItem(itemId).then(async () => {
                  await refreshLocalData();
                  triggerSyncAfterEdit();
                });
              }}
            />
          ) : (
            <FolderView
              folder={route.type === 'all' ? null : activeFolder}
              folders={folders}
              songs={songs}
              cachedSongIds={cachedSongIds}
              onUploadClick={() => {
                setDroppedFiles([]);
                setUploadOpen(true);
              }}
              onDropFiles={(files) => {
                setDroppedFiles(files);
                setUploadOpen(true);
              }}
              onOpenSong={(song, contextSongs) => {
                const idx = contextSongs.findIndex((s) => s.id === song.id);
                setViewerState({
                  queue: contextSongs,
                  index: idx >= 0 ? idx : 0,
                });
              }}
              onAddToPlaylist={(song) =>
                setAddToPlaylistMode({ type: 'pick-playlists-for-song', song })
              }
              onEditSong={(song) =>
                setCreateMode({ type: 'edit-song', song, folders })
              }
              onDeleteSong={handleDeleteSong}
            />
          )}
        </main>
      </div>

      {/* Mobile Quick Bottom Bar for instant switching during church worship */}
      <nav className="fixed right-0 bottom-0 left-0 z-30 flex border-t border-slate-800 bg-slate-950/95 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setRoute({ type: 'all' })}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
            route.type === 'all' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <Library className="h-4 w-4" />
          All Songs
        </button>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
            route.type === 'folder' ? 'text-sky-400' : 'text-slate-400'
          }`}
        >
          <Layers className="h-4 w-4" />
          Folders
        </button>
        <button
          type="button"
          onClick={() => {
            if (playlists.length > 0) {
              setRoute({ type: 'playlist', playlistId: playlists[0].id });
            } else {
              setCreateMode({ type: 'create-playlist' });
            }
          }}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
            route.type === 'playlist' ? 'text-emerald-400' : 'text-slate-400'
          }`}
        >
          <ListMusic className="h-4 w-4" />
          Playlists
        </button>
        <button
          type="button"
          onClick={() => {
            setDroppedFiles([]);
            setUploadOpen(true);
          }}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-amber-300"
        >
          <Upload className="h-4 w-4" />
          Upload
        </button>
      </nav>

      {/* Modals */}
      <UploadModal
        open={uploadOpen}
        folders={folders}
        playlists={playlists}
        defaultFolderId={defaultUploadFolderId}
        defaultPlaylistId={defaultUploadPlaylistId}
        initialFiles={droppedFiles}
        onClose={() => {
          setUploadOpen(false);
          setDroppedFiles([]);
        }}
        onUpload={handleUpload}
      />

      <CreateModal
        mode={createMode}
        onClose={() => setCreateMode(null)}
        onSaveFolder={handleSaveFolder}
        onSavePlaylist={handleSavePlaylist}
        onSaveSongMeta={handleSaveSongMeta}
      />

      <AddToPlaylistModal
        mode={addToPlaylistMode}
        playlists={playlists}
        songs={songs}
        folders={folders}
        playlistItems={playlistItems}
        onClose={() => setAddToPlaylistMode(null)}
        onAddSongsToPlaylist={async (playlistId, songIds) => {
          await addSongsToPlaylist(playlistId, songIds);
          await refreshLocalData();
          triggerSyncAfterEdit();
          showToast('Added to playlist!');
        }}
        onCreateNewPlaylist={() => setCreateMode({ type: 'create-playlist' })}
      />

      <SyncSettingsModal
        open={settingsOpen}
        syncStatus={syncStatus}
        storageStats={storageStats}
        totalSongsCount={songs.length}
        onClose={() => setSettingsOpen(false)}
        onConfigChanged={async () => {
          await refreshLocalData();
          await syncManager.emitStatus();
        }}
      />

      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        onConfirm={() => void confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />

      {viewerState && (
        <ViewerModal
          songsQueue={viewerState.queue}
          initialIndex={viewerState.index}
          folders={folders}
          onClose={() => setViewerState(null)}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-500/40 bg-slate-900 px-4 py-2 text-xs font-semibold text-amber-200 shadow-xl md:bottom-6">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;

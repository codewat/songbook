import {
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Library,
  ListMusic,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { Folder as FolderModel, Playlist, PlaylistItem, Song } from '../types/models';
import { formatBytes } from '../utils/format';

export type ActiveRoute =
  | { type: 'all' }
  | { type: 'folder'; folderId: string }
  | { type: 'playlist'; playlistId: string };

interface SidebarProps {
  openMobile: boolean;
  onCloseMobile: () => void;
  route: ActiveRoute;
  onSelectRoute: (route: ActiveRoute) => void;
  folders: FolderModel[];
  playlists: Playlist[];
  songs: Song[];
  playlistItems: PlaylistItem[];
  storageStats: { cachedFilesCount: number; totalBytes: number };
  onCreateFolder: () => void;
  onRenameFolder: (folder: FolderModel) => void;
  onDeleteFolder: (folder: FolderModel) => void;
  onCreatePlaylist: () => void;
  onSyncNow: () => void;
  isSyncing: boolean;
}

export function Sidebar({
  openMobile,
  onCloseMobile,
  route,
  onSelectRoute,
  folders,
  playlists,
  songs,
  playlistItems,
  storageStats,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreatePlaylist,
  onSyncNow,
  isSyncing,
}: SidebarProps) {
  const songCountByFolder = new Map<string, number>();
  for (const s of songs) {
    songCountByFolder.set(s.folderId, (songCountByFolder.get(s.folderId) || 0) + 1);
  }

  const songCountByPlaylist = new Map<string, number>();
  for (const item of playlistItems) {
    songCountByPlaylist.set(
      item.playlistId,
      (songCountByPlaylist.get(item.playlistId) || 0) + 1
    );
  }

  const selectAndClose = (next: ActiveRoute) => {
    onSelectRoute(next);
    onCloseMobile();
  };

  const content = (
    <div className="flex h-full flex-col bg-slate-900/95 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3.5 md:hidden">
        <span className="text-sm font-bold text-white">Folders &amp; Playlists</span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-3.5">
        {/* All Songs */}
        <div>
          <button
            type="button"
            onClick={() => selectAndClose({ type: 'all' })}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              route.type === 'all'
                ? 'bg-amber-500/15 text-amber-300'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Library className="h-4 w-4 text-amber-400" />
              All Songs
            </span>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {songs.length}
            </span>
          </button>
        </div>

        {/* Folders Section */}
        <div>
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Folders
            </span>
            <button
              type="button"
              onClick={onCreateFolder}
              title="Create New Folder"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-400 hover:bg-slate-800"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          <div className="space-y-1">
            {folders.map((folder, index) => {
              const active = route.type === 'folder' && route.folderId === folder.id;
              const count = songCountByFolder.get(folder.id) || 0;
              return (
                <div
                  key={folder.id}
                  className={`group flex items-center justify-between rounded-xl px-2.5 py-2 transition ${
                    active
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectAndClose({ type: 'folder', folderId: folder.id })}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm font-medium"
                  >
                    {folder.isDefault && index === 0 ? (
                      <Music2 className="h-4 w-4 shrink-0 text-amber-400" />
                    ) : folder.isDefault && index === 1 ? (
                      <FileText className="h-4 w-4 shrink-0 text-sky-400" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span className="truncate">{folder.name}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    {!folder.isDefault && (
                      <div className="hidden items-center gap-0.5 group-hover:flex">
                        <button
                          type="button"
                          title="Rename Folder"
                          onClick={() => onRenameFolder(folder)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Delete Folder"
                          onClick={() => onDeleteFolder(folder)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <span className="rounded-md bg-slate-800/90 px-2 py-0.5 text-xs text-slate-400">
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Playlists Section */}
        <div>
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Playlists / Lineups
            </span>
            <button
              type="button"
              onClick={onCreatePlaylist}
              title="Create New Playlist"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-400 hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          {playlists.length === 0 ? (
            <button
              type="button"
              onClick={onCreatePlaylist}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-800 px-3 py-2.5 text-xs text-slate-400 hover:border-amber-500/40 hover:text-amber-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Sunday Lineup
            </button>
          ) : (
            <div className="space-y-1">
              {playlists.map((pl) => {
                const active = route.type === 'playlist' && route.playlistId === pl.id;
                const count = songCountByPlaylist.get(pl.id) || 0;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => selectAndClose({ type: 'playlist', playlistId: pl.id })}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium transition ${
                      active
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ListMusic className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span className="truncate">{pl.name}</span>
                    </span>
                    <span className="rounded-md bg-slate-800/90 px-2 py-0.5 text-xs text-slate-400">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Offline Storage Card */}
      <div className="border-t border-slate-800 p-3.5">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
              Offline Storage
            </span>
            <button
              type="button"
              onClick={onSyncNow}
              disabled={isSyncing}
              title="Sync & cache all files offline"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-amber-300 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            <strong className="text-emerald-400">{storageStats.cachedFilesCount}</strong> of{' '}
            {songs.length} files saved in device ({formatBytes(storageStats.totalBytes)})
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-800 md:block">
        {content}
      </aside>

      {/* Mobile slide-over drawer */}
      {openMobile && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 h-full w-72 border-r border-slate-800 shadow-2xl">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

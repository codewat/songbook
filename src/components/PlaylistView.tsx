import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Cloud,
  FileText,
  Image as ImageIcon,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Folder, Playlist, PlaylistItem, Song } from '../types/models';

interface PlaylistViewProps {
  playlist: Playlist;
  items: PlaylistItem[];
  songs: Song[];
  folders: Folder[];
  cachedSongIds: Set<string>;
  onStartStageMode: (startIndex: number) => void;
  onAddSongsClick: () => void;
  onUploadToPlaylistClick: () => void;
  onEditPlaylist: () => void;
  onDeletePlaylist: () => void;
  onReorderItem: (itemId: string, direction: 'up' | 'down') => void;
  onRemoveItem: (itemId: string) => void;
}

export function PlaylistView({
  playlist,
  items,
  songs,
  folders,
  cachedSongIds,
  onStartStageMode,
  onAddSongsClick,
  onUploadToPlaylistClick,
  onEditPlaylist,
  onDeletePlaylist,
  onReorderItem,
  onRemoveItem,
}: PlaylistViewProps) {
  const songMap = new Map(songs.map((s) => [s.id, s]));
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  const resolvedRows = items
    .map((item) => ({ item, song: songMap.get(item.songId) }))
    .filter((row): row is { item: PlaylistItem; song: Song } => Boolean(row.song));

  return (
    <div className="flex h-full flex-col">
      {/* Playlist Header */}
      <div className="border-b border-slate-800/80 bg-slate-950/60 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <ListMusic className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-white">{playlist.name}</h1>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                  {resolvedRows.length} {resolvedRows.length === 1 ? 'song' : 'songs'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                {playlist.eventDate && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-amber-400" />
                    {playlist.eventDate}
                  </span>
                )}
                {playlist.description && <span>{playlist.description}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {resolvedRows.length > 0 && (
              <button
                type="button"
                onClick={() => onStartStageMode(0)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/15 hover:bg-amber-400"
              >
                <Play className="h-4 w-4 fill-current" />
                Stage Mode
              </button>
            )}
            <button
              type="button"
              onClick={onAddSongsClick}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white hover:border-amber-500/50 hover:bg-slate-800"
            >
              <Plus className="h-4 w-4 text-amber-400" />
              Add Songs
            </button>
            <button
              type="button"
              onClick={onUploadToPlaylistClick}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              <Upload className="h-4 w-4" />
              Upload New
            </button>
            <button
              type="button"
              title="Edit Playlist"
              onClick={onEditPlaylist}
              className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Delete Playlist"
              onClick={onDeletePlaylist}
              className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Lineup List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {resolvedRows.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 p-8 text-center">
            <ListMusic className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-4 text-base font-semibold text-white">
              Empty Worship Lineup
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Add songs from your Chords or Lyrics folders to prepare your Sunday lineup.
            </p>
            <div className="mt-5 flex justify-center gap-2.5">
              <button
                type="button"
                onClick={onAddSongsClick}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
              >
                <Plus className="h-4 w-4" /> Add from Library
              </button>
              <button
                type="button"
                onClick={onUploadToPlaylistClick}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
              >
                <Upload className="h-4 w-4" /> Upload File
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-2.5">
            {resolvedRows.map(({ item, song }, index) => {
              const isCached = cachedSongIds.has(song.id);
              const isFirst = index === 0;
              const isLast = index === resolvedRows.length - 1;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 transition hover:border-amber-500/40 sm:px-4"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-xs font-bold text-amber-300">
                    {index + 1}
                  </div>

                  <button
                    type="button"
                    onClick={() => onStartStageMode(index)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {song.fileType === 'pdf' ? (
                      <FileText className="h-5 w-5 shrink-0 text-rose-400" />
                    ) : (
                      <ImageIcon className="h-5 w-5 shrink-0 text-sky-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white hover:text-amber-300">
                        {song.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>{folderMap.get(song.folderId) || 'Folder'}</span>
                        {song.songKey && (
                          <span className="font-medium text-amber-300">
                            Key: {song.songKey}
                          </span>
                        )}
                        {song.tempo && <span>• {song.tempo}</span>}
                        {isCached ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> Offline
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Cloud className="h-3 w-3" /> Cloud
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isFirst}
                      title="Move Up"
                      onClick={() => onReorderItem(item.id, 'up')}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={isLast}
                      title="Move Down"
                      onClick={() => onReorderItem(item.id, 'down')}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Remove from Playlist"
                      onClick={() => onRemoveItem(item.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

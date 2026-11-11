import { useMemo, useState } from 'react';
import {
  Check,
  FileText,
  Image as ImageIcon,
  ListMusic,
  Plus,
  Presentation,
  Search,
  X,
} from 'lucide-react';
import { UNFILED_FOLDER_ID, type Folder, type Playlist, type PlaylistItem, type Song } from '../types/models';
import { isPowerPointType } from '../utils/format';

export type AddToPlaylistMode =
  | { type: 'pick-playlists-for-song'; song: Song }
  | { type: 'pick-songs-for-playlist'; playlist: Playlist };

interface AddToPlaylistModalProps {
  mode: AddToPlaylistMode | null;
  playlists: Playlist[];
  songs: Song[];
  folders: Folder[];
  playlistItems: PlaylistItem[];
  onClose: () => void;
  onAddSongsToPlaylist: (playlistId: string, songIds: string[]) => Promise<void>;
  onCreateNewPlaylist: () => void;
}

export function AddToPlaylistModal({
  mode,
  playlists,
  songs,
  folders,
  playlistItems,
  onClose,
  onAddSongsToPlaylist,
  onCreateNewPlaylist,
}: AddToPlaylistModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [saving, setSaving] = useState(false);

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  const existingSongIdsInTarget = useMemo(() => {
    if (!mode || mode.type !== 'pick-songs-for-playlist') return new Set<string>();
    return new Set(
      playlistItems
        .filter((item) => item.playlistId === mode.playlist.id)
        .map((item) => item.songId)
    );
  }, [mode, playlistItems]);

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs.filter((s) => {
      if (folderFilter !== 'all' && s.folderId !== folderFilter) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.songKey && s.songKey.toLowerCase().includes(q)) ||
        (folderMap.get(s.folderId)?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [songs, query, folderFilter, folderMap]);

  if (!mode) return null;

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      if (mode.type === 'pick-playlists-for-song') {
        for (const pid of selectedIds) {
          await onAddSongsToPlaylist(pid, [mode.song.id]);
        }
      } else {
        await onAddSongsToPlaylist(mode.playlist.id, selectedIds);
      }
      setSelectedIds([]);
      setQuery('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <ListMusic className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {mode.type === 'pick-playlists-for-song'
                  ? `Add "${mode.song.title}" to Playlist`
                  : `Add Songs to "${mode.playlist.name}"`}
              </h2>
              <p className="text-xs text-slate-400">
                {mode.type === 'pick-playlists-for-song'
                  ? 'Select one or more worship lineups'
                  : 'Pick chords, lyrics sheets, or slides for this setlist'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedIds([]);
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode.type === 'pick-playlists-for-song' ? (
          <div className="flex-1 space-y-2 overflow-y-auto p-5">
            {playlists.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center">
                <p className="text-sm text-slate-300">No playlists yet.</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onCreateNewPlaylist();
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Plus className="h-4 w-4" /> Create First Playlist
                </button>
              </div>
            ) : (
              playlists.map((pl) => {
                const already = playlistItems.some(
                  (i) => i.playlistId === pl.id && i.songId === mode.song.id
                );
                const checked = selectedIds.includes(pl.id);
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => toggleId(pl.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                      checked
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{pl.name}</p>
                      <p className="text-xs text-slate-400">
                        {pl.eventDate || pl.description || 'Worship lineup'}
                        {already ? ' • Already added' : ''}
                      </p>
                    </div>
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-lg border ${
                        checked
                          ? 'border-amber-500 bg-amber-500 text-slate-950'
                          : 'border-slate-700 bg-slate-900'
                      }`}
                    >
                      {checked && <Check className="h-4 w-4 stroke-[3]" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden p-5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search songs or key..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-3 pl-9 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>
              <select
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
              >
                <option value="all">All Folders</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
              {filteredSongs.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No matching songs found.
                </p>
              ) : (
                filteredSongs.map((s) => {
                  const checked = selectedIds.includes(s.id);
                  const alreadyIn = existingSongIdsInTarget.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleId(s.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${
                        checked
                          ? 'border-amber-500 bg-amber-500/10'
                          : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {s.fileType === 'pdf' ? (
                          <FileText className="h-4 w-4 shrink-0 text-rose-400" />
                        ) : isPowerPointType(s.fileType) ? (
                          <Presentation className="h-4 w-4 shrink-0 text-indigo-400" />
                        ) : (
                          <ImageIcon className="h-4 w-4 shrink-0 text-sky-400" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {s.title}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {folderMap.get(s.folderId) ||
                              (s.folderId === UNFILED_FOLDER_ID ? 'All Songs' : 'Folder')}
                            {s.songKey ? ` • Key: ${s.songKey}` : ''}
                            {alreadyIn ? ' • Already in playlist' : ''}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                          checked
                            ? 'border-amber-500 bg-amber-500 text-slate-950'
                            : 'border-slate-700 bg-slate-900'
                        }`}
                      >
                        {checked && <Check className="h-4 w-4 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-4">
          <span className="text-xs text-slate-400">
            {selectedIds.length} selected
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                onClose();
              }}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || selectedIds.length === 0}
              onClick={handleConfirm}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Selected'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

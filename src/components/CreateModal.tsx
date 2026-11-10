import { useEffect, useState } from 'react';
import { FolderPlus, ListMusic, Pencil, X } from 'lucide-react';
import type { Folder, Playlist, Song } from '../types/models';

export type CreateModalMode =
  | { type: 'create-folder' }
  | { type: 'rename-folder'; folder: Folder }
  | { type: 'create-playlist' }
  | { type: 'edit-playlist'; playlist: Playlist }
  | { type: 'edit-song'; song: Song; folders: Folder[] };

interface CreateModalProps {
  mode: CreateModalMode | null;
  onClose: () => void;
  onSaveFolder: (name: string, folderId?: string) => Promise<void>;
  onSavePlaylist: (
    data: { name: string; description: string; eventDate: string },
    playlistId?: string
  ) => Promise<void>;
  onSaveSongMeta: (
    songId: string,
    updates: {
      title: string;
      folderId: string;
      songKey: string;
      tempo: string;
      notes: string;
    }
  ) => Promise<void>;
}

export function CreateModal({
  mode,
  onClose,
  onSaveFolder,
  onSavePlaylist,
  onSaveSongMeta,
}: CreateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [folderId, setFolderId] = useState('');
  const [songKey, setSongKey] = useState('');
  const [tempo, setTempo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!mode) return;
    if (mode.type === 'create-folder') {
      setName('');
    } else if (mode.type === 'rename-folder') {
      setName(mode.folder.name);
    } else if (mode.type === 'create-playlist') {
      setName('');
      setDescription('');
      setEventDate(new Date().toISOString().slice(0, 10));
    } else if (mode.type === 'edit-playlist') {
      setName(mode.playlist.name);
      setDescription(mode.playlist.description || '');
      setEventDate(mode.playlist.eventDate || '');
    } else if (mode.type === 'edit-song') {
      setName(mode.song.title);
      setFolderId(mode.song.folderId);
      setSongKey(mode.song.songKey || '');
      setTempo(mode.song.tempo || '');
      setNotes(mode.song.notes || '');
    }
  }, [mode]);

  if (!mode) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setSaving(true);
    try {
      if (mode.type === 'create-folder') {
        await onSaveFolder(name);
      } else if (mode.type === 'rename-folder') {
        await onSaveFolder(name, mode.folder.id);
      } else if (mode.type === 'create-playlist') {
        await onSavePlaylist({ name, description, eventDate });
      } else if (mode.type === 'edit-playlist') {
        await onSavePlaylist({ name, description, eventDate }, mode.playlist.id);
      } else if (mode.type === 'edit-song') {
        await onSaveSongMeta(mode.song.id, {
          title: name,
          folderId,
          songKey,
          tempo,
          notes,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  };

  const titleMap: Record<CreateModalMode['type'], string> = {
    'create-folder': 'Create New Folder',
    'rename-folder': 'Rename Folder',
    'create-playlist': 'Create New Playlist / Lineup',
    'edit-playlist': 'Edit Playlist Details',
    'edit-song': 'Edit Song Details',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              {mode.type.includes('folder') ? (
                <FolderPlus className="h-5 w-5" />
              ) : mode.type.includes('playlist') ? (
                <ListMusic className="h-5 w-5" />
              ) : (
                <Pencil className="h-5 w-5" />
              )}
            </div>
            <h2 className="text-base font-semibold text-white">{titleMap[mode.type]}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              {mode.type === 'edit-song'
                ? 'Song Title'
                : mode.type.includes('playlist')
                  ? 'Playlist / Service Name'
                  : 'Folder Name'}
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                mode.type.includes('folder')
                  ? 'e.g., Special Numbers, Youth Night, Christmas'
                  : mode.type.includes('playlist')
                    ? 'e.g., Sunday Morning Service'
                    : 'Song title'
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
            />
          </div>

          {(mode.type === 'create-playlist' || mode.type === 'edit-playlist') && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Service / Event Date (Optional)
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Notes / Worship Leader (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Praise & Worship Lineup - Key of G"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>
            </>
          )}

          {mode.type === 'edit-song' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Folder
                </label>
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                >
                  {mode.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Key (Optional)
                  </label>
                  <input
                    type="text"
                    value={songKey}
                    onChange={(e) => setSongKey(e.target.value)}
                    placeholder="e.g., G, C, Bb"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Tempo / Vibe
                  </label>
                  <input
                    type="text"
                    value={tempo}
                    onChange={(e) => setTempo(e.target.value)}
                    placeholder="e.g., 74 BPM / Slow"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Notes (Capo / Intro / Transitions)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Capo 2, Soft piano intro"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                />
              </div>
            </>
          )}

          {error && (
            <p className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

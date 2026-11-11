import { useMemo, useState } from 'react';
import { FolderOpen, Music, Search, Upload } from 'lucide-react';
import { UNFILED_FOLDER_ID, type Folder, type Song } from '../types/models';
import { isPowerPointType } from '../utils/format';
import { SongCard } from './SongCard';

interface FolderViewProps {
  folder: Folder | null; // null means "All Songs"
  folders: Folder[];
  songs: Song[];
  cachedSongIds: Set<string>;
  onUploadClick: () => void;
  onDropFiles: (files: File[]) => void;
  onOpenSong: (song: Song, contextSongs: Song[]) => void;
  onAddToPlaylist: (song: Song) => void;
  onEditSong: (song: Song) => void;
  onDeleteSong: (song: Song) => void;
}

export function FolderView({
  folder,
  folders,
  songs,
  cachedSongIds,
  onUploadClick,
  onDropFiles,
  onOpenSong,
  onAddToPlaylist,
  onEditSong,
  onDeleteSong,
}: FolderViewProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'pdf' | 'image' | 'slides'>('all');
  const [dragActive, setDragActive] = useState(false);

  const folderNameMap = useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders]
  );

  const filteredSongs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return songs.filter((s) => {
      if (folder && s.folderId !== folder.id) return false;
      if (typeFilter === 'slides' && !isPowerPointType(s.fileType)) return false;
      if ((typeFilter === 'pdf' || typeFilter === 'image') && s.fileType !== typeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.fileName.toLowerCase().includes(q) ||
        (s.songKey && s.songKey.toLowerCase().includes(q)) ||
        (s.notes && s.notes.toLowerCase().includes(q))
      );
    });
  }, [songs, folder, typeFilter, search]);

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files?.length) {
          onDropFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {/* Folder Header & Controls */}
      <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-slate-950/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              {folder ? <FolderOpen className="h-5 w-5" /> : <Music className="h-5 w-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white sm:text-xl">
                  {folder ? folder.name : 'All Songs Library'}
                </h1>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                  {filteredSongs.length}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {folder
                  ? 'Custom folder — drag & drop PDFs, images, or PowerPoint (.ppt / .pptx)'
                  : 'All chords, lyrics & PowerPoint slides stored offline in this app'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onUploadClick}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/10 transition hover:bg-amber-400"
          >
            <Upload className="h-4 w-4" />
            <span>Upload File</span>
          </button>
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search song title, key (G, C, D), or notes..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pr-3 pl-9 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-1 text-xs font-medium">
            {(['all', 'pdf', 'image', 'slides'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  typeFilter === t
                    ? 'bg-slate-800 text-amber-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t === 'all'
                  ? 'All'
                  : t === 'pdf'
                    ? 'PDFs'
                    : t === 'image'
                      ? 'Images'
                      : 'Slides / PPT'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative flex-1 overflow-y-auto p-4 sm:p-6">
        {dragActive && (
          <div className="pointer-events-none absolute inset-4 z-20 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-amber-400 bg-slate-950/90 backdrop-blur-sm">
            <Upload className="h-12 w-12 text-amber-400" />
            <p className="mt-3 text-base font-semibold text-white">
              Drop PDF, Image, or PowerPoint files to save offline
            </p>
          </div>
        )}

        {filteredSongs.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-amber-400">
              <Upload className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-white">
              {search || typeFilter !== 'all'
                ? 'No matching files found'
                : `No files in ${folder ? folder.name : 'All Songs'} yet`}
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              {search || typeFilter !== 'all'
                ? 'Try clearing your search or switching file filter.'
                : 'Upload PDF chord charts, song images, or PowerPoint (.ppt / .pptx) slides. Everything stays saved offline inside this app!'}
            </p>
            {!search && typeFilter === 'all' && (
              <button
                type="button"
                onClick={onUploadClick}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
              >
                <Upload className="h-4 w-4" />
                Upload First File
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSongs.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                folderName={
                  !folder && song.folderId !== UNFILED_FOLDER_ID
                    ? folderNameMap.get(song.folderId)
                    : undefined
                }
                isCachedOffline={cachedSongIds.has(song.id)}
                onOpen={(s) => onOpenSong(s, filteredSongs)}
                onAddToPlaylist={onAddToPlaylist}
                onEdit={onEditSong}
                onDelete={onDeleteSong}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

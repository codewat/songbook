import {
  CheckCircle2,
  Cloud,
  CloudUpload,
  FileText,
  Image as ImageIcon,
  ListPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Song } from '../types/models';
import { formatBytes } from '../utils/format';

interface SongCardProps {
  song: Song;
  folderName?: string;
  isCachedOffline: boolean;
  onOpen: (song: Song) => void;
  onAddToPlaylist: (song: Song) => void;
  onEdit: (song: Song) => void;
  onDelete: (song: Song) => void;
}

export function SongCard({
  song,
  folderName,
  isCachedOffline,
  onOpen,
  onAddToPlaylist,
  onEdit,
  onDelete,
}: SongCardProps) {
  const isPdf = song.fileType === 'pdf';
  const pendingUpload = song.syncedAt === null;

  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/90 p-4 transition hover:border-amber-500/40 hover:bg-slate-900">
      <button
        type="button"
        onClick={() => onOpen(song)}
        className="flex items-start gap-3 text-left"
      >
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            isPdf
              ? 'bg-rose-500/15 text-rose-400'
              : 'bg-sky-500/15 text-sky-400'
          }`}
        >
          {isPdf ? (
            <FileText className="h-5 w-5" />
          ) : (
            <ImageIcon className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold text-white group-hover:text-amber-300">
            {song.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={`rounded-md px-1.5 py-0.5 font-semibold uppercase ${
                isPdf
                  ? 'bg-rose-500/15 text-rose-300'
                  : 'bg-sky-500/15 text-sky-300'
              }`}
            >
              {isPdf ? 'PDF' : 'IMG'}
            </span>
            {song.songKey && (
              <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300">
                Key: {song.songKey}
              </span>
            )}
            {song.tempo && (
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-300">
                {song.tempo}
              </span>
            )}
            {folderName && (
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-400">
                {folderName}
              </span>
            )}
            <span className="text-slate-500">{formatBytes(song.fileSize)}</span>
          </div>
          {song.notes && (
            <p className="mt-1.5 line-clamp-1 text-xs text-slate-400">{song.notes}</p>
          )}
        </div>
      </button>

      <div className="mt-3.5 flex items-center justify-between border-t border-slate-800/80 pt-3">
        {/* Offline & Sync indicator */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {isCachedOffline ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved Offline
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-slate-400">
              <Cloud className="h-3.5 w-3.5" />
              Cloud Only
            </span>
          )}
          {pendingUpload && (
            <span
              title="Waiting for internet to sync to team"
              className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
            >
              <CloudUpload className="h-3 w-3" />
              Pending
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Add to Playlist"
            onClick={() => onAddToPlaylist(song)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-amber-400"
          >
            <ListPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Edit Song Details"
            onClick={() => onEdit(song)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Delete Song"
            onClick={() => onDelete(song)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

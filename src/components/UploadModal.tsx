import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Presentation, Upload, X } from 'lucide-react';
import { UNFILED_FOLDER_ID, type Folder, type Playlist } from '../types/models';
import {
  cleanSongTitleFromFilename,
  detectFileType,
  formatBytes,
  isPowerPointType,
} from '../utils/format';

interface UploadModalProps {
  open: boolean;
  folders: Folder[];
  playlists: Playlist[];
  defaultFolderId: string;
  defaultPlaylistId?: string | null;
  initialFiles?: File[];
  onClose: () => void;
  onUpload: (payload: {
    files: File[];
    folderId: string;
    playlistId: string | null;
    singleMeta?: {
      title: string;
      songKey: string;
      tempo: string;
      notes: string;
    };
  }) => Promise<void>;
}

export function UploadModal({
  open,
  folders,
  playlists,
  defaultFolderId,
  defaultPlaylistId = null,
  initialFiles = [],
  onClose,
  onUpload,
}: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [playlistId, setPlaylistId] = useState<string>(defaultPlaylistId || '');
  const [title, setTitle] = useState('');
  const [songKey, setSongKey] = useState('');
  const [tempo, setTempo] = useState('');
  const [notes, setNotes] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFolderId(defaultFolderId || UNFILED_FOLDER_ID);
    setPlaylistId(defaultPlaylistId || '');
    setFiles(initialFiles);
    if (initialFiles.length === 1) {
      setTitle(cleanSongTitleFromFilename(initialFiles[0].name));
    } else {
      setTitle('');
    }
    setSongKey('');
    setTempo('');
    setNotes('');
  }, [open, defaultFolderId, defaultPlaylistId, initialFiles]);

  if (!open) return null;

  const acceptFiles = (incoming: FileList | File[]) => {
    setError(null);
    const valid: File[] = [];
    const invalid: string[] = [];
    for (const f of Array.from(incoming)) {
      if (detectFileType(f)) {
        valid.push(f);
      } else {
        invalid.push(f.name);
      }
    }
    if (invalid.length > 0) {
      setError(
        `Unsupported file(s): ${invalid.join(', ')}. Supported formats: PDF, Image, or PowerPoint (.ppt, .pptx).`
      );
    }
    if (valid.length > 0) {
      setFiles((prev) => {
        const merged = [...prev, ...valid];
        if (merged.length === 1) {
          setTitle(cleanSongTitleFromFilename(merged[0].name));
        }
        return merged;
      });
    }
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 1) {
        setTitle(cleanSongTitleFromFilename(next[0].name));
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Please select at least one PDF, image, or PowerPoint (.ppt / .pptx) file.');
      return;
    }
    const targetFolderId = folderId || UNFILED_FOLDER_ID;
    setUploading(true);
    setError(null);
    try {
      await onUpload({
        files,
        folderId: targetFolderId,
        playlistId: playlistId || null,
        singleMeta:
          files.length === 1
            ? { title, songKey, tempo, notes }
            : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Upload Songs &amp; Slides</h2>
              <p className="text-xs text-slate-400">
                Saves offline on this device immediately &amp; syncs when online
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files?.length) {
                acceptFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
              dragging
                ? 'border-amber-400 bg-amber-500/10'
                : 'border-slate-700 bg-slate-950/60 hover:border-slate-500 hover:bg-slate-950'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*,.ppt,.pptx,.pps,.ppsx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  acceptFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <Upload className="mx-auto h-8 w-8 text-amber-400" />
            <p className="mt-2 text-sm font-medium text-white">
              Tap to choose PDF, Image, or PowerPoint files
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Supports multiple files at once (.pdf, .jpg, .png, .ppt, .pptx)
            </p>
          </div>

          {/* Selected files */}
          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-300">
                Selected Files ({files.length})
              </p>
              <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {files.map((f, idx) => {
                  const kind = detectFileType(f);
                  return (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {kind === 'pdf' ? (
                          <FileText className="h-4 w-4 shrink-0 text-rose-400" />
                        ) : kind && isPowerPointType(kind) ? (
                          <Presentation className="h-4 w-4 shrink-0 text-indigo-400" />
                        ) : (
                          <ImageIcon className="h-4 w-4 shrink-0 text-sky-400" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-200">
                            {f.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatBytes(f.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFileAt(idx)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Destination Folder & Optional Playlist */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Save to Folder
              </label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
              >
                <option value={UNFILED_FOLDER_ID}>All Songs (No Folder)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Also add to Playlist (Optional)
              </label>
              <select
                value={playlistId}
                onChange={(e) => setPlaylistId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
              >
                <option value="">— None —</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Single-file metadata */}
          {files.length === 1 && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Song Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Goodness of God"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                />
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
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Tempo (Optional)
                  </label>
                  <input
                    type="text"
                    value={tempo}
                    onChange={(e) => setTempo(e.target.value)}
                    placeholder="e.g., 72 BPM"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Capo 2, Acoustic intro"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={uploading || files.length === 0}
            className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {uploading
              ? 'Saving Offline...'
              : `Save ${files.length > 0 ? `(${files.length})` : ''} Offline`}
          </button>
        </div>
      </form>
    </div>
  );
}

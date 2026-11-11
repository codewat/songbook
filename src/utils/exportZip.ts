import JSZip from 'jszip';
import { UNFILED_FOLDER_ID, type Folder, type Song } from '../types/models';

export interface ExportZipProgress {
  processed: number;
  total: number;
  currentTitle: string;
}

export interface ExportZipResult {
  blob: Blob;
  fileName: string;
  includedCount: number;
  skippedSongs: Song[];
}

export function sanitizeArchiveSegment(value: string, fallback = 'item'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned || fallback;
}

export function buildUniqueZipPath(
  usedPaths: Set<string>,
  folderName: string,
  rawFileName: string
): string {
  const safeFolder = sanitizeArchiveSegment(folderName, 'All Songs');
  const safeFile = sanitizeArchiveSegment(rawFileName, 'song.pdf');

  const dotIdx = safeFile.lastIndexOf('.');
  const hasExt = dotIdx > 0 && dotIdx < safeFile.length - 1;
  const stem = hasExt ? safeFile.slice(0, dotIdx) : safeFile;
  const ext = hasExt ? safeFile.slice(dotIdx) : '';

  let candidate = `${safeFolder}/${safeFile}`;
  let suffix = 2;
  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = `${safeFolder}/${stem} (${suffix})${ext}`;
    suffix += 1;
  }
  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

export function formatExportZipFileName(date: Date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `worshipdeck-songs-${yyyy}-${mm}-${dd}.zip`;
}

export async function buildSongsArchiveZip(options: {
  songs: Song[];
  folders: Folder[];
  resolveBlob: (song: Song) => Promise<Blob | null>;
  onProgress?: (progress: ExportZipProgress) => void;
  date?: Date;
}): Promise<ExportZipResult> {
  const { songs, folders, resolveBlob, onProgress, date } = options;
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const skippedSongs: Song[] = [];
  let includedCount = 0;

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    onProgress?.({
      processed: i,
      total: songs.length,
      currentTitle: song.title,
    });

    const folderName =
      song.folderId === UNFILED_FOLDER_ID
        ? 'All Songs'
        : folderMap.get(song.folderId) || 'All Songs';

    let blob: Blob | null = null;
    try {
      blob = await resolveBlob(song);
    } catch {
      blob = null;
    }

    if (!blob) {
      skippedSongs.push(song);
      continue;
    }

    const entryPath = buildUniqueZipPath(
      usedPaths,
      folderName,
      song.fileName || `${song.title}.${song.fileType}`
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    zip.file(entryPath, bytes);
    includedCount += 1;
  }

  onProgress?.({
    processed: songs.length,
    total: songs.length,
    currentTitle: 'Packaging ZIP archive...',
  });

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    blob: new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' }),
    fileName: formatExportZipFileName(date),
    includedCount,
    skippedSongs,
  };
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ListMusic,
  Moon,
  RotateCcw,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getSongBlob } from '../db/localDb';
import { useWakeLock } from '../hooks/useWakeLock';
import { syncManager } from '../sync/syncEngine';
import type { Folder, Song } from '../types/models';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ViewerModalProps {
  songsQueue: Song[];
  initialIndex: number;
  folders: Folder[];
  onClose: () => void;
}

export function ViewerModal({
  songsQueue,
  initialIndex,
  folders,
  onClose,
}: ViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [stageDarkSheet, setStageDarkSheet] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const wakeLock = useWakeLock(true);

  const currentSong = songsQueue[currentIndex];
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Keyboard shortcuts: Left/Right for Bluetooth pedals/laptops, Escape to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentIndex < songsQueue.length - 1) {
        setCurrentIndex((i) => i + 1);
      }
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentIndex, songsQueue.length, onClose]);

  // Load song blob from IndexedDB (or download on demand if online)
  useEffect(() => {
    if (!currentSong) return;
    let cancelled = false;
    let createdObjectUrl: string | null = null;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;

    setLoading(true);
    setError(null);
    setImageUrl(null);
    setPdfDoc(null);
    setPdfPageCount(0);

    const loadFile = async () => {
      try {
        let blob: Blob | null = null;
        const local = await getSongBlob(currentSong.id);
        if (local) {
          blob = local.blob;
        } else {
          blob = await syncManager.downloadSingleSong(currentSong);
        }

        if (cancelled) return;
        if (!blob) {
          setError(
            'This song is not cached offline yet and you are currently offline. Connect to internet once to download it.'
          );
          setLoading(false);
          return;
        }

        if (currentSong.fileType === 'image') {
          createdObjectUrl = URL.createObjectURL(blob);
          setImageUrl(createdObjectUrl);
          setLoading(false);
        } else {
          const buffer = await blob.arrayBuffer();
          if (cancelled) return;
          const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(buffer),
          });
          loadedPdf = await loadingTask.promise;
          if (cancelled) {
            await loadedPdf.destroy();
            return;
          }
          setPdfDoc(loadedPdf);
          setPdfPageCount(loadedPdf.numPages);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to open file.');
          setLoading(false);
        }
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
      if (loadedPdf) void loadedPdf.destroy();
    };
  }, [currentSong]);

  // Render all PDF pages to high-DPI canvases cleanly inside the container
  useEffect(() => {
    if (!pdfDoc || !canvasContainerRef.current) return;
    let cancelled = false;
    const container = canvasContainerRef.current;
    container.innerHTML = '';

    const renderPages = async () => {
      const containerWidth = Math.max(container.clientWidth - 24, 300);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(containerWidth / baseViewport.width, 2.2);
        const cssScale = fitScale * zoom;
        const viewport = page.getViewport({ scale: cssScale });

        const pageWrap = document.createElement('div');
        pageWrap.className =
          'relative mb-4 overflow-hidden rounded-xl bg-white shadow-xl';

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.className = 'block';

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        pageWrap.appendChild(canvas);
        container.appendChild(pageWrap);

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;
      }
    };

    void renderPages();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, zoom]);

  if (!currentSong) return null;

  const handleSaveCopyToDevice = async () => {
    const local = await getSongBlob(currentSong.id);
    if (!local) return;
    const url = URL.createObjectURL(local.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentSong.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Top Stage Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-200 hover:bg-slate-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-bold text-white sm:text-base">
                {currentSong.title}
              </h2>
              {currentSong.songKey && (
                <span className="shrink-0 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                  Key {currentSong.songKey}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-slate-400">
              {folderMap.get(currentSong.folderId) || 'Song'}
              {currentSong.tempo ? ` • ${currentSong.tempo}` : ''}
              {pdfPageCount > 0 ? ` • ${pdfPageCount} page${pdfPageCount > 1 ? 's' : ''}` : ''}
              {currentSong.notes ? ` • ${currentSong.notes}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-0.5">
            <button
              type="button"
              title="Zoom Out"
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[44px] text-center text-xs font-medium text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              title="Zoom In"
              onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                title="Reset Zoom"
                onClick={() => setZoom(1)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Stage Dark Invert Toggle */}
          <button
            type="button"
            onClick={() => setStageDarkSheet((v) => !v)}
            title="Invert sheet colors for dark church stage"
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
              stageDarkSheet
                ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Stage Invert</span>
          </button>

          {/* Keep Screen Awake */}
          {wakeLock.supported && (
            <button
              type="button"
              onClick={wakeLock.toggle}
              title="Keep screen awake while playing"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
                wakeLock.enabled
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              <span className="hidden md:inline">
                {wakeLock.enabled ? 'Awake On' : 'Awake Off'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveCopyToDevice}
            title="Export / Save file copy"
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sheet Viewport */}
      <div className="relative flex-1 overflow-auto bg-slate-950 p-3 sm:p-6">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-4 text-sm text-slate-300">
              Loading sheet from offline storage...
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
            <p className="text-sm font-medium text-rose-200">{error}</p>
          </div>
        )}

        {!loading && !error && currentSong.fileType === 'image' && imageUrl && (
          <div className="flex min-h-full items-start justify-center">
            <img
              src={imageUrl}
              alt={currentSong.title}
              style={{
                width: `${Math.round(zoom * 100)}%`,
                maxWidth: zoom <= 1 ? '920px' : 'none',
              }}
              className={`rounded-xl shadow-2xl transition ${
                stageDarkSheet ? 'stage-invert-image' : ''
              }`}
            />
          </div>
        )}

        {!loading && !error && currentSong.fileType === 'pdf' && (
          <div
            ref={canvasContainerRef}
            className={`mx-auto flex max-w-4xl flex-col items-center ${
              stageDarkSheet ? 'stage-invert-pdf' : ''
            }`}
          />
        )}

        {/* Quick Queue Drawer */}
        {showQueueDrawer && songsQueue.length > 1 && (
          <div className="fixed right-4 bottom-20 z-20 max-h-80 w-72 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md">
            <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 uppercase">
              Lineup Queue ({songsQueue.length})
            </p>
            <div className="space-y-1">
              {songsQueue.map((s, idx) => (
                <button
                  key={`${s.id}-${idx}`}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(idx);
                    setShowQueueDrawer(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium ${
                    idx === currentIndex
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">
                    {idx + 1}. {s.title}
                  </span>
                  {s.songKey && (
                    <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                      {s.songKey}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Stage Navigation Bar (Great for tablets & phones on stage) */}
      {songsQueue.length > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/95 px-4 py-2.5">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev Song
          </button>

          <button
            type="button"
            onClick={() => setShowQueueDrawer((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-slate-800"
          >
            <ListMusic className="h-4 w-4" />
            <span>
              {currentIndex + 1} / {songsQueue.length}
            </span>
          </button>

          <button
            type="button"
            disabled={currentIndex >= songsQueue.length - 1}
            onClick={() =>
              setCurrentIndex((i) => Math.min(songsQueue.length - 1, i + 1))
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-30"
          >
            Next Song
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

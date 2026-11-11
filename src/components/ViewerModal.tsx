import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ListMusic,
  Maximize2,
  Minimize2,
  Moon,
  Presentation,
  RotateCcw,
  StickyNote,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getSongBlob } from '../db/localDb';
import { useWakeLock } from '../hooks/useWakeLock';
import { syncManager } from '../sync/syncEngine';
import { UNFILED_FOLDER_ID, type Folder, type Song, type StagePreferences } from '../types/models';
import { isPowerPointType } from '../utils/format';
import { parsePresentationBlob, type ParsedPresentation } from '../utils/powerpoint';
import {
  canHorizontalSwipeNavigate,
  clampViewerZoom,
  getTouchDistance,
  shouldCommitHorizontalSwipe,
  VIEWER_ZOOM_STEP,
} from '../utils/viewerGestures';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ViewerModalProps {
  songsQueue: Song[];
  initialIndex: number;
  initialFullscreen?: boolean;
  folders: Folder[];
  stagePrefs?: StagePreferences;
  onClose: () => void;
}

export function ViewerModal({
  songsQueue,
  initialIndex,
  initialFullscreen = false,
  folders,
  stagePrefs,
  onClose,
}: ViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pinchScale, setPinchScale] = useState(1);
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [swipeHint, setSwipeHint] = useState<'next' | 'prev' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(initialFullscreen));
  const [stageDarkSheet, setStageDarkSheet] = useState(
    stagePrefs?.defaultStageInvert ?? false
  );
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  const [presentation, setPresentation] = useState<ParsedPresentation | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [pptViewMode, setPptViewMode] = useState<'slides' | 'text'>('slides');
  const [showNotes, setShowNotes] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 560 });
  const [resizeTick, setResizeTick] = useState(0);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const slideViewportRef = useRef<HTMLDivElement>(null);
  const wasNativeFullscreenRef = useRef(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  );
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pinchScaleRef = useRef(1);
  const goNextRef = useRef<() => void>(() => {});
  const goPrevRef = useRef<() => void>(() => {});
  const canGoNextRef = useRef(false);
  const canGoPrevRef = useRef(false);
  const wakeLock = useWakeLock(stagePrefs?.defaultKeepAwake ?? true);

  const currentSong = songsQueue[currentIndex];
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const isPowerPoint = currentSong ? isPowerPointType(currentSong.fileType) : false;
  const slideCount = presentation?.slides.length || 0;

  const hasPrevStep =
    (isPowerPoint && presentation && pptViewMode === 'slides' && slideIndex > 0) ||
    currentIndex > 0;
  const hasNextStep =
    (isPowerPoint &&
      presentation &&
      pptViewMode === 'slides' &&
      slideIndex < slideCount - 1) ||
    currentIndex < songsQueue.length - 1;

  const handleClose = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
    wasNativeFullscreenRef.current = false;
    onClose();
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined);
      }
      wasNativeFullscreenRef.current = false;
      setIsFullscreen(false);
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
      setIsFullscreen(true);
    }
  };

  const handleGoNext = () => {
    if (isPowerPoint && presentation && pptViewMode === 'slides') {
      if (slideIndex < presentation.slides.length - 1) {
        setSlideIndex((s) => s + 1);
        slideViewportRef.current?.scrollTo({ top: 0, left: 0 });
        return;
      }
    }
    if (currentIndex < songsQueue.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleGoPrev = () => {
    if (isPowerPoint && presentation && pptViewMode === 'slides') {
      if (slideIndex > 0) {
        setSlideIndex((s) => s - 1);
        slideViewportRef.current?.scrollTo({ top: 0, left: 0 });
        return;
      }
    }
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  };

  goNextRef.current = handleGoNext;
  goPrevRef.current = handleGoPrev;
  canGoNextRef.current = Boolean(hasNextStep);
  canGoPrevRef.current = Boolean(hasPrevStep);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setIsFullscreen(Boolean(initialFullscreen));
  }, [initialFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const nativeActive = Boolean(document.fullscreenElement);
      if (nativeActive) {
        wasNativeFullscreenRef.current = true;
        setIsFullscreen(true);
      } else if (wasNativeFullscreenRef.current) {
        wasNativeFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    setStageDarkSheet(stagePrefs?.defaultStageInvert ?? false);
  }, [stagePrefs?.defaultStageInvert]);

  // Measure available slide stage viewport dynamically across mobile/tablet/desktop
  useEffect(() => {
    const el = slideViewportRef.current;
    if (!el) return;

    const updateSize = () => {
      setViewportSize({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, error, isPowerPoint, pptViewMode, showNotes, isFullscreen]);

  // Re-fit PDF width only on real window resizes/orientation changes
  useEffect(() => {
    let timer: number | undefined;
    const onWindowResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setResizeTick((t) => t + 1);
      }, 140);
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onWindowResize);
    };
  }, []);

  // Native touch swipe (next/prev song or slide), 2-finger pinch-to-zoom, and Ctrl/Meta + wheel zoom
  useEffect(() => {
    const viewport = slideViewportRef.current;
    if (!viewport) return;

    type GestureMode = 'idle' | 'pinch' | 'swipe' | 'scroll';
    let mode: GestureMode = 'idle';
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let startScrollLeft = 0;
    let pinchStartDist = 0;
    let pinchBaseZoom = 1;
    let justPinched = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('[data-no-gesture="true"]')
      ) {
        return;
      }

      if (e.touches.length === 2) {
        mode = 'pinch';
        justPinched = true;
        pinchStartDist = Math.max(
          getTouchDistance(e.touches[0], e.touches[1]),
          10
        );
        pinchBaseZoom = zoomRef.current;
        pinchScaleRef.current = 1;
        setSwipeOffsetX(0);
        setSwipeHint(null);
      } else if (e.touches.length === 1 && !justPinched) {
        mode = 'idle';
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = performance.now();
        startScrollLeft = viewport.scrollLeft;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (mode !== 'pinch') {
          mode = 'pinch';
          justPinched = true;
          pinchStartDist = Math.max(
            getTouchDistance(e.touches[0], e.touches[1]),
            10
          );
          pinchBaseZoom = zoomRef.current;
          setSwipeOffsetX(0);
          setSwipeHint(null);
        }
        e.preventDefault();
        const dist = getTouchDistance(e.touches[0], e.touches[1]);
        const targetZoom = clampViewerZoom(
          pinchBaseZoom * (dist / pinchStartDist)
        );
        const visualScale = targetZoom / pinchBaseZoom;
        pinchScaleRef.current = visualScale;
        setPinchScale(visualScale);
        return;
      }

      if (e.touches.length === 1 && mode !== 'pinch' && !justPinched) {
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        if (mode === 'idle') {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

          if (Math.abs(dy) >= Math.abs(dx)) {
            mode = 'scroll';
            return;
          }

          const allowSwipe = canHorizontalSwipeNavigate({
            zoom: zoomRef.current,
            dx,
            dy,
            startScrollLeft,
            scrollWidth: viewport.scrollWidth,
            clientWidth: viewport.clientWidth,
          });

          if (!allowSwipe) {
            mode = 'scroll';
            return;
          }

          mode = 'swipe';
        }

        if (mode === 'swipe') {
          e.preventDefault();
          const hasTarget =
            (dx < 0 && canGoNextRef.current) ||
            (dx > 0 && canGoPrevRef.current);

          if (!hasTarget) {
            const resisted = Math.max(-28, Math.min(28, dx * 0.18));
            setSwipeOffsetX(resisted);
            setSwipeHint(null);
            return;
          }

          const visualDx = Math.max(-110, Math.min(110, dx * 0.65));
          setSwipeOffsetX(visualDx);
          if (dx <= -36) {
            setSwipeHint('next');
          } else if (dx >= 36) {
            setSwipeHint('prev');
          } else {
            setSwipeHint(null);
          }
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (mode === 'pinch' && e.touches.length < 2) {
        const committedZoom = clampViewerZoom(
          pinchBaseZoom * pinchScaleRef.current
        );
        pinchScaleRef.current = 1;
        setPinchScale(1);
        setZoom(committedZoom);
        mode = 'idle';
      } else if (mode === 'swipe' && e.touches.length === 0) {
        const touch = e.changedTouches[0];
        if (touch && e.type === 'touchend') {
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          const dir = shouldCommitHorizontalSwipe({
            dx,
            dy,
            elapsedMs: performance.now() - startTime,
          });
          if (dir === 'next') {
            goNextRef.current();
          } else if (dir === 'prev') {
            goPrevRef.current();
          }
        }
        mode = 'idle';
        setSwipeOffsetX(0);
        setSwipeHint(null);
      }

      if (e.touches.length === 0) {
        mode = 'idle';
        justPinched = false;
        setSwipeOffsetX(0);
        setSwipeHint(null);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.004;
      setZoom((prev) => clampViewerZoom(prev + delta));
    };

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    viewport.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
      viewport.removeEventListener('wheel', handleWheel);
    };
  }, [Boolean(currentSong)]);

  // Keyboard shortcuts: Left/Right for slides & songs (pedals/laptops), Escape exits fullscreen then closes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => undefined);
          }
          wasNativeFullscreenRef.current = false;
          setIsFullscreen(false);
          return;
        }
        handleClose();
        return;
      }

      if (e.key === 'ArrowRight') {
        goNextRef.current();
      }

      if (e.key === 'ArrowLeft') {
        goPrevRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Load song blob from IndexedDB (or download on demand if online)
  useEffect(() => {
    if (!currentSong) return;
    let cancelled = false;
    let createdObjectUrl: string | null = null;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;
    let mediaUrlsToRevoke: string[] = [];

    setLoading(true);
    setError(null);
    setImageUrl(null);
    setPdfDoc(null);
    setPdfPageCount(0);
    setPresentation(null);
    setSlideIndex(0);
    setPptViewMode('slides');
    setShowNotes(false);
    setSwipeOffsetX(0);
    setSwipeHint(null);
    setPinchScale(1);
    pinchScaleRef.current = 1;
    slideViewportRef.current?.scrollTo({ top: 0, left: 0 });

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
        } else if (isPowerPointType(currentSong.fileType)) {
          const parsed = await parsePresentationBlob(
            blob,
            currentSong.fileType === 'ppt' ? 'ppt' : 'pptx'
          );
          if (cancelled) {
            for (const url of parsed.mediaUrlsToRevoke) URL.revokeObjectURL(url);
            return;
          }
          mediaUrlsToRevoke = parsed.mediaUrlsToRevoke;
          setPresentation(parsed);
          setSlideIndex(0);
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
      for (const url of mediaUrlsToRevoke) URL.revokeObjectURL(url);
      if (loadedPdf) void loadedPdf.destroy();
    };
  }, [currentSong]);

  // Render all PDF pages to high-DPI canvases cleanly inside the container
  useEffect(() => {
    if (!pdfDoc || !canvasContainerRef.current) return;
    let cancelled = false;
    const container = canvasContainerRef.current;

    const renderPages = async () => {
      const rawViewportWidth =
        slideViewportRef.current?.clientWidth ||
        container.parentElement?.clientWidth ||
        window.innerWidth;
      const horizontalPad = isFullscreen ? 12 : 24;
      const containerWidth = Math.min(
        Math.max(rawViewportWidth - horizontalPad, 280),
        896
      );
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

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;

        if (cancelled) return;

        if (pageNum === 1) {
          container.replaceChildren(pageWrap);
        } else {
          container.appendChild(pageWrap);
        }
      }
    };

    void renderPages();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, zoom, isFullscreen, resizeTick]);

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

  const activeSlide =
    presentation && presentation.slides.length > 0
      ? presentation.slides[Math.min(slideIndex, presentation.slides.length - 1)]
      : null;

  const horizontalPadding = isFullscreen ? 12 : 24;
  const displayZoomPercent = Math.round(clampViewerZoom(zoom * pinchScale) * 100);

  let slideScale = zoom;
  let scaledSlideWidth = 960;
  let scaledSlideHeight = 540;
  if (presentation) {
    const availW = Math.max(viewportSize.width - horizontalPadding, 240);
    const availH = Math.max(viewportSize.height - horizontalPadding, 180);
    const fitScale = Math.max(
      0.2,
      Math.min(
        availW / presentation.slideWidthPx,
        availH / presentation.slideHeightPx,
        1.45
      )
    );
    slideScale = fitScale * zoom;
    scaledSlideWidth = Math.round(presentation.slideWidthPx * slideScale);
    scaledSlideHeight = Math.round(presentation.slideHeightPx * slideScale);
  }

  const baseImageWidth = Math.min(
    Math.max(viewportSize.width - horizontalPadding, 260),
    920
  );
  const imageStyle: React.CSSProperties =
    zoom <= 1
      ? {
          width: `${Math.round(zoom * 100)}%`,
          maxWidth: '920px',
        }
      : {
          width: `${Math.round(baseImageWidth * zoom)}px`,
          maxWidth: 'none',
        };

  const swipeHintLabel =
    swipeHint === 'next'
      ? isPowerPoint &&
        presentation &&
        pptViewMode === 'slides' &&
        slideIndex < slideCount - 1
        ? `Slide ${slideIndex + 2} / ${slideCount} →`
        : currentIndex < songsQueue.length - 1
          ? `Next: ${songsQueue[currentIndex + 1].title} →`
          : null
      : swipeHint === 'prev'
        ? isPowerPoint &&
          presentation &&
          pptViewMode === 'slides' &&
          slideIndex > 0
          ? `← Slide ${slideIndex} / ${slideCount}`
          : currentIndex > 0
            ? `← Prev: ${songsQueue[currentIndex - 1].title}`
            : null
        : null;

  const hasTransformActive = pinchScale !== 1 || swipeOffsetX !== 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Top Stage Toolbar (Hidden in Full Screen) */}
      {!isFullscreen && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={handleClose}
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
                {folderMap.get(currentSong.folderId) ||
                  (currentSong.folderId === UNFILED_FOLDER_ID ? 'All Songs' : 'Song')}
                {currentSong.tempo ? ` • ${currentSong.tempo}` : ''}
                {pdfPageCount > 0 ? ` • ${pdfPageCount} page${pdfPageCount > 1 ? 's' : ''}` : ''}
                {slideCount > 0 ? ` • ${slideCount} slide${slideCount > 1 ? 's' : ''}` : ''}
                {currentSong.notes ? ` • ${currentSong.notes}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Zoom controls */}
            <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-0.5">
              <button
                type="button"
                title="Zoom Out"
                onClick={() => setZoom((z) => clampViewerZoom(z - VIEWER_ZOOM_STEP))}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Tap to reset zoom to 100%"
                onClick={() => {
                  setZoom(1);
                  setPinchScale(1);
                }}
                className="min-w-[44px] rounded-lg px-1 py-1 text-center text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {displayZoomPercent}%
              </button>
              <button
                type="button"
                title="Zoom In"
                onClick={() => setZoom((z) => clampViewerZoom(z + VIEWER_ZOOM_STEP))}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              {zoom !== 1 && (
                <button
                  type="button"
                  title="Reset Zoom"
                  onClick={() => {
                    setZoom(1);
                    setPinchScale(1);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Full Screen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title="Enter Full Screen mode"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Full Screen</span>
            </button>

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
      )}

      {/* PowerPoint Slide Controls Bar (Hidden in Full Screen) */}
      {!isFullscreen && !loading && !error && isPowerPoint && presentation && slideCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/75 px-3 py-2 sm:px-5">
          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setPptViewMode('slides')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                pptViewMode === 'slides'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Presentation className="h-3.5 w-3.5" />
              Slides
            </button>
            <button
              type="button"
              onClick={() => setPptViewMode('text')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                pptViewMode === 'text'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <AlignLeft className="h-3.5 w-3.5" />
              Lyrics / Text
            </button>
          </div>

          {pptViewMode === 'slides' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={slideIndex === 0}
                onClick={() => setSlideIndex((s) => Math.max(0, s - 1))}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev Slide
              </button>

              <div className="flex max-w-[260px] items-center gap-1 overflow-x-auto px-1 sm:max-w-md">
                {presentation.slides.map((sl, idx) => (
                  <button
                    key={sl.slideNumber}
                    type="button"
                    onClick={() => setSlideIndex(idx)}
                    title={sl.title}
                    className={`h-7 min-w-[28px] shrink-0 rounded-lg px-2 text-xs font-semibold transition ${
                      idx === slideIndex
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              <span className="hidden text-xs font-medium text-slate-400 sm:inline">
                Slide {slideIndex + 1} / {slideCount}
              </span>

              <button
                type="button"
                disabled={slideIndex >= slideCount - 1}
                onClick={() => setSlideIndex((s) => Math.min(slideCount - 1, s + 1))}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-30"
              >
                Next Slide
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeSlide?.notesText && (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                showNotes
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <StickyNote className="h-3.5 w-3.5" />
              Notes
            </button>
          )}
        </div>
      )}

      {/* PowerPoint format advisory banner */}
      {!isFullscreen && !loading && !error && isPowerPoint && presentation && presentation.warnings.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          <span>{presentation.warnings[0]}</span>
          <button
            type="button"
            onClick={handleSaveCopyToDevice}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-200 hover:bg-amber-500/30"
          >
            <Download className="h-3 w-3" />
            Download Original
          </button>
        </div>
      )}

      {/* Floating Full Screen Controls (Top-Right) */}
      {isFullscreen && (
        <div
          data-no-gesture="true"
          className="fixed top-3 right-3 z-30 flex items-center gap-1 rounded-2xl border border-slate-700/80 bg-slate-900/75 p-1 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            title="Zoom Out"
            onClick={() => setZoom((z) => clampViewerZoom(z - VIEWER_ZOOM_STEP))}
            className="rounded-xl p-1.5 text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Tap to reset zoom to 100%"
            onClick={() => {
              setZoom(1);
              setPinchScale(1);
            }}
            className="min-w-[42px] rounded-xl px-1.5 py-1 text-center text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            {displayZoomPercent}%
          </button>
          <button
            type="button"
            title="Zoom In"
            onClick={() => setZoom((z) => clampViewerZoom(z + VIEWER_ZOOM_STEP))}
            className="rounded-xl p-1.5 text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <div className="mx-0.5 h-4 w-px bg-slate-700/80" />

          <button
            type="button"
            title="Invert sheet colors for dark church stage"
            onClick={() => setStageDarkSheet((v) => !v)}
            className={`rounded-xl p-1.5 transition ${
              stageDarkSheet
                ? 'bg-amber-500/25 text-amber-300'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Moon className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="Exit Full Screen"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-slate-800"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exit</span>
          </button>

          <button
            type="button"
            title="Close Viewer"
            onClick={handleClose}
            className="rounded-xl p-1.5 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Floating Full Screen Bottom Navigation Pill */}
      {isFullscreen && (hasPrevStep || hasNextStep || songsQueue.length > 1) && (
        <div
          data-no-gesture="true"
          className="fixed bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/75 px-2 py-1.5 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            disabled={!hasPrevStep}
            title="Previous"
            onClick={handleGoPrev}
            className="rounded-xl p-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (songsQueue.length > 1) {
                setShowQueueDrawer((v) => !v);
              }
            }}
            className="flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-slate-800"
          >
            {songsQueue.length > 1 && <ListMusic className="h-3.5 w-3.5 shrink-0" />}
            <span className="shrink-0 text-amber-300">
              {currentIndex + 1}/{songsQueue.length}
            </span>
            <span className="max-w-[160px] truncate text-slate-100 sm:max-w-[260px]">
              {currentSong.title}
            </span>
            {isPowerPoint && presentation && pptViewMode === 'slides' && slideCount > 1 && (
              <span className="shrink-0 rounded-md bg-indigo-500/25 px-1.5 py-0.5 text-[10px] font-bold text-indigo-200">
                {slideIndex + 1}/{slideCount}
              </span>
            )}
          </button>

          <button
            type="button"
            disabled={!hasNextStep}
            title="Next"
            onClick={handleGoNext}
            className="rounded-xl bg-amber-500/90 p-1.5 text-slate-950 hover:bg-amber-400 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Live Swipe Feedback Pill */}
      {swipeHintLabel && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full border border-amber-500/40 bg-slate-900/90 px-4 py-1.5 text-xs font-bold text-amber-200 shadow-2xl backdrop-blur-md">
          {swipeHintLabel}
        </div>
      )}

      {/* Quick Queue Drawer (Outside scroll/transform viewport for crisp fixed positioning) */}
      {showQueueDrawer && songsQueue.length > 1 && (
        <div
          data-no-gesture="true"
          className={`fixed z-40 max-h-80 w-72 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md ${
            isFullscreen ? 'bottom-16 left-1/2 -translate-x-1/2' : 'right-4 bottom-20'
          }`}
        >
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

      {/* Sheet / Slide Viewport */}
      <div
        ref={slideViewportRef}
        style={{ touchAction: 'pan-x pan-y' }}
        className={`relative flex-1 overflow-auto bg-slate-950 ${
          isFullscreen ? 'p-1.5 pb-20 sm:p-3 sm:pb-20' : 'p-3 sm:p-6'
        }`}
      >
        <div
          style={{
            transform: hasTransformActive
              ? `translateX(${swipeOffsetX}px) scale(${pinchScale})`
              : undefined,
            transformOrigin: 'center top',
          }}
          className="min-h-full w-fit min-w-full"
        >
          {loading && (
            <div className="flex h-full min-h-[50vh] items-center justify-center">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-4 text-sm text-slate-300">
                {isPowerPoint
                  ? 'Rendering PowerPoint slides from offline storage...'
                  : 'Loading sheet from offline storage...'}
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
              <p className="text-sm font-medium text-rose-200">{error}</p>
              <button
                type="button"
                onClick={handleSaveCopyToDevice}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download File Copy
              </button>
            </div>
          )}

          {!loading && !error && currentSong.fileType === 'image' && imageUrl && (
            <div className="flex min-h-full w-fit min-w-full items-start justify-center">
              <img
                src={imageUrl}
                alt={currentSong.title}
                draggable={false}
                style={imageStyle}
                className={`select-none rounded-xl shadow-2xl ${
                  stageDarkSheet ? 'stage-invert-image' : ''
                }`}
              />
            </div>
          )}

          {!loading && !error && currentSong.fileType === 'pdf' && (
            <div
              ref={canvasContainerRef}
              className={`mx-auto flex w-fit min-w-full flex-col items-center ${
                stageDarkSheet ? 'stage-invert-pdf' : ''
              }`}
            />
          )}

          {!loading && !error && isPowerPoint && presentation && pptViewMode === 'slides' && activeSlide && (
            <div className="flex min-h-full w-fit min-w-full flex-col items-center justify-start gap-4">
              <div
                style={{
                  width: `${scaledSlideWidth}px`,
                  height: `${scaledSlideHeight}px`,
                }}
                className={`relative mx-auto shrink-0 overflow-hidden rounded-2xl border border-slate-800 shadow-2xl ${
                  stageDarkSheet && presentation.format === 'pptx'
                    ? 'stage-invert-slides'
                    : ''
                }`}
              >
                <div
                  style={{
                    width: `${presentation.slideWidthPx}px`,
                    height: `${presentation.slideHeightPx}px`,
                    transform: `scale(${slideScale})`,
                    transformOrigin: 'top left',
                    backgroundColor: activeSlide.backgroundColor || '#ffffff',
                    backgroundImage: activeSlide.backgroundGradient,
                  }}
                  className="relative overflow-hidden select-text"
                >
                  {activeSlide.backgroundImage && (
                    <img
                      src={activeSlide.backgroundImage}
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    />
                  )}

                  {activeSlide.elements.length === 0 && (
                    <div className="flex h-full w-full items-center justify-center p-12 text-center">
                      {activeSlide.plainTextLines.length > 0 ? (
                        <div className="space-y-4">
                          {activeSlide.plainTextLines.map((line, i) => (
                            <p
                              key={i}
                              className="text-3xl leading-snug font-semibold text-slate-100"
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xl font-medium text-slate-400">
                          (Slide {activeSlide.slideNumber})
                        </span>
                      )}
                    </div>
                  )}

                  {activeSlide.elements.map((el) => {
                    const baseStyle: React.CSSProperties = {
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${el.w}%`,
                      height: `${el.h}%`,
                      transform: el.rotationDeg
                        ? `rotate(${el.rotationDeg}deg)`
                        : undefined,
                    };

                    if (el.kind === 'image' && el.imageSrc) {
                      return (
                        <img
                          key={el.id}
                          src={el.imageSrc}
                          alt=""
                          style={baseStyle}
                          className="object-contain"
                        />
                      );
                    }

                    const justifyClass =
                      el.valign === 'middle'
                        ? 'justify-center'
                        : el.valign === 'bottom'
                          ? 'justify-end'
                          : 'justify-start';

                    return (
                      <div
                        key={el.id}
                        style={{
                          ...baseStyle,
                          backgroundColor: el.fillColor,
                          border: el.strokeColor
                            ? `2px solid ${el.strokeColor}`
                            : undefined,
                        }}
                        className={`flex flex-col overflow-hidden px-3 py-2 ${justifyClass}`}
                      >
                        {el.paragraphs?.map((para, pIdx) => (
                          <p
                            key={pIdx}
                            style={{ textAlign: para.align }}
                            className="leading-snug"
                          >
                            {para.runs.length === 0 ? (
                              <span className="inline-block h-3" />
                            ) : (
                              para.runs.map((run, rIdx) => (
                                <span
                                  key={rIdx}
                                  style={{
                                    fontSize: `${((run.fontSizePt || 18) * 96) / 72}px`,
                                    fontWeight: run.bold ? 700 : 400,
                                    fontStyle: run.italic ? 'italic' : 'normal',
                                    textDecoration: run.underline ? 'underline' : 'none',
                                    color: run.color || '#0f172a',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {run.text}
                                </span>
                              ))
                            )}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              {showNotes && activeSlide.notesText && (
                <div className="w-full max-w-3xl rounded-2xl border border-amber-500/30 bg-slate-900/95 p-4 shadow-xl">
                  <p className="text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
                    Speaker Notes — Slide {activeSlide.slideNumber}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {activeSlide.notesText}
                  </p>
                </div>
              )}
            </div>
          )}

          {!loading && !error && isPowerPoint && presentation && pptViewMode === 'text' && (
            <div className="mx-auto max-w-3xl space-y-4 pb-6">
              {presentation.slides.map((sl, idx) => (
                <div
                  key={sl.slideNumber}
                  onClick={() => {
                    setSlideIndex(idx);
                    setPptViewMode('slides');
                  }}
                  className={`cursor-pointer rounded-2xl border p-5 transition ${
                    idx === slideIndex
                      ? 'border-amber-500/50 bg-slate-900 shadow-lg'
                      : 'border-slate-800 bg-slate-900/75 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-indigo-500/20 px-2 py-0.5 text-xs font-bold text-indigo-300">
                      Slide {sl.slideNumber}
                    </span>
                    <span className="text-[11px] text-slate-400">Tap to open slide view</span>
                  </div>
                  {sl.plainTextLines.length > 0 ? (
                    <div
                      style={{ fontSize: `${Math.round(18 * zoom)}px` }}
                      className="mt-3 space-y-2 leading-relaxed font-medium text-white"
                    >
                      {sl.plainTextLines.map((line, lIdx) => (
                        <p key={lIdx}>{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm italic text-slate-500">
                      No text on this slide (image or blank slide).
                    </p>
                  )}
                  {sl.notesText && (
                    <p className="mt-3 border-t border-slate-800 pt-2.5 text-xs text-amber-300/90">
                      Notes: {sl.notesText}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Stage Navigation Bar (Hidden in Full Screen) */}
      {!isFullscreen && songsQueue.length > 1 && (
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

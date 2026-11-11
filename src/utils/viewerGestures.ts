export const MIN_VIEWER_ZOOM = 0.6;
export const MAX_VIEWER_ZOOM = 2.5;
export const VIEWER_ZOOM_STEP = 0.15;

export function clampViewerZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(MAX_VIEWER_ZOOM, Math.max(MIN_VIEWER_ZOOM, value));
  return Math.round(clamped * 100) / 100;
}

export interface Point2D {
  clientX: number;
  clientY: number;
}

export function getTouchDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Allows horizontal swipe navigation when the sheet fits horizontally
 * or when dragging past an already-reached horizontal scroll edge.
 */
export function canHorizontalSwipeNavigate(options: {
  zoom: number;
  dx: number;
  dy: number;
  startScrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  const { zoom, dx, dy, startScrollLeft, scrollWidth, clientWidth } = options;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < 12 || absDx <= absDy * 1.25) {
    return false;
  }

  const fitsHorizontally = zoom <= 1.08 || scrollWidth <= clientWidth + 8;
  if (fitsHorizontally) {
    return true;
  }

  // When zoomed wider than viewport, allow swipe only if starting cleanly from an edge
  if (dx > 0) {
    return startScrollLeft <= 2;
  }
  return startScrollLeft + clientWidth >= scrollWidth - 2;
}

export function shouldCommitHorizontalSwipe(options: {
  dx: number;
  dy: number;
  elapsedMs: number;
}): 'next' | 'prev' | null {
  const { dx, dy, elapsedMs } = options;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx <= absDy * 1.3) return null;

  const isQuickFlick = elapsedMs <= 260 && absDx >= 36;
  const isLongDrag = absDx >= 58;
  if (!isQuickFlick && !isLongDrag) return null;

  return dx < 0 ? 'next' : 'prev';
}

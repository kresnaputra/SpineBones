/**
 * Shared viewport / coordinate-transform helpers.
 *
 * The key design contract:
 *
 *   At camZoom = 1, both the editor preview and the exported video
 *   show exactly the same world region.
 *
 * The editor viewport is a rectangle inside the editor canvas.  Its
 * dimensions are determined by `getViewportRect`.  To make the world
 * extent visible inside that rectangle match the export canvas
 * (VIDEO_EXPORT_WIDTH × VIDEO_EXPORT_HEIGHT) we scale the zoom by
 *
 *   vpScale = viewportRect.width / VIDEO_EXPORT_WIDTH
 *
 * The export canvas IS the video frame, so vpScale = 1 there and no
 * correction is needed.
 */

/** Size of the exported video frame. */
export const VIDEO_EXPORT_WIDTH = 1920;
export const VIDEO_EXPORT_HEIGHT = 1080;

const VIEWPORT_ASPECT = VIDEO_EXPORT_WIDTH / VIDEO_EXPORT_HEIGHT; // 16 / 9
const VIEWPORT_MAX_SCALE = 0.9;
const VIEWPORT_MIN_SIZE = 160;

export type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Computes the 16:9 viewport rectangle (the white frame) that fits
 * inside the editor canvas.  The rectangle is always centered.
 */
export const getViewportRect = (
  canvasWidth: number,
  canvasHeight: number,
): ViewportRect => {
  const maxWidth = canvasWidth * VIEWPORT_MAX_SCALE;
  const maxHeight = canvasHeight * VIEWPORT_MAX_SCALE;

  let vpW = maxWidth;
  let vpH = vpW / VIEWPORT_ASPECT;

  if (vpH > maxHeight) {
    vpH = maxHeight;
    vpW = vpH * VIEWPORT_ASPECT;
  }

  vpW = Math.max(VIEWPORT_MIN_SIZE, vpW);
  vpH = Math.max(VIEWPORT_MIN_SIZE / VIEWPORT_ASPECT, vpH);

  return {
    x: (canvasWidth - vpW) / 2,
    y: (canvasHeight - vpH) / 2,
    width: vpW,
    height: vpH,
  };
};

/**
 * Returns the ratio that maps editor viewport pixels to export pixels.
 * Multiply camZoom by this to get the effective zoom for the editor.
 */
export const getViewportScale = (viewportRect: ViewportRect): number =>
  viewportRect.width / VIDEO_EXPORT_WIDTH;

/**
 * Effective zoom used inside the editor viewport.
 * At camZoom = 1 the viewport shows exactly the same world extent as
 * the full export canvas.
 */
export const getViewportEffectiveZoom = (
  viewportRect: ViewportRect,
  camZoom: number,
): number => camZoom * getViewportScale(viewportRect);

/**
 * World → screen transform for the editor preview.
 *
 * World origin (0, 0) maps to the center of the viewport rectangle,
 * which is also the center of the editor canvas.
 */
export const createViewportWorldToScreen = (
  viewportRect: ViewportRect,
  camX: number,
  camY: number,
  camZoom: number,
): ((wx: number, wy: number) => { x: number; y: number }) => {
  const ez = getViewportEffectiveZoom(viewportRect, camZoom);
  const cx = viewportRect.x + viewportRect.width / 2;
  const cy = viewportRect.y + viewportRect.height / 2;
  return (wx, wy) => ({
    x: (wx - camX) * ez + cx,
    y: (wy - camY) * ez + cy,
  });
};

/**
 * Screen → world transform for the editor preview.
 * Exact inverse of `createViewportWorldToScreen`.
 */
export const createViewportScreenToWorld = (
  viewportRect: ViewportRect,
  camX: number,
  camY: number,
  camZoom: number,
): ((sx: number, sy: number) => { x: number; y: number }) => {
  const ez = getViewportEffectiveZoom(viewportRect, camZoom);
  const cx = viewportRect.x + viewportRect.width / 2;
  const cy = viewportRect.y + viewportRect.height / 2;
  return (sx, sy) => ({
    x: (sx - cx) / ez + camX,
    y: (sy - cy) / ez + camY,
  });
};

/**
 * World → screen transform for the video / export renderers.
 *
 * The export canvas IS the video frame, so vpScale = 1.
 * World origin (0, 0) maps to the center of the export canvas.
 */
export const createExportWorldToScreen = (
  exportWidth: number,
  exportHeight: number,
  camX: number,
  camY: number,
  camZoom: number,
): ((wx: number, wy: number) => { x: number; y: number }) => {
  const cx = exportWidth / 2;
  const cy = exportHeight / 2;
  return (wx, wy) => ({
    x: (wx - camX) * camZoom + cx,
    y: (wy - camY) * camZoom + cy,
  });
};

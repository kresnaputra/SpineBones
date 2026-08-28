import { orbitPlaneConditioning, orbitTransform, orbitTransformInverse, transformPoint } from './mat4';

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
 * World → screen for the editor preview, with the camera orbit applied.
 *
 * ## Why the orbit is a pre-transform rather than a new projection
 *
 * The GPU computes `ortho2D * orbit * world`, and `ortho2D` reads only X and Y
 * of the orbited point — its Z row is zeroed. So rotating the point first and
 * feeding the result through the existing 2D projection is not an approximation
 * of what the renderer does; it is the same computation.
 *
 * Building a matrix-based screen transform instead would round-trip through clip
 * space and reassociate the arithmetic, landing an ulp away from the 2D formula
 * at rest. This way the overlay keeps lining up with the sprites exactly.
 *
 * `wz` is the point's layer depth. Bones live at 0; a mesh vertex belongs to an
 * attachment and takes that attachment's depth, or the handles drift away from
 * the geometry they belong to as soon as the camera turns.
 */
export const createOrbitWorldToScreen = (
  viewportRect: ViewportRect,
  camX: number,
  camY: number,
  camZoom: number,
  yaw: number,
  pitch: number,
): ((wx: number, wy: number, wz?: number) => { x: number; y: number }) => {
  const project = createViewportWorldToScreen(viewportRect, camX, camY, camZoom);
  // At rest the orbit is exactly the identity, so skip it outright: 28 call
  // sites run this per point per frame.
  if (yaw === 0 && pitch === 0) return (wx, wy) => project(wx, wy);

  const orbit = orbitTransform(camX, camY, yaw, pitch);
  return (wx, wy, wz = 0) => {
    const [ox, oy] = transformPoint(orbit, wx, wy, wz);
    return project(ox!, oy!);
  };
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

/**
 * Minimum `cos(yaw) * cos(pitch)` at which unprojection is trusted.
 *
 * Deliberately low. Pitch is already clamped to 85 degrees, where the value is
 * 0.087, and that view must stay editable — so this only refuses the genuinely
 * edge-on band around yaw +/-90, where the answer is not merely imprecise but
 * unbounded.
 */
export const MIN_PLANE_CONDITIONING = 0.02;

/**
 * Screen → world under an orbited camera, by intersecting the screen ray with
 * the plane `z = planeZ`.
 *
 * A turned camera destroys depth information: `ortho2D` zeroes clip Z, so one
 * screen point corresponds to a whole ray through the scene, and a plane has to
 * be named before a single world point exists. Bone editing uses `z = 0`; a mesh
 * vertex uses its attachment's layer depth.
 *
 * The forward path is `project2D(orbit(world).xy)`, so this inverts in the same
 * two stages: undo the 2D projection to recover the orbited point's X and Y,
 * solve for the Z that puts the point back on the requested plane, then apply
 * the inverse orbit. At yaw 0 / pitch 0 it hands back the existing 2D inverse
 * untouched, so every drag behaves exactly as it did before Phase B.
 *
 * Returns null when the plane is too close to edge-on to solve — see
 * `MIN_PLANE_CONDITIONING`. Callers must treat that as "not editable from here"
 * rather than substituting a guess.
 */
export const createOrbitScreenToWorld = (
  viewportRect: ViewportRect,
  camX: number,
  camY: number,
  camZoom: number,
  yaw: number,
  pitch: number,
): ((sx: number, sy: number, planeZ?: number) => { x: number; y: number } | null) => {
  const unproject = createViewportScreenToWorld(viewportRect, camX, camY, camZoom);
  if (yaw === 0 && pitch === 0) return (sx, sy) => unproject(sx, sy);

  if (orbitPlaneConditioning(yaw, pitch) < MIN_PLANE_CONDITIONING) return () => null;

  const inverse = orbitTransformInverse(camX, camY, yaw, pitch);
  return (sx, sy, planeZ = 0) => {
    // X and Y of the point after the orbit; its Z was discarded by the projection.
    const { x: ox, y: oy } = unproject(sx, sy);

    // Pick the Z that lands the unrotated point on the requested plane.
    const oz =
      (planeZ - inverse[2]! * ox - inverse[6]! * oy - inverse[14]!) / inverse[10]!;

    const [wx, wy] = transformPoint(inverse, ox, oy, oz);
    return { x: wx!, y: wy! };
  };
};

import type { Attachment, Bone, Slot } from '../../types';
import { VIDEO_EXPORT_HEIGHT, VIDEO_EXPORT_WIDTH, type ViewportRect } from '../viewport';
import { createMeshRenderer } from './meshRenderer';

/**
 * Offscreen WebGL renderer for the export paths.
 *
 * The Canvas-2D renderer (`imageRenderer.drawSlots`) draws every attachment as a
 * quad, so mesh deform never showed up in exported files. This wraps the same
 * `meshRenderer` the live preview uses, renders into an offscreen GL canvas, and
 * composites the result onto the export 2D canvas — so what you see in the editor
 * is what lands in the file.
 */

export interface ExportFrameScene {
  slots: Slot[];
  /** Attachments already resolved for this frame (opacity, mesh deform, warp). */
  attachments: Attachment[];
  /** Bones with world transforms already computed for this frame. */
  bones: Bone[];
  camX: number;
  camY: number;
  camZoom: number;
}

export interface ExportMeshRenderer {
  /** Upload every attachment texture; must finish before the first frame. */
  preload: (attachments: Attachment[]) => Promise<void>;
  /** Render one frame and composite it onto `ctx`. */
  drawFrame: (ctx: CanvasRenderingContext2D, scene: ExportFrameScene) => void;
  dispose: () => void;
}

/**
 * Returns null when WebGL is unavailable, letting callers fall back to the
 * Canvas-2D path (which renders images correctly, just without mesh deform).
 */
export const createExportMeshRenderer = (
  width: number,
  height: number,
): ExportMeshRenderer | null => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const gl = (canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    // Required: we read the buffer back with drawImage rather than compositing it.
    preserveDrawingBuffer: true,
  }) ?? null) as WebGLRenderingContext | null;
  if (!gl) return null;

  const renderer = createMeshRenderer(gl);

  // The export canvas IS the video frame, so the effective zoom must equal camZoom.
  // A viewport rect exactly VIDEO_EXPORT_WIDTH wide makes `getViewportScale` 1, and
  // centring it puts world origin at the canvas centre — matching the transform in
  // `createExportWorldToScreen` that the Canvas-2D export path uses.
  const viewportRect: ViewportRect = {
    x: (width - VIDEO_EXPORT_WIDTH) / 2,
    y: (height - VIDEO_EXPORT_HEIGHT) / 2,
    width: VIDEO_EXPORT_WIDTH,
    height: VIDEO_EXPORT_HEIGHT,
  };

  const preload = async (attachments: Attachment[]) => {
    await renderer.preloadTextures(
      attachments
        .filter((attachment) => attachment.imageData)
        .map((attachment) => attachment.imageData as string),
    );
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, scene: ExportFrameScene) => {
    renderer.render({
      slots: scene.slots,
      attachments: scene.attachments,
      passes: [{ bones: scene.bones, alpha: 1 }],
      camX: scene.camX,
      camY: scene.camY,
      camZoom: scene.camZoom,
      canvasWidth: width,
      canvasHeight: height,
      viewportRect,
    });
    ctx.drawImage(canvas, 0, 0);
  };

  const dispose = () => {
    renderer.dispose();
    // Browsers cap how many live WebGL contexts a page may hold, and repeated
    // exports would each leak one until GC caught up. Release it explicitly.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  return { preload, drawFrame, dispose };
};

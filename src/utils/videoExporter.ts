import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type {
  Attachment,
  AttachmentOpacityKeyframes,
  Bone,
  Deformer,
  DeformerKeyframes,
  Keyframes,
  MeshDeformKeyframes,
  Slot,
} from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { applyWarpToAttachment, resolveDeformerAtFrame } from '../engine/meshSkinning';
import { createExportMeshRenderer } from '../engine/webgl/exportRenderer';
import { drawSlots, loadImage } from '../engine/imageRenderer';
import { lerp } from '../engine/math';
import { applyEasing, normalizeKeyframeData } from './easing';
import { createExportWorldToScreen } from '../engine/viewport';
import { resolveAttachmentAtFrame } from './attachmentUtils';
import { resolveSlotsAtFrame } from './slotAnimation';

/** What `exportVideo` produced: the container varies with what the runtime can encode. */
export type VideoExportResult = {
  blob: Blob;
  /** File extension without the dot, matching `blob.type`. */
  extension: 'webm' | 'mp4';
  mimeType: string;
};

const getLastFrameFromRecord = <T,>(records: Record<string | number, Record<number, T>>) =>
  Object.values(records).reduce((maxFrame, framesByKey) => {
    const frames = Object.keys(framesByKey).map(Number);
    return frames.length > 0 ? Math.max(maxFrame, Math.max(...frames)) : maxFrame;
  }, -1);

/**
 * Frame count to export. Mirrors the timeline's `maxPlaybackFrame`: playback runs
 * frames 0..lastKeyframe inclusive (falling back to `duration` when there are no
 * keyframes), so the exported clip is that last frame plus one.
 */
const getExportTotalFrames = (
  duration: number,
  keyframes: Keyframes,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
  slotAttachmentKeyframes: Record<number, Record<number, { attachmentName: string | null }>>,
  meshDeformKeyframes: MeshDeformKeyframes,
  deformerKeyframes: DeformerKeyframes,
) => {
  const lastKeyframe = Math.max(
    getLastFrameFromRecord(keyframes),
    getLastFrameFromRecord(attachmentOpacityKeyframes),
    getLastFrameFromRecord(slotAttachmentKeyframes),
    getLastFrameFromRecord(meshDeformKeyframes),
    getLastFrameFromRecord(deformerKeyframes),
  );

  return Math.max(1, lastKeyframe > 0 ? lastKeyframe + 1 : duration);
};

// ─── Encoder selection ─────────────────────────────────────────────────────

type EncoderCandidate = {
  extension: 'webm' | 'mp4';
  mimeType: string;
  /** WebCodecs codec string passed to `VideoEncoder.configure`. */
  encoderCodec: string;
  /** Muxer-side codec identifier. */
  muxerCodec: string;
};

// WebM first so the default output format stays unchanged where VP8/VP9 encoding
// exists (Chromium). Safari/WKWebView generally only encodes H.264, hence the MP4
// fallbacks — they keep the export working rather than matching the extension.
const ENCODER_CANDIDATES: EncoderCandidate[] = [
  { extension: 'webm', mimeType: 'video/webm', encoderCodec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
  { extension: 'webm', mimeType: 'video/webm', encoderCodec: 'vp8', muxerCodec: 'V_VP8' },
  { extension: 'mp4', mimeType: 'video/mp4', encoderCodec: 'avc1.640034', muxerCodec: 'avc' },
  { extension: 'mp4', mimeType: 'video/mp4', encoderCodec: 'avc1.42E034', muxerCodec: 'avc' },
];

const VIDEO_BITRATE = 5_000_000;

const pickEncoder = async (
  width: number,
  height: number,
  fps: number,
): Promise<{ candidate: EncoderCandidate; config: VideoEncoderConfig } | null> => {
  if (typeof VideoEncoder === 'undefined') return null;

  for (const candidate of ENCODER_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec: candidate.encoderCodec,
      width,
      height,
      framerate: fps,
      bitrate: VIDEO_BITRATE,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { candidate, config: support.config ?? config };
    } catch {
      // Unsupported codec strings can throw instead of reporting `supported: false`.
    }
  }

  return null;
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Wait until the encoder has drained enough that we can queue more work. */
const awaitEncoderCapacity = async (encoder: VideoEncoder, maxQueued: number) => {
  while (encoder.encodeQueueSize > maxQueued) {
    await yieldToEventLoop();
  }
};

/** Frames rendered between forced yields, so the window still repaints during export. */
const YIELD_EVERY_FRAMES = 8;

export const exportVideo = async (
  bones: Bone[],
  slots: Slot[],
  attachments: Attachment[],
  keyframes: Keyframes,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
  slotAttachmentKeyframes: Record<number, Record<number, { attachmentName: string | null }>> = {},
  duration: number,
  fps: number,
  camX: number,
  camY: number,
  camZoom: number,
  backgroundImage: string | null = null,
  width: number = 1920,
  height: number = 1080,
  meshDeformKeyframes: MeshDeformKeyframes = {},
  deformerKeyframes: DeformerKeyframes = {},
  deformers: Deformer[] = [],
  inBetweenEnabled = true,
): Promise<VideoExportResult> => {
  // H.264 requires even dimensions; keep every codec on the same canvas size.
  const videoWidth = Math.max(2, Math.round(width / 2) * 2);
  const videoHeight = Math.max(2, Math.round(height / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  let loadedBackgroundImage: HTMLImageElement | null = null;
  if (backgroundImage) {
    loadedBackgroundImage = new Image();
    await new Promise<void>((resolve, reject) => {
      loadedBackgroundImage!.onload = () => resolve();
      loadedBackgroundImage!.onerror = () => reject(new Error('Failed to load background image'));
      loadedBackgroundImage!.src = backgroundImage;
    });
  }

  // Mesh deform only exists in the WebGL renderer; Canvas-2D draws flat quads.
  const glRenderer = createExportMeshRenderer(videoWidth, videoHeight);

  // Preload through whichever renderer will draw. Both skip attachments whose
  // image isn't cached yet, so decoding into throwaway `Image` objects here would
  // leave the opening frames empty until their own async loads land.
  if (glRenderer) {
    await glRenderer.preload(attachments);
  } else {
    const imageSources = new Set(
      attachments
        .filter((attachment) => attachment.imageData)
        .map((attachment) => attachment.imageData as string),
    );

    await Promise.all(
      [...imageSources].map(async (source) => {
        try {
          await loadImage(source);
        } catch {
          throw new Error('Failed to preload attachment image for video export');
        }
      }),
    );
  }

  const totalFrames = getExportTotalFrames(
    duration,
    keyframes,
    attachmentOpacityKeyframes,
    slotAttachmentKeyframes,
    meshDeformKeyframes,
    deformerKeyframes,
  );

  // Shared export transform: the canvas IS the video frame, so vpScale = 1.
  // This formula is the canonical "source of truth" for export coordinates;
  // the editor preview mirrors it via createViewportWorldToScreen (+ vpScale).
  const worldToScreen = createExportWorldToScreen(videoWidth, videoHeight, camX, camY, camZoom);

  const applyKeyframe = (boneId: number, frame: number) => {
    const boneKeyframes = keyframes[boneId];
    if (!boneKeyframes) return;

    const frames = Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
    if (frames.length === 0) return;

    let prevFrame = frames[0];
    let nextFrame = frames[0];

    for (let i = 0; i < frames.length; i++) {
      if (frames[i] <= frame) prevFrame = frames[i];
      if (frames[i] >= frame) {
        nextFrame = frames[i];
        break;
      }
    }

    const bone = bones.find((b) => b.id === boneId);
    if (!bone) return;

    if (prevFrame === nextFrame) {
      const kf = normalizeKeyframeData(boneKeyframes[prevFrame]);
      Object.assign(bone, kf);
    } else {
      const kf1 = normalizeKeyframeData(boneKeyframes[prevFrame]);
      const kf2 = normalizeKeyframeData(boneKeyframes[nextFrame]);
      const t = inBetweenEnabled
        ? applyEasing(
            kf1.easing,
            (frame - prevFrame) / (nextFrame - prevFrame),
          )
        : 0;

      bone.x = lerp(kf1.x, kf2.x, t);
      bone.y = lerp(kf1.y, kf2.y, t);
      bone.rotation = lerp(kf1.rotation, kf2.rotation, t);
      bone.scaleX = lerp(kf1.scaleX, kf2.scaleX, t);
      bone.scaleY = lerp(kf1.scaleY, kf2.scaleY, t);
      bone.order = kf1.order ?? bone.order;
    }
  };

  const drawFrame = (frame: number) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, videoWidth, videoHeight);

    if (loadedBackgroundImage) {
      const scale = Math.max(
        videoWidth / loadedBackgroundImage.width,
        videoHeight / loadedBackgroundImage.height,
      );
      const w = loadedBackgroundImage.width * scale;
      const h = loadedBackgroundImage.height * scale;
      ctx.drawImage(loadedBackgroundImage, (videoWidth - w) / 2, (videoHeight - h) / 2, w, h);
    }

    bones.forEach((bone) => {
      applyKeyframe(bone.id, frame);
    });

    computeAllWorldTransforms(bones);
    const resolvedAttachments = attachments.map((attachment) =>
      resolveAttachmentAtFrame(
        attachment,
        frame,
        attachmentOpacityKeyframes,
        meshDeformKeyframes,
        inBetweenEnabled,
      ),
    );
    // Warp deformers are applied before bone skinning, mirroring MainCanvas.
    const warpedAttachments = resolvedAttachments.map((attachment) => {
      if (attachment.deformerId == null) return attachment;
      const deformer = deformers.find((item) => item.id === attachment.deformerId);
      if (!deformer) return attachment;
      return applyWarpToAttachment(
        attachment,
        deformer,
        resolveDeformerAtFrame(deformer, frame, deformerKeyframes, inBetweenEnabled),
      );
    });
    const resolvedSlots = resolveSlotsAtFrame(slots, frame, slotAttachmentKeyframes);

    if (glRenderer) {
      glRenderer.drawFrame(ctx, {
        slots: resolvedSlots,
        attachments: warpedAttachments,
        bones,
        camX,
        camY,
        camZoom,
      });
      return;
    }

    drawSlots(ctx, resolvedSlots, warpedAttachments, bones, worldToScreen, camZoom);
  };

  try {
    const selected = await pickEncoder(videoWidth, videoHeight, fps);
    if (selected) {
      return await encodeWithWebCodecs(canvas, drawFrame, totalFrames, fps, selected);
    }

    return await recordWithMediaRecorder(canvas, drawFrame, totalFrames, fps);
  } finally {
    glRenderer?.dispose();
  }
};

// ─── WebCodecs path (frame-exact) ──────────────────────────────────────────

/**
 * Encode every frame with an explicit presentation timestamp, so the clip lasts
 * exactly `totalFrames / fps` seconds no matter how slowly the frames render.
 */
const encodeWithWebCodecs = async (
  canvas: HTMLCanvasElement,
  drawFrame: (frame: number) => void,
  totalFrames: number,
  fps: number,
  { candidate, config }: { candidate: EncoderCandidate; config: VideoEncoderConfig },
): Promise<VideoExportResult> => {
  const muxer =
    candidate.extension === 'webm'
      ? new WebmMuxer({
          target: new WebmTarget(),
          video: {
            codec: candidate.muxerCodec,
            width: canvas.width,
            height: canvas.height,
            frameRate: fps,
          },
        })
      : new Mp4Muxer({
          target: new Mp4Target(),
          video: {
            codec: candidate.muxerCodec as 'avc',
            width: canvas.width,
            height: canvas.height,
            frameRate: fps,
          },
          fastStart: 'in-memory',
        });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure(config);

  // One keyframe per second of footage keeps the file seekable without bloating it.
  const keyFrameInterval = Math.max(1, Math.round(fps));
  const microsecondsPerFrame = 1_000_000 / fps;

  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (encodeError) throw encodeError;
      await awaitEncoderCapacity(encoder, 8);
      if (frame % YIELD_EVERY_FRAMES === 0) await yieldToEventLoop();

      drawFrame(frame);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(frame * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame),
      });
      try {
        encoder.encode(videoFrame, { keyFrame: frame % keyFrameInterval === 0 });
      } finally {
        videoFrame.close();
      }
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  muxer.finalize();
  const { buffer } = muxer.target as { buffer: ArrayBuffer | null };
  if (!buffer) throw new Error('Muxer produced no output');

  return {
    blob: new Blob([buffer], { type: candidate.mimeType }),
    extension: candidate.extension,
    mimeType: candidate.mimeType,
  };
};

// ─── MediaRecorder fallback (no WebCodecs) ─────────────────────────────────

/**
 * Fallback for runtimes without `VideoEncoder`. MediaRecorder timestamps frames by
 * wall clock, so the loop is driven by elapsed real time instead of frame count:
 * the clip lands at the right duration, dropping frames when rendering can't keep up.
 */
const recordWithMediaRecorder = (
  canvas: HTMLCanvasElement,
  drawFrame: (frame: number) => void,
  totalFrames: number,
  fps: number,
): Promise<VideoExportResult> => {
  const stream = canvas.captureStream(fps);

  let mimeType = 'video/webm';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
    mimeType = 'video/webm;codecs=vp8';
  } else if (MediaRecorder.isTypeSupported('video/webm')) {
    mimeType = 'video/webm';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/mp4';
  }

  const extension: 'webm' | 'mp4' = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITRATE });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      resolve({
        blob: new Blob(chunks, { type: mimeType }),
        extension,
        mimeType,
      });
    };

    const clipDurationMs = (totalFrames / fps) * 1000;
    const startedAt = performance.now();
    let lastDrawnFrame = -1;

    mediaRecorder.start();
    drawFrame(0);
    lastDrawnFrame = 0;

    const renderFrame = () => {
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs >= clipDurationMs) {
        mediaRecorder.stop();
        return;
      }

      const frame = Math.min(totalFrames - 1, Math.floor((elapsedMs / 1000) * fps));
      if (frame !== lastDrawnFrame) {
        drawFrame(frame);
        lastDrawnFrame = frame;
      }

      requestAnimationFrame(renderFrame);
    };

    requestAnimationFrame(renderFrame);
  });
};

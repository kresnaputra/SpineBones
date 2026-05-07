import type {
  Attachment,
  AttachmentOpacityKeyframes,
  Bone,
  Keyframes,
  MeshDeformKeyframes,
  Slot,
} from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { drawSlots } from '../engine/imageRenderer';
import { lerp } from '../engine/math';
import { applyEasing, normalizeKeyframeData } from './easing';
import { createExportWorldToScreen } from '../engine/viewport';
import { resolveAttachmentAtFrame } from './meshAttachment';
import { resolveSlotsAtFrame } from './slotAnimation';

const getLastFrameFromRecord = <T,>(records: Record<string | number, Record<number, T>>) =>
  Object.values(records).reduce((maxFrame, framesByKey) => {
    const frames = Object.keys(framesByKey).map(Number);
    return frames.length > 0 ? Math.max(maxFrame, Math.max(...frames)) : maxFrame;
  }, -1);

const getExportTotalFrames = (
  duration: number,
  keyframes: Keyframes,
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
  slotAttachmentKeyframes: Record<number, Record<number, { attachmentName: string | null }>>,
) => {
  const lastKeyframe = Math.max(
    getLastFrameFromRecord(keyframes),
    getLastFrameFromRecord(meshDeformKeyframes),
    getLastFrameFromRecord(attachmentOpacityKeyframes),
    getLastFrameFromRecord(slotAttachmentKeyframes),
  );

  return Math.max(1, lastKeyframe >= 0 ? lastKeyframe + 1 : duration);
};

export const exportVideo = async (
  bones: Bone[],
  slots: Slot[],
  attachments: Attachment[],
  keyframes: Keyframes,
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
  slotAttachmentKeyframes: Record<number, Record<number, { attachmentName: string | null }>> = {},
  duration: number,
  fps: number,
  camX: number,
  camY: number,
  camZoom: number,
  backgroundImage: string | null = null,
  width: number = 1920,
  height: number = 1080
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
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

  // Preload all attachment images
  const imageLoadPromises = attachments
    .filter(att => att.imageData)
    .map(att => {
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load attachment image: ${att.name}`));
        img.src = att.imageData!;
      });
    });

  await Promise.all(imageLoadPromises);

  const totalFrames = getExportTotalFrames(
    duration,
    keyframes,
    meshDeformKeyframes,
    attachmentOpacityKeyframes,
    slotAttachmentKeyframes,
  );
  const stream = canvas.captureStream(fps);
  
  let mimeType = 'video/webm';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
    mimeType = 'video/webm;codecs=vp8';
  } else if (MediaRecorder.isTypeSupported('video/webm')) {
    mimeType = 'video/webm';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/mp4';
  }
  
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5000000,
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Shared export transform: the canvas IS the video frame, so vpScale = 1.
  // This formula is the canonical "source of truth" for export coordinates;
  // the editor preview mirrors it via createViewportWorldToScreen (+ vpScale).
  const worldToScreen = createExportWorldToScreen(width, height, camX, camY, camZoom);

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
      const t = applyEasing(
        kf1.easing,
        (frame - prevFrame) / (nextFrame - prevFrame),
      );

      bone.x = lerp(kf1.x, kf2.x, t);
      bone.y = lerp(kf1.y, kf2.y, t);
      bone.rotation = lerp(kf1.rotation, kf2.rotation, t);
      bone.scaleX = lerp(kf1.scaleX, kf2.scaleX, t);
      bone.scaleY = lerp(kf1.scaleY, kf2.scaleY, t);
    }
  };

  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };

    mediaRecorder.start();

    let currentFrame = 0;

    const renderFrame = () => {
      if (currentFrame >= totalFrames) {
        mediaRecorder.stop();
        return;
      }

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      if (loadedBackgroundImage) {
        const scale = Math.max(width / loadedBackgroundImage.width, height / loadedBackgroundImage.height);
        const w = loadedBackgroundImage.width * scale;
        const h = loadedBackgroundImage.height * scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        ctx.drawImage(loadedBackgroundImage, x, y, w, h);
      }

      bones.forEach((bone) => {
        applyKeyframe(bone.id, currentFrame);
      });

      computeAllWorldTransforms(bones);
      const resolvedAttachments = attachments.map((attachment) =>
        resolveAttachmentAtFrame(
          attachment,
          currentFrame,
          meshDeformKeyframes,
          attachmentOpacityKeyframes,
        ),
      );
      drawSlots(
        ctx,
        resolveSlotsAtFrame(slots, currentFrame, slotAttachmentKeyframes),
        resolvedAttachments,
        bones,
        worldToScreen,
        camZoom,
      );

      currentFrame++;
      setTimeout(renderFrame, 1000 / fps);
    };

    renderFrame();
  });
};

import JSZip from 'jszip';
import type { Attachment, Bone, Keyframes, Slot, SlotAttachmentKeyframes } from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { drawSlots, loadImage } from '../engine/imageRenderer';
import { lerp } from '../engine/math';
import { applyEasing, normalizeKeyframeData } from './easing';
import { resolveAnimatedSlots } from './slotAnimation';

interface ExportPngSequenceOptions {
  bones: Bone[];
  slots: Slot[];
  attachments: Attachment[];
  keyframes: Keyframes;
  slotAttachmentKeyframes?: SlotAttachmentKeyframes;
  duration: number;
  fps: number;
  camX: number;
  camY: number;
  camZoom: number;
  frameWidth?: number;
  frameHeight?: number;
  includeBackground?: boolean;
  backgroundImage?: string | null;
  crop?: boolean;
}

interface PngSequenceManifest {
  app: 'SpineBones';
  version: '1.0';
  fps: number;
  frameCount: number;
  frameSize: { w: number; h: number };
  frames: Array<{
    index: number;
    file: string;
    duration: number;
  }>;
}

const preloadImages = async (
  attachments: Attachment[],
  backgroundImage: string | null,
  includeBackground: boolean,
) => {
  const imageSources = attachments
    .filter((attachment) => attachment.imageData)
    .map((attachment) => attachment.imageData as string);

  if (includeBackground && backgroundImage) {
    imageSources.push(backgroundImage);
  }

  await Promise.all(
    [...new Set(imageSources)].map(async (source) => {
      try {
        await loadImage(source);
      } catch {
        throw new Error('Failed to preload image for PNG sequence export');
      }
    }),
  );
};

const getTrimmedBounds = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: width, h: height, empty: true };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, empty: false };
};

const applyFramePose = (bones: Bone[], keyframes: Keyframes, frame: number) => {
  bones.forEach((bone) => {
    const boneKeyframes = keyframes[bone.id];
    if (!boneKeyframes) return;

    const frames = Object.keys(boneKeyframes)
      .map(Number)
      .sort((a, b) => a - b);

    if (frames.length === 0) return;

    let prevFrame = frames[0];
    let nextFrame = frames[frames.length - 1];

    for (const keyframe of frames) {
      if (keyframe <= frame) prevFrame = keyframe;
      if (keyframe >= frame) {
        nextFrame = keyframe;
        break;
      }
    }

    if (prevFrame === nextFrame) {
      Object.assign(bone, normalizeKeyframeData(boneKeyframes[prevFrame]));
      return;
    }

    const from = normalizeKeyframeData(boneKeyframes[prevFrame]);
    const to = normalizeKeyframeData(boneKeyframes[nextFrame]);
    const t = applyEasing(from.easing, (frame - prevFrame) / (nextFrame - prevFrame));

    bone.x = lerp(from.x, to.x, t);
    bone.y = lerp(from.y, to.y, t);
    bone.rotation = lerp(from.rotation, to.rotation, t);
    bone.scaleX = lerp(from.scaleX, to.scaleX, t);
    bone.scaleY = lerp(from.scaleY, to.scaleY, t);
  });
};

const getAttachmentBounds = (
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
) => {
  const screenPos = worldToScreen(bone._wx, bone._wy);
  const rotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;
  const width = attachment.width * Math.abs(attachment.scaleX * bone.scaleX) * zoom * 0.5;
  const height = attachment.height * Math.abs(attachment.scaleY * bone.scaleY) * zoom * 0.5;
  const centerX = attachment.x * zoom;
  const centerY = attachment.y * zoom;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const corners = [
    { x: centerX - halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY + halfHeight },
    { x: centerX - halfWidth, y: centerY + halfHeight },
  ].map((corner) => ({
    x: screenPos.x + corner.x * cos - corner.y * sin,
    y: screenPos.y + corner.x * sin + corner.y * cos,
  }));

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
};

const getAutoFitTransform = ({
  bones,
  slots,
  attachments,
  keyframes,
  slotAttachmentKeyframes,
  totalFrames,
  frameWidth,
  frameHeight,
  camX,
  camY,
  camZoom,
}: {
  bones: Bone[];
  slots: Slot[];
  attachments: Attachment[];
  keyframes: Keyframes;
  slotAttachmentKeyframes: SlotAttachmentKeyframes;
  totalFrames: number;
  frameWidth: number;
  frameHeight: number;
  camX: number;
  camY: number;
  camZoom: number;
}) => {
  const baseWorldToScreen = (x: number, y: number) => ({
    x: frameWidth / 2 + (x - camX) * camZoom,
    y: frameHeight / 2 + (y - camY) * camZoom,
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const bonesCopy = JSON.parse(JSON.stringify(bones)) as Bone[];
    applyFramePose(bonesCopy, keyframes, frame);
    computeAllWorldTransforms(bonesCopy);
    const resolvedSlots = resolveAnimatedSlots(slots, frame, slotAttachmentKeyframes);

    resolvedSlots.forEach((slot) => {
      if (!slot.attachmentName) return;

      const bone = bonesCopy.find((item) => item.id === slot.boneId);
      if (!bone) return;

      const attachment = attachments.find(
        (item) => item.slotId === slot.id && item.name === slot.attachmentName,
      );
      if (!attachment) return;

      const bounds = getAttachmentBounds(attachment, bone, baseWorldToScreen, camZoom);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    });
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return { scale: 1, centerX: frameWidth / 2, centerY: frameHeight / 2 };
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const marginRatio = 0.92;
  const scale = Math.min(
    (frameWidth * marginRatio) / Math.max(1, contentWidth),
    (frameHeight * marginRatio) / Math.max(1, contentHeight),
  );

  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    centerX: minX + contentWidth / 2,
    centerY: minY + contentHeight / 2,
  };
};

export const exportPngSequence = async ({
  bones,
  slots,
  attachments,
  keyframes,
  slotAttachmentKeyframes = {},
  duration,
  fps,
  camX,
  camY,
  camZoom,
  frameWidth = 512,
  frameHeight = 512,
  includeBackground = false,
  backgroundImage = null,
  crop = false,
}: ExportPngSequenceOptions): Promise<Blob> => {
  const lastKeyframe = Object.values(keyframes).reduce((max, boneKfs) => {
    const frames = Object.keys(boneKfs).map(Number);
    return frames.length > 0 ? Math.max(max, Math.max(...frames)) : max;
  }, -1);
  const lastAttachmentKeyframe = Object.values(slotAttachmentKeyframes).reduce((max, slotKfs) => {
    const frames = Object.keys(slotKfs).map(Number);
    return frames.length > 0 ? Math.max(max, Math.max(...frames)) : max;
  }, -1);
  const totalFrames = Math.max(
    1,
    lastKeyframe >= 0 ? lastKeyframe + 1 : duration,
    lastAttachmentKeyframe >= 0 ? lastAttachmentKeyframe + 1 : duration,
  );

  await preloadImages(attachments, backgroundImage, includeBackground);

  const canvas = document.createElement('canvas');
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get PNG sequence canvas context');

  let loadedBackgroundImage: HTMLImageElement | null = null;
  if (includeBackground && backgroundImage) {
    loadedBackgroundImage = new Image();
    await new Promise<void>((resolve, reject) => {
      loadedBackgroundImage!.onload = () => resolve();
      loadedBackgroundImage!.onerror = () => reject(new Error('Failed to load background image'));
      loadedBackgroundImage!.src = backgroundImage;
    });
  }

  const baseWorldToScreen = (x: number, y: number) => ({
    x: frameWidth / 2 + (x - camX) * camZoom,
    y: frameHeight / 2 + (y - camY) * camZoom,
  });

  const fitTransform = includeBackground
    ? { scale: 1, centerX: frameWidth / 2, centerY: frameHeight / 2 }
    : getAutoFitTransform({
        bones,
        slots,
      attachments,
      keyframes,
      slotAttachmentKeyframes,
      totalFrames,
        frameWidth,
        frameHeight,
        camX,
        camY,
        camZoom,
      });

  const worldToScreen = (x: number, y: number) => {
    const base = baseWorldToScreen(x, y);
    return {
      x: frameWidth / 2 + (base.x - fitTransform.centerX) * fitTransform.scale,
      y: frameHeight / 2 + (base.y - fitTransform.centerY) * fitTransform.scale,
    };
  };
  const exportZoom = camZoom * fitTransform.scale;

  // When crop is enabled and there is no background, compute a global bounding box
  // across all frames so every exported PNG shares the same consistent cropped size.
  let cropRect = { x: 0, y: 0, w: frameWidth, h: frameHeight };
  if (crop && !includeBackground) {
    let unionMinX = frameWidth;
    let unionMinY = frameHeight;
    let unionMaxX = -1;
    let unionMaxY = -1;

    for (let frame = 0; frame < totalFrames; frame += 1) {
      const bonesCopy = JSON.parse(JSON.stringify(bones)) as Bone[];
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      applyFramePose(bonesCopy, keyframes, frame);
      computeAllWorldTransforms(bonesCopy);
      const resolvedSlots = resolveAnimatedSlots(slots, frame, slotAttachmentKeyframes);
      drawSlots(ctx, resolvedSlots, attachments, bonesCopy, worldToScreen, exportZoom);
      const bounds = getTrimmedBounds(ctx, frameWidth, frameHeight);
      if (!bounds.empty) {
        if (bounds.x < unionMinX) unionMinX = bounds.x;
        if (bounds.y < unionMinY) unionMinY = bounds.y;
        if (bounds.x + bounds.w > unionMaxX) unionMaxX = bounds.x + bounds.w;
        if (bounds.y + bounds.h > unionMaxY) unionMaxY = bounds.y + bounds.h;
      }
    }

    if (unionMaxX > unionMinX && unionMaxY > unionMinY) {
      cropRect = {
        x: unionMinX,
        y: unionMinY,
        w: unionMaxX - unionMinX,
        h: unionMaxY - unionMinY,
      };
    }
  }

  const outputWidth = cropRect.w;
  const outputHeight = cropRect.h;

  const manifest: PngSequenceManifest = {
    app: 'SpineBones',
    version: '1.0',
    fps,
    frameCount: totalFrames,
    frameSize: { w: outputWidth, h: outputHeight },
    frames: [],
  };

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = outputWidth;
  cropCanvas.height = outputHeight;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) throw new Error('Could not get crop canvas context');

  const zip = new JSZip();
  const framesFolder = zip.folder('frames');
  if (!framesFolder) throw new Error('Could not create frames folder in PNG sequence archive');

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const bonesCopy = JSON.parse(JSON.stringify(bones)) as Bone[];
    ctx.clearRect(0, 0, frameWidth, frameHeight);

    if (loadedBackgroundImage) {
      const scale = Math.max(
        frameWidth / loadedBackgroundImage.width,
        frameHeight / loadedBackgroundImage.height,
      );
      const w = loadedBackgroundImage.width * scale;
      const h = loadedBackgroundImage.height * scale;
      const x = (frameWidth - w) / 2;
      const y = (frameHeight - h) / 2;
      ctx.drawImage(loadedBackgroundImage, x, y, w, h);
    }

    applyFramePose(bonesCopy, keyframes, frame);
    computeAllWorldTransforms(bonesCopy);
    const resolvedSlots = resolveAnimatedSlots(slots, frame, slotAttachmentKeyframes);
    drawSlots(ctx, resolvedSlots, attachments, bonesCopy, worldToScreen, exportZoom);

    // Apply crop if needed
    let outputCanvas = canvas;
    if (crop && !includeBackground && (cropRect.x !== 0 || cropRect.y !== 0 || outputWidth !== frameWidth || outputHeight !== frameHeight)) {
      cropCtx.clearRect(0, 0, outputWidth, outputHeight);
      cropCtx.drawImage(canvas, cropRect.x, cropRect.y, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);
      outputCanvas = cropCanvas;
    }

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(`Failed to encode PNG sequence frame ${frame}`));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });

    const frameFile = `frame_${String(frame).padStart(4, '0')}.png`;
    framesFolder.file(frameFile, pngBlob);
    manifest.frames.push({
      index: frame,
      file: `frames/${frameFile}`,
      duration: Math.round(1000 / fps),
    });
  }

  zip.file('png-sequence.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob' });
};

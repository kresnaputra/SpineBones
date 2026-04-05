import JSZip from 'jszip';
import type { Attachment, Bone, Keyframes, Slot } from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { drawSlots, loadImage } from '../engine/imageRenderer';
import { lerp } from '../engine/math';
import { applyEasing, normalizeKeyframeData } from './easing';

interface ExportSpriteSheetOptions {
  bones: Bone[];
  slots: Slot[];
  attachments: Attachment[];
  keyframes: Keyframes;
  duration: number;
  fps: number;
  camX: number;
  camY: number;
  camZoom: number;
  frameWidth?: number;
  frameHeight?: number;
  includeBackground?: boolean;
  backgroundImage?: string | null;
}

interface SpriteSheetFrameData {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;
}

interface SpriteSheetMetadata {
  frames: Record<string, SpriteSheetFrameData>;
  animations: Record<string, string[]>;
  meta: {
    app: 'SpineBones';
    version: '1.0';
    image: string;
    format: 'RGBA8888';
    size: { w: number; h: number };
    scale: '1';
    frameSize: { w: number; h: number };
    fps: number;
    frameCount: number;
  };
}

interface SpriteSheetArchiveManifest {
  app: 'SpineBones';
  version: '1.0';
  totalFrames: number;
  fps: number;
  sheets: Array<{
    index: number;
    frameStart: number;
    frameEnd: number;
    image: string;
    data: string;
  }>;
}

const MAX_SPRITESHEET_SIDE = 8192;
const MAX_SPRITESHEET_PIXELS = 16_000_000;
const MAX_FRAMES_PER_SHEET = 10;

const getMaxFramesPerSheet = (frameWidth: number, frameHeight: number) => {
  const maxByPixels = Math.max(
    1,
    Math.min(
      MAX_FRAMES_PER_SHEET,
      Math.floor(MAX_SPRITESHEET_PIXELS / Math.max(1, frameWidth * frameHeight)),
    ),
  );

  for (let frameCount = maxByPixels; frameCount >= 1; frameCount -= 1) {
    const { safeScale } = getSafeSheetLayout(frameCount, frameWidth, frameHeight);
    if (safeScale >= 0.999) {
      return frameCount;
    }
  }

  return 1;
};

const preloadImages = async (attachments: Attachment[], backgroundImage: string | null, includeBackground: boolean) => {
  const imageSources = attachments
    .filter((attachment) => attachment.imageData)
    .map((attachment) => attachment.imageData as string);

  if (includeBackground && backgroundImage) {
    imageSources.push(backgroundImage);
  }

  await Promise.all(
    [...new Set(imageSources)].map(
      async (source) => {
        try {
          await loadImage(source);
        } catch {
          throw new Error('Failed to preload image for sprite sheet export');
        }
      },
    )
  );
};

const getSafeSheetLayout = (
  totalFrames: number,
  frameWidth: number,
  frameHeight: number,
) => {
  const estimatedColumns = Math.max(1, Math.ceil(Math.sqrt(totalFrames)));
  const estimatedRows = Math.max(1, Math.ceil(totalFrames / estimatedColumns));

  const sideScale = Math.min(
    1,
    MAX_SPRITESHEET_SIDE / Math.max(1, estimatedColumns * frameWidth),
    MAX_SPRITESHEET_SIDE / Math.max(1, estimatedRows * frameHeight),
  );
  const areaScale = Math.min(
    1,
    Math.sqrt(
      MAX_SPRITESHEET_PIXELS / Math.max(1, totalFrames * frameWidth * frameHeight),
    ),
  );
  const safeScale = Math.min(sideScale, areaScale);

  const safeFrameWidth = Math.max(1, Math.floor(frameWidth * safeScale));
  const safeFrameHeight = Math.max(1, Math.floor(frameHeight * safeScale));
  const packedWidthLimit = Math.max(1, estimatedColumns * safeFrameWidth);
  const estimatedPackedHeight = Math.max(1, estimatedRows * safeFrameHeight);

  return {
    safeScale,
    safeFrameWidth,
    safeFrameHeight,
    packedWidthLimit,
    estimatedPackedHeight,
  };
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
    let frameHasContent = false;

    slots.forEach((slot) => {
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
      frameHasContent = true;
    });

    if (!frameHasContent) continue;
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

const getTrimmedBounds = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: 1, h: 1, empty: true };
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    empty: false,
  };
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
      if (keyframe <= frame) {
        prevFrame = keyframe;
      }
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
    const t = applyEasing(
      from.easing,
      (frame - prevFrame) / (nextFrame - prevFrame),
    );

    bone.x = lerp(from.x, to.x, t);
    bone.y = lerp(from.y, to.y, t);
    bone.rotation = lerp(from.rotation, to.rotation, t);
    bone.scaleX = lerp(from.scaleX, to.scaleX, t);
    bone.scaleY = lerp(from.scaleY, to.scaleY, t);
  });
};

export const exportSpriteSheet = async ({
  bones,
  slots,
  attachments,
  keyframes,
  duration,
  fps,
  camX,
  camY,
  camZoom,
  frameWidth = 512,
  frameHeight = 512,
  includeBackground = false,
  backgroundImage = null,
}: ExportSpriteSheetOptions): Promise<Blob> => {
  const lastKeyframe = Object.values(keyframes).reduce((max, boneKfs) => {
    const frames = Object.keys(boneKfs).map(Number);
    return frames.length > 0 ? Math.max(max, Math.max(...frames)) : max;
  }, -1);
  const totalFrames = Math.max(1, lastKeyframe >= 0 ? lastKeyframe + 1 : duration);
  const maxFramesPerSheet = getMaxFramesPerSheet(frameWidth, frameHeight);
  const sheetRanges = Array.from(
    { length: Math.ceil(totalFrames / maxFramesPerSheet) },
    (_, index) => {
      const frameStart = index * maxFramesPerSheet;
      const frameEnd = Math.min(totalFrames, frameStart + maxFramesPerSheet);
      return { frameStart, frameEnd };
    },
  );
  const longestSheetFrameCount = Math.max(
    1,
    ...sheetRanges.map((range) => range.frameEnd - range.frameStart),
  );
  const {
    safeFrameWidth,
    safeFrameHeight,
  } = getSafeSheetLayout(longestSheetFrameCount, frameWidth, frameHeight);

  await preloadImages(attachments, backgroundImage, includeBackground);

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = safeFrameWidth;
  frameCanvas.height = safeFrameHeight;
  const frameCtx = frameCanvas.getContext('2d');
  if (!frameCtx) throw new Error('Could not get frame canvas context');

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
    x: safeFrameWidth / 2 + (x - camX) * camZoom,
    y: safeFrameHeight / 2 + (y - camY) * camZoom,
  });

  const fitTransform = includeBackground
    ? { scale: 1, centerX: safeFrameWidth / 2, centerY: safeFrameHeight / 2 }
    : getAutoFitTransform({
        bones,
        slots,
        attachments,
        keyframes,
        totalFrames,
        frameWidth: safeFrameWidth,
        frameHeight: safeFrameHeight,
        camX,
        camY,
        camZoom,
      });

  const worldToScreen = (x: number, y: number) => {
    const base = baseWorldToScreen(x, y);
    return {
      x: safeFrameWidth / 2 + (base.x - fitTransform.centerX) * fitTransform.scale,
      y: safeFrameHeight / 2 + (base.y - fitTransform.centerY) * fitTransform.scale,
    };
  };
  const exportZoom = camZoom * fitTransform.scale;
  const zip = new JSZip();

  const manifest: SpriteSheetArchiveManifest = {
    app: 'SpineBones',
    version: '1.0',
    totalFrames,
    fps,
    sheets: [],
  };

  for (const [sheetIndex, range] of sheetRanges.entries()) {
    const sheetFrameCount = range.frameEnd - range.frameStart;
    const {
      packedWidthLimit,
      estimatedPackedHeight,
    } = getSafeSheetLayout(sheetFrameCount, frameWidth, frameHeight);

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = packedWidthLimit;
    sheetCanvas.height = estimatedPackedHeight;
    const sheetCtx = sheetCanvas.getContext('2d');
    if (!sheetCtx) throw new Error('Could not get sprite sheet canvas context');

    const metadata: SpriteSheetMetadata = {
      frames: {},
      animations: {
        animation: [],
      },
      meta: {
        app: 'SpineBones',
        version: '1.0',
        image: sheetRanges.length === 1 ? 'spritesheet.png' : `spritesheet-${String(sheetIndex + 1).padStart(2, '0')}.png`,
        format: 'RGBA8888',
        size: { w: 0, h: 0 },
        scale: '1',
        frameSize: { w: safeFrameWidth, h: safeFrameHeight },
        fps,
        frameCount: sheetFrameCount,
      },
    };

    const renderedFrames: Array<{
      name: string;
      canvas: HTMLCanvasElement;
      trimmed: { x: number; y: number; w: number; h: number; empty: boolean };
    }> = [];

    for (let frame = range.frameStart; frame < range.frameEnd; frame += 1) {
      const bonesCopy = JSON.parse(JSON.stringify(bones)) as Bone[];

      frameCtx.clearRect(0, 0, safeFrameWidth, safeFrameHeight);

      if (loadedBackgroundImage) {
        const scale = Math.max(
          safeFrameWidth / loadedBackgroundImage.width,
          safeFrameHeight / loadedBackgroundImage.height,
        );
        const w = loadedBackgroundImage.width * scale;
        const h = loadedBackgroundImage.height * scale;
        const x = (safeFrameWidth - w) / 2;
        const y = (safeFrameHeight - h) / 2;
        frameCtx.drawImage(loadedBackgroundImage, x, y, w, h);
      }

      applyFramePose(bonesCopy, keyframes, frame);
      computeAllWorldTransforms(bonesCopy);
      drawSlots(frameCtx, slots, attachments, bonesCopy, worldToScreen, exportZoom);
      const trimmed = getTrimmedBounds(frameCtx, safeFrameWidth, safeFrameHeight);
      const trimmedCanvas = document.createElement('canvas');
      trimmedCanvas.width = trimmed.w;
      trimmedCanvas.height = trimmed.h;
      const trimmedCtx = trimmedCanvas.getContext('2d');
      if (!trimmedCtx) throw new Error('Could not get trimmed canvas context');
      trimmedCtx.drawImage(
        frameCanvas,
        trimmed.x,
        trimmed.y,
        trimmed.w,
        trimmed.h,
        0,
        0,
        trimmed.w,
        trimmed.h,
      );

      const frameName = `frame_${String(frame).padStart(4, '0')}`;
      metadata.animations.animation.push(frameName);
      renderedFrames.push({ name: frameName, canvas: trimmedCanvas, trimmed });
    }

    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    let usedWidth = 0;

    renderedFrames.forEach(({ name, canvas, trimmed }) => {
      if (cursorX > 0 && cursorX + canvas.width > packedWidthLimit) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }

      sheetCtx.drawImage(canvas, cursorX, cursorY);

      metadata.frames[name] = {
        frame: { x: cursorX, y: cursorY, w: canvas.width, h: canvas.height },
        rotated: false,
        trimmed:
          !trimmed.empty &&
          (canvas.width !== safeFrameWidth || canvas.height !== safeFrameHeight),
        spriteSourceSize: { x: trimmed.x, y: trimmed.y, w: canvas.width, h: canvas.height },
        sourceSize: { w: safeFrameWidth, h: safeFrameHeight },
        duration: Math.round(1000 / fps),
      };

      cursorX += canvas.width;
      rowHeight = Math.max(rowHeight, canvas.height);
      usedWidth = Math.max(usedWidth, cursorX);
    });

    const usedHeight = cursorY + rowHeight;
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.max(1, usedWidth);
    finalCanvas.height = Math.max(1, usedHeight);
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error('Could not get final sprite sheet canvas context');
    finalCtx.drawImage(sheetCanvas, 0, 0);

    metadata.meta.size = { w: finalCanvas.width, h: finalCanvas.height };

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      finalCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode sprite sheet image'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });

    const imageFileName =
      sheetRanges.length === 1
        ? 'spritesheet.png'
        : `spritesheet-${String(sheetIndex + 1).padStart(2, '0')}.png`;
    const dataFileName =
      sheetRanges.length === 1
        ? 'spritesheet.json'
        : `spritesheet-${String(sheetIndex + 1).padStart(2, '0')}.json`;

    zip.file(imageFileName, pngBlob);
    zip.file(dataFileName, JSON.stringify(metadata, null, 2));
    manifest.sheets.push({
      index: sheetIndex,
      frameStart: range.frameStart,
      frameEnd: range.frameEnd - 1,
      image: imageFileName,
      data: dataFileName,
    });
  }

  if (manifest.sheets.length > 1) {
    zip.file('spritesheets-manifest.json', JSON.stringify(manifest, null, 2));
  }

  return zip.generateAsync({ type: 'blob' });
};

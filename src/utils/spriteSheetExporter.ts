import JSZip from 'jszip';
import type { Attachment, Bone, Keyframes, Slot } from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { drawSlots } from '../engine/imageRenderer';
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
    image: 'spritesheet.png';
    format: 'RGBA8888';
    size: { w: number; h: number };
    scale: '1';
    frameSize: { w: number; h: number };
    fps: number;
    frameCount: number;
  };
}

const preloadImages = async (attachments: Attachment[], backgroundImage: string | null, includeBackground: boolean) => {
  const imageSources = attachments
    .filter((attachment) => attachment.imageData)
    .map((attachment) => attachment.imageData as string);

  if (includeBackground && backgroundImage) {
    imageSources.push(backgroundImage);
  }

  await Promise.all(
    [...new Set(imageSources)].map(
      (source) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to preload image for sprite sheet export'));
          img.src = source;
        })
    )
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
  const totalFrames = Math.max(1, duration);
  const packedWidthLimit = Math.max(1024, Math.ceil(Math.sqrt(totalFrames)) * frameWidth);

  await preloadImages(attachments, backgroundImage, includeBackground);

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = packedWidthLimit;
  sheetCanvas.height = totalFrames * frameHeight;
  const sheetCtx = sheetCanvas.getContext('2d');
  if (!sheetCtx) throw new Error('Could not get sprite sheet canvas context');

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameWidth;
  frameCanvas.height = frameHeight;
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

  const worldToScreen = (x: number, y: number) => ({
    x: frameWidth / 2 + (x - camX) * camZoom,
    y: frameHeight / 2 + (y - camY) * camZoom,
  });

  const metadata: SpriteSheetMetadata = {
    frames: {},
    animations: {
      animation: [],
    },
    meta: {
      app: 'SpineBones',
      version: '1.0',
      image: 'spritesheet.png',
      format: 'RGBA8888',
      size: { w: 0, h: 0 },
      scale: '1',
      frameSize: { w: frameWidth, h: frameHeight },
      fps,
      frameCount: totalFrames,
    },
  };

  const renderedFrames: Array<{
    name: string;
    canvas: HTMLCanvasElement;
    trimmed: { x: number; y: number; w: number; h: number; empty: boolean };
  }> = [];

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const bonesCopy = JSON.parse(JSON.stringify(bones)) as Bone[];

    frameCtx.clearRect(0, 0, frameWidth, frameHeight);

    if (loadedBackgroundImage) {
      const scale = Math.max(frameWidth / loadedBackgroundImage.width, frameHeight / loadedBackgroundImage.height);
      const w = loadedBackgroundImage.width * scale;
      const h = loadedBackgroundImage.height * scale;
      const x = (frameWidth - w) / 2;
      const y = (frameHeight - h) / 2;
      frameCtx.drawImage(loadedBackgroundImage, x, y, w, h);
    }

    applyFramePose(bonesCopy, keyframes, frame);
    computeAllWorldTransforms(bonesCopy);
    drawSlots(frameCtx, slots, attachments, bonesCopy, worldToScreen, camZoom);
    const trimmed = getTrimmedBounds(frameCtx, frameWidth, frameHeight);
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
      trimmed.h
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
      trimmed: !trimmed.empty && (canvas.width !== frameWidth || canvas.height !== frameHeight),
      spriteSourceSize: { x: trimmed.x, y: trimmed.y, w: canvas.width, h: canvas.height },
      sourceSize: { w: frameWidth, h: frameHeight },
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
  }
  );

  const zip = new JSZip();
  zip.file('spritesheet.png', pngBlob);
  zip.file('spritesheet.json', JSON.stringify(metadata, null, 2));

  return zip.generateAsync({ type: 'blob' });
};

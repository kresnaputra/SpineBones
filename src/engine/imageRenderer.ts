import type { Slot, Attachment, Bone } from '../types';
import { sortBonesByOrder } from './drawOrder';

type AttachmentOutlineOptions = {
  strokeStyle?: string;
  lineWidth?: number;
  dash?: number[];
};

const imageCache = new Map<string, HTMLImageElement>();
const pixelImageCache = new Map<string, HTMLCanvasElement>();
const outlineCache = new Map<string, HTMLCanvasElement>();

export const clearAttachmentCache = (imageData: string): void => {
  imageCache.delete(imageData);
  for (const key of pixelImageCache.keys()) {
    if (key.startsWith(`${imageData}::`)) {
      pixelImageCache.delete(key);
    }
  }
  for (const key of outlineCache.keys()) {
    if (key.startsWith(`${imageData}::`)) {
      outlineCache.delete(key);
    }
  }
};

export const loadImage = (imageData: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (imageCache.has(imageData)) {
      resolve(imageCache.get(imageData)!);
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageCache.set(imageData, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = imageData;
  });
};

const getPixelImage = (
  imageData: string,
  image: HTMLImageElement,
  pixelSize: number,
  lineBoil: boolean,
  frame: number,
): HTMLCanvasElement => {
  const size = Math.max(1, Math.min(32, Math.round(pixelSize)));
  const phase = lineBoil ? Math.abs(Math.round(frame)) % 3 : 0;
  const key = `${imageData}::${size}::${lineBoil ? phase : 'still'}`;
  const cached = pixelImageCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(image.width / size));
  canvas.height = Math.max(1, Math.ceil(image.height / size));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (lineBoil && canvas.width > 2 && canvas.height > 2) {
      const imageDataResult = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const source = new Uint8ClampedArray(imageDataResult.data);
      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          const alpha = source[index + 3] ?? 0;
          let opaqueNeighbor = -1;
          let opaqueAlpha = alpha;
          let transparentNeighbor = -1;
          let transparentAlpha = alpha;

          directions.forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= canvas.width || ny < 0 || ny >= canvas.height) return;
            const neighborIndex = (ny * canvas.width + nx) * 4;
            const neighborAlpha = source[neighborIndex + 3] ?? 0;
            if (neighborAlpha > opaqueAlpha) {
              opaqueAlpha = neighborAlpha;
              opaqueNeighbor = neighborIndex;
            }
            if (neighborAlpha < transparentAlpha) {
              transparentAlpha = neighborAlpha;
              transparentNeighbor = neighborIndex;
            }
          });

          const hash = Math.abs(
            Math.imul(x + 17, 73856093) ^
              Math.imul(y + 31, 19349663) ^
              Math.imul(phase + 7, 83492791),
          );
          const sourceIndex =
            alpha < 48 && opaqueAlpha >= 48 && hash % 100 < 72
              ? opaqueNeighbor
              : alpha >= 48 && transparentAlpha < 48 && hash % 100 < 8
                ? transparentNeighbor
                : -1;
          if (sourceIndex < 0) continue;

          imageDataResult.data[index] = source[sourceIndex] ?? 0;
          imageDataResult.data[index + 1] = source[sourceIndex + 1] ?? 0;
          imageDataResult.data[index + 2] = source[sourceIndex + 2] ?? 0;
          imageDataResult.data[index + 3] = source[sourceIndex + 3] ?? 0;
        }
      }
      ctx.putImageData(imageDataResult, 0, 0);
    }
  }
  pixelImageCache.set(key, canvas);
  return canvas;
};

const getAttachmentTransform = (attachment: Attachment, bone: Bone, zoom: number) => {
  const totalRotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;
  const totalScaleX = attachment.scaleX * bone.scaleX;
  const totalScaleY = attachment.scaleY * bone.scaleY;
  const scale = zoom * 0.5;
  const cos = Math.cos(totalRotation);
  const sin = Math.sin(totalRotation);

  return { totalRotation, totalScaleX, totalScaleY, scale, cos, sin };
};

const getOutlineCanvas = (
  imageData: string,
  color: string,
  lineWidth: number,
): HTMLCanvasElement | null => {
  const key = `${imageData}::${color}::${lineWidth}`;
  if (outlineCache.has(key)) {
    return outlineCache.get(key) ?? null;
  }

  const image = imageCache.get(imageData);
  if (!image) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const steps = 16;
  const radius = Math.max(1.5, lineWidth * 1.2);

  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    ctx.drawImage(image, dx, dy, canvas.width, canvas.height);
  }

  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Punch out the original sprite so only the border remains.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  outlineCache.set(key, canvas);
  return canvas;
};

export const drawAttachment = (
  ctx: CanvasRenderingContext2D,
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  alpha = 1,
  onImageLoad?: () => void,
): void => {
  if (!attachment.imageData) return;

  const img = imageCache.get(attachment.imageData);
  if (!img) {
    loadImage(attachment.imageData).then(() => {
      if (onImageLoad) onImageLoad();
    });
    return;
  }

  const source = attachment.pixelated
    ? getPixelImage(
        attachment.imageData,
        img,
        attachment.pixelSize ?? 4,
        attachment.lineBoil ?? false,
        attachment.pixelFrame ?? 0,
      )
    : img;

  ctx.save();
  ctx.globalAlpha = alpha * (attachment.opacity ?? 1);
  ctx.imageSmoothingEnabled = !attachment.pixelated;

  const screenPos = worldToScreen(bone._wx, bone._wy);
  ctx.translate(screenPos.x, screenPos.y);
  ctx.rotate((bone._wrot * Math.PI) / 180);
  ctx.rotate((attachment.rotation * Math.PI) / 180);

  const { totalScaleX, totalScaleY, scale } = getAttachmentTransform(attachment, bone, zoom);
  const flipX = totalScaleX < 0 ? -1 : 1;
  const flipY = totalScaleY < 0 ? -1 : 1;
  const w = attachment.width * Math.abs(totalScaleX) * scale;
  const h = attachment.height * Math.abs(totalScaleY) * scale;
  const offsetX = attachment.x * zoom;
  const offsetY = attachment.y * zoom;

  ctx.scale(flipX, flipY);

  if (attachment.imageIsCropped && attachment.opaqueBounds) {
    const { x: ox, y: oy, width: cw, height: ch } = attachment.opaqueBounds;
    const scaleX = w / attachment.width;
    const scaleY = h / attachment.height;
    ctx.drawImage(source, offsetX - w / 2 + ox * scaleX, offsetY - h / 2 + oy * scaleY, cw * scaleX, ch * scaleY);
  } else {
    ctx.drawImage(source, offsetX - w / 2, offsetY - h / 2, w, h);
  }

  ctx.restore();
};

export const hitTestAttachment = (
  sx: number,
  sy: number,
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number
): boolean => {
  const screenPos = worldToScreen(bone._wx, bone._wy);
  const totalRotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;

  const dx = sx - screenPos.x;
  const dy = sy - screenPos.y;
  const cos = Math.cos(-totalRotation);
  const sin = Math.sin(-totalRotation);

  const localX = (dx * cos - dy * sin) / zoom;
  const localY = (dx * sin + dy * cos) / zoom;

  const widthLocal = attachment.width * Math.abs(attachment.scaleX * bone.scaleX) * 0.5;
  const heightLocal = attachment.height * Math.abs(attachment.scaleY * bone.scaleY) * 0.5;

  const left = attachment.x - widthLocal / 2;
  const right = attachment.x + widthLocal / 2;
  const top = attachment.y - heightLocal / 2;
  const bottom = attachment.y + heightLocal / 2;

  return localX >= left && localX <= right && localY >= top && localY <= bottom;
};

export const drawAttachmentOutline = (
  ctx: CanvasRenderingContext2D,
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  options?: AttachmentOutlineOptions,
): void => {
  const image = attachment.imageData ? imageCache.get(attachment.imageData) : null;
  const screenPos = worldToScreen(bone._wx, bone._wy);
  const totalRotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;
  const totalScaleX = attachment.scaleX * bone.scaleX;
  const totalScaleY = attachment.scaleY * bone.scaleY;
  const flipX = totalScaleX < 0 ? -1 : 1;
  const flipY = totalScaleY < 0 ? -1 : 1;
  const width = attachment.width * Math.abs(totalScaleX) * zoom * 0.5;
  const height = attachment.height * Math.abs(totalScaleY) * zoom * 0.5;
  const offsetX = attachment.x * zoom;
  const offsetY = attachment.y * zoom;

  ctx.save();
  ctx.imageSmoothingEnabled = !attachment.pixelated;
  ctx.translate(screenPos.x, screenPos.y);
  ctx.rotate(totalRotation);
  ctx.scale(flipX, flipY);
  const strokeStyle = options?.strokeStyle ?? 'rgba(124,58,237,0.95)';
  const lineWidth = options?.lineWidth ?? 2;

  if (image && attachment.imageData) {
    const outline = getOutlineCanvas(attachment.imageData, strokeStyle, lineWidth);
    if (outline) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (attachment.imageIsCropped && attachment.opaqueBounds) {
        const { x: ox, y: oy, width: cw, height: ch } = attachment.opaqueBounds;
        const scaleX = width / attachment.width;
        const scaleY = height / attachment.height;
        ctx.drawImage(outline, offsetX - width / 2 + ox * scaleX, offsetY - height / 2 + oy * scaleY, cw * scaleX, ch * scaleY);
      } else {
        ctx.drawImage(outline, offsetX - width / 2, offsetY - height / 2, width, height);
      }
      ctx.restore();
      ctx.restore();
      return;
    }
  }

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(options?.dash ?? [6, 4]);
  ctx.strokeRect(offsetX - width / 2, offsetY - height / 2, width, height);
  ctx.restore();
};

export const drawSlots = (
  ctx: CanvasRenderingContext2D,
  slots: Slot[],
  attachments: Attachment[],
  bones: Bone[],
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  alpha = 1,
  onImageLoad?: () => void,
): void => {
  sortBonesByOrder(bones).forEach((bone) => {
    const boneSlots = slots.filter((slot) => slot.boneId === bone.id);

    boneSlots.forEach((slot) => {
      if (!slot.attachmentName) return;

      const attachment = attachments.find(
        (a) => a.slotId === slot.id && a.name === slot.attachmentName
      );
      if (!attachment) return;

      drawAttachment(ctx, attachment, bone, worldToScreen, zoom, alpha, onImageLoad);
    });
  });
};

export const drawSlotOutlines = (
  ctx: CanvasRenderingContext2D,
  slots: Slot[],
  attachments: Attachment[],
  bones: Bone[],
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  options?: AttachmentOutlineOptions,
): void => {
  sortBonesByOrder(bones).forEach((bone) => {
    const boneSlots = slots.filter((slot) => slot.boneId === bone.id);

    boneSlots.forEach((slot) => {
      if (!slot.attachmentName) return;

      const attachment = attachments.find(
        (item) => item.slotId === slot.id && item.name === slot.attachmentName,
      );
      if (!attachment) return;

      drawAttachmentOutline(ctx, attachment, bone, worldToScreen, zoom, options);
    });
  });
};

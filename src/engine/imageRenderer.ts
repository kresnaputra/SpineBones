import type { Slot, Attachment, Bone, MeshVertex } from '../types';

type AttachmentOutlineOptions = {
  strokeStyle?: string;
  lineWidth?: number;
  dash?: number[];
};

const imageCache = new Map<string, HTMLImageElement>();
const outlineCache = new Map<string, HTMLCanvasElement>();
type ScreenPoint = { x: number; y: number };

export const clearAttachmentCache = (imageData: string): void => {
  imageCache.delete(imageData);
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

const getAttachmentTransform = (attachment: Attachment, bone: Bone, zoom: number) => {
  const totalRotation = ((bone._wrot + attachment.rotation) * Math.PI) / 180;
  const totalScaleX = attachment.scaleX * bone.scaleX;
  const totalScaleY = attachment.scaleY * bone.scaleY;
  const scale = zoom * 0.5;
  const cos = Math.cos(totalRotation);
  const sin = Math.sin(totalRotation);

  return { totalRotation, totalScaleX, totalScaleY, scale, cos, sin };
};

export const getAttachmentMeshScreenVertices = (
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
) => {
  if (!attachment.meshVertices?.length) return [] as ScreenPoint[];
  const screenPos = worldToScreen(bone._wx, bone._wy);
  const { totalScaleX, totalScaleY, scale, cos, sin } = getAttachmentTransform(
    attachment,
    bone,
    zoom,
  );

  return attachment.meshVertices.map((vertex) => {
    const localX = (attachment.x + vertex.x) * totalScaleX * scale;
    const localY = (attachment.y + vertex.y) * totalScaleY * scale;
    return {
      x: screenPos.x + localX * cos - localY * sin,
      y: screenPos.y + localX * sin + localY * cos,
    };
  });
};

const pointInTriangle = (p: ScreenPoint, a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) => {
  const sign = (p1: ScreenPoint, p2: ScreenPoint, p3: ScreenPoint) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};

const drawTexturedTriangle = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  vertices: [MeshVertex, MeshVertex, MeshVertex],
  points: [ScreenPoint, ScreenPoint, ScreenPoint],
) => {
  const [v0, v1, v2] = vertices;
  const [p0, p1, p2] = points;
  const sx0 = v0.u * image.width;
  const sy0 = v0.v * image.height;
  const sx1 = v1.u * image.width;
  const sy1 = v1.v * image.height;
  const sx2 = v2.u * image.width;
  const sy2 = v2.v * image.height;

  const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(denom) < 1e-6) return;

  const a = (p0.x * (sy1 - sy2) + p1.x * (sy2 - sy0) + p2.x * (sy0 - sy1)) / denom;
  const b = (p0.y * (sy1 - sy2) + p1.y * (sy2 - sy0) + p2.y * (sy0 - sy1)) / denom;
  const c = (p0.x * (sx2 - sx1) + p1.x * (sx0 - sx2) + p2.x * (sx1 - sx0)) / denom;
  const d = (p0.y * (sx2 - sx1) + p1.y * (sx0 - sx2) + p2.y * (sx1 - sx0)) / denom;
  const e =
    (p0.x * (sx1 * sy2 - sx2 * sy1) +
      p1.x * (sx2 * sy0 - sx0 * sy2) +
      p2.x * (sx0 * sy1 - sx1 * sy0)) /
    denom;
  const f =
    (p0.y * (sx1 * sy2 - sx2 * sy1) +
      p1.y * (sx2 * sy0 - sx0 * sy2) +
      p2.y * (sx0 * sy1 - sx1 * sy0)) /
    denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
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
  onImageLoad?: () => void
): void => {
  if (!attachment.imageData) return;

  const img = imageCache.get(attachment.imageData);
  if (!img) {
    loadImage(attachment.imageData).then(() => {
      if (onImageLoad) onImageLoad();
    });
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  if (attachment.type === 'mesh' && attachment.meshVertices?.length && attachment.meshTriangles?.length) {
    const screenVertices = getAttachmentMeshScreenVertices(attachment, bone, worldToScreen, zoom);
    attachment.meshTriangles.forEach(([i0, i1, i2]) => {
      const v0 = attachment.meshVertices?.[i0];
      const v1 = attachment.meshVertices?.[i1];
      const v2 = attachment.meshVertices?.[i2];
      const p0 = screenVertices[i0];
      const p1 = screenVertices[i1];
      const p2 = screenVertices[i2];
      if (!v0 || !v1 || !v2 || !p0 || !p1 || !p2) return;
      drawTexturedTriangle(ctx, img, [v0, v1, v2], [p0, p1, p2]);
    });
    ctx.restore();
    return;
  }

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
  ctx.drawImage(img, offsetX - w / 2, offsetY - h / 2, w, h);

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
  if (attachment.type === 'mesh' && attachment.meshVertices?.length && attachment.meshTriangles?.length) {
    const screenVertices = getAttachmentMeshScreenVertices(attachment, bone, worldToScreen, zoom);
    return attachment.meshTriangles.some(([i0, i1, i2]) => {
      const p0 = screenVertices[i0];
      const p1 = screenVertices[i1];
      const p2 = screenVertices[i2];
      if (!p0 || !p1 || !p2) return false;
      return pointInTriangle({ x: sx, y: sy }, p0, p1, p2);
    });
  }

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
  if (attachment.type === 'mesh' && attachment.meshVertices?.length) {
    const screenVertices = getAttachmentMeshScreenVertices(attachment, bone, worldToScreen, zoom);
    const strokeStyle = options?.strokeStyle ?? 'rgba(124,58,237,0.95)';
    const lineWidth = options?.lineWidth ?? 1.5;
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(options?.dash ?? [6, 4]);
    attachment.meshTriangles?.forEach(([i0, i1, i2]) => {
      const p0 = screenVertices[i0];
      const p1 = screenVertices[i1];
      const p2 = screenVertices[i2];
      if (!p0 || !p1 || !p2) return;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.stroke();
    });
    ctx.setLineDash([]);
    screenVertices.forEach((point) => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = strokeStyle;
      ctx.beginPath();
      ctx.rect(point.x - 4, point.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
    return;
  }

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
      ctx.drawImage(
        outline,
        offsetX - width / 2,
        offsetY - height / 2,
        width,
        height,
      );
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
  onImageLoad?: () => void
): void => {
  bones.forEach((bone) => {
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
  bones.forEach((bone) => {
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

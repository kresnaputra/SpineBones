import type { Slot, Attachment, Bone } from '../types';

const imageCache = new Map<string, HTMLImageElement>();

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

export const drawAttachment = (
  ctx: CanvasRenderingContext2D,
  attachment: Attachment,
  bone: Bone,
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
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

  const screenPos = worldToScreen(bone._wx, bone._wy);
  ctx.translate(screenPos.x, screenPos.y);
  ctx.rotate((bone._wrot * Math.PI) / 180);
  ctx.rotate((attachment.rotation * Math.PI) / 180);

  const scale = zoom * 0.5;
  const totalScaleX = attachment.scaleX * bone.scaleX;
  const totalScaleY = attachment.scaleY * bone.scaleY;
  const flipX = totalScaleX < 0 ? -1 : 1;
  const flipY = totalScaleY < 0 ? -1 : 1;
  const w = attachment.width * Math.abs(totalScaleX) * scale;
  const h = attachment.height * Math.abs(totalScaleY) * scale;
  const offsetX = attachment.x * zoom;
  const offsetY = attachment.y * zoom;

  ctx.globalAlpha = 1.0;
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
  zoom: number
): void => {
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
  ctx.strokeStyle = 'rgba(124,58,237,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
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

      drawAttachment(ctx, attachment, bone, worldToScreen, zoom, onImageLoad);
    });
  });
};

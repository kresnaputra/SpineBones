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
  zoom: number
): void => {
  if (!attachment.imageData) return;

  const img = imageCache.get(attachment.imageData);
  if (!img) {
    loadImage(attachment.imageData);
    return;
  }

  ctx.save();

  const screenPos = worldToScreen(bone._wx, bone._wy);
  ctx.translate(screenPos.x, screenPos.y);
  ctx.rotate((bone._wrot * Math.PI) / 180);
  ctx.rotate((attachment.rotation * Math.PI) / 180);

  const scale = zoom * 0.5;
  const w = attachment.width * attachment.scaleX * bone.scaleX * scale;
  const h = attachment.height * attachment.scaleY * bone.scaleY * scale;
  const offsetX = attachment.x * zoom;
  const offsetY = attachment.y * zoom;

  ctx.globalAlpha = 0.9;
  ctx.drawImage(img, offsetX - w / 2, offsetY - h / 2, w, h);

  ctx.restore();
};

export const drawSlots = (
  ctx: CanvasRenderingContext2D,
  slots: Slot[],
  attachments: Attachment[],
  bones: Bone[],
  worldToScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number
): void => {
  const sortedSlots = [...slots].sort((a, b) => a.drawOrder - b.drawOrder);

  sortedSlots.forEach((slot) => {
    if (!slot.attachmentName) return;

    const attachment = attachments.find(
      (a) => a.slotId === slot.id && a.name === slot.attachmentName
    );
    if (!attachment) return;

    const bone = bones.find((b) => b.id === slot.boneId);
    if (!bone) return;

    drawAttachment(ctx, attachment, bone, worldToScreen, zoom);
  });
};

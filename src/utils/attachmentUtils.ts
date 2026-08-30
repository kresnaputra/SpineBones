import type { Attachment, AttachmentOpacityKeyframes, MeshDeformKeyframes } from '../types';
import { applyEasing } from './easing';
import { resolveMeshVerticesAtFrame } from './meshAttachment';

const loadImageElement = (imageData: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for opaque bounds'));
    image.src = imageData;
  });

export const getOpaqueBoundsFromImageData = async (
  imageData: string,
): Promise<Attachment['opaqueBounds'] | undefined> => {
  const image = await loadImageElement(imageData);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return undefined;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

export const getAttachmentKey = (attachment: Pick<Attachment, 'slotId' | 'name'>) =>
  `${attachment.slotId}:${attachment.name}`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const resolveAttachmentOpacityAtFrame = (
  attachment: Attachment,
  frame: number,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
  inBetweenEnabled = true,
) => {
  const baseOpacity = attachment.opacity ?? 1;
  const attachmentKeyframes = attachmentOpacityKeyframes[getAttachmentKey(attachment)];
  if (!attachmentKeyframes) return baseOpacity;

  const frames = Object.keys(attachmentKeyframes).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return baseOpacity;

  let prev: number | null = null;
  let next: number | null = null;

  for (const keyframe of frames) {
    if (keyframe <= frame) prev = keyframe;
    if (keyframe >= frame && next === null) next = keyframe;
  }

  if (prev === null && next !== null) {
    return attachmentKeyframes[next]?.opacity ?? baseOpacity;
  }

  if (prev !== null && next === null) {
    return attachmentKeyframes[prev]?.opacity ?? baseOpacity;
  }

  if (prev !== null && next !== null) {
    if (prev === next) {
      return attachmentKeyframes[prev]?.opacity ?? baseOpacity;
    }

    const t = inBetweenEnabled
      ? applyEasing(
          attachmentKeyframes[prev]?.easing,
          (frame - prev) / (next - prev),
        )
      : 0;
    return lerp(
      attachmentKeyframes[prev]?.opacity ?? baseOpacity,
      attachmentKeyframes[next]?.opacity ?? baseOpacity,
      t,
    );
  }

  return baseOpacity;
};

export const resolveAttachmentAtFrame = (
  attachment: Attachment,
  frame: number,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes = {},
  meshDeformKeyframes: MeshDeformKeyframes = {},
  inBetweenEnabled = true,
): Attachment => {
  const key = getAttachmentKey(attachment);
  const resolvedMesh =
    attachment.type === 'mesh' && attachment.mesh
      ? {
          ...attachment.mesh,
          vertices: resolveMeshVerticesAtFrame(
            attachment,
            frame,
            meshDeformKeyframes,
            key,
            inBetweenEnabled,
          ),
        }
      : attachment.mesh;
  return {
    ...attachment,
    opacity: resolveAttachmentOpacityAtFrame(
      attachment,
      frame,
      attachmentOpacityKeyframes,
      inBetweenEnabled,
    ),
    pixelFrame: frame,
    mesh: resolvedMesh,
  };
};

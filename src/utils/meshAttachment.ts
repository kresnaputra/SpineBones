import type {
  Attachment,
  AttachmentOpacityKeyframes,
  MeshDeformKeyframes,
  MeshTriangle,
  MeshVertex,
} from '../types';
import { applyEasing } from './easing';

const loadImageElement = (imageData: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for mesh bounds'));
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

export const createGridMeshVertices = (
  attachment: Attachment,
  columns = 3,
  rows = 3,
): MeshVertex[] => {
  const vertices: MeshVertex[] = [];
  const sourceBounds = attachment.opaqueBounds ?? {
    x: 0,
    y: 0,
    width: attachment.width,
    height: attachment.height,
  };
  const left = sourceBounds.x - attachment.width / 2;
  const top = sourceBounds.y - attachment.height / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const u = columns === 1 ? 0 : col / (columns - 1);
      const v = rows === 1 ? 0 : row / (rows - 1);
      vertices.push({
        x: left + sourceBounds.width * u,
        y: top + sourceBounds.height * v,
        u: (sourceBounds.x + sourceBounds.width * u) / attachment.width,
        v: (sourceBounds.y + sourceBounds.height * v) / attachment.height,
      });
    }
  }

  return vertices;
};

export const createGridMeshTriangles = (
  columns = 3,
  rows = 3,
): MeshTriangle[] => {
  const triangles: MeshTriangle[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < columns - 1; col += 1) {
      const topLeft = row * columns + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      triangles.push([topLeft, topRight, bottomRight]);
      triangles.push([topLeft, bottomRight, bottomLeft]);
    }
  }
  return triangles;
};

export const ensureMeshAttachment = (attachment: Attachment): Attachment => ({
  ...attachment,
  type: 'mesh',
  meshVertices:
    attachment.meshVertices && attachment.meshVertices.length > 0
      ? attachment.meshVertices
      : createGridMeshVertices(attachment),
  meshTriangles:
    attachment.meshTriangles && attachment.meshTriangles.length > 0
      ? attachment.meshTriangles
      : createGridMeshTriangles(),
});

export const ensureMeshAttachmentAsync = async (
  attachment: Attachment,
): Promise<Attachment> => {
  const opaqueBounds =
    attachment.opaqueBounds ??
    (attachment.imageData ? await getOpaqueBoundsFromImageData(attachment.imageData) : undefined);

  return ensureMeshAttachment({
    ...attachment,
    opaqueBounds,
  });
};

export const getMeshAttachmentKey = (attachment: Pick<Attachment, 'slotId' | 'name'>) =>
  `${attachment.slotId}:${attachment.name}`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const resolveAttachmentOpacityAtFrame = (
  attachment: Attachment,
  frame: number,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes,
) => {
  const baseOpacity = attachment.opacity ?? 1;
  const attachmentKeyframes = attachmentOpacityKeyframes[getMeshAttachmentKey(attachment)];
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

    const t = applyEasing(
      attachmentKeyframes[prev]?.easing,
      (frame - prev) / (next - prev),
    );
    return lerp(
      attachmentKeyframes[prev]?.opacity ?? baseOpacity,
      attachmentKeyframes[next]?.opacity ?? baseOpacity,
      t,
    );
  }

  return baseOpacity;
};

export const resolveMeshVerticesAtFrame = (
  attachment: Attachment,
  frame: number,
  meshDeformKeyframes: MeshDeformKeyframes,
) => {
  if (attachment.type !== 'mesh' || !attachment.meshVertices?.length) {
    return attachment.meshVertices;
  }

  const attachmentKeyframes = meshDeformKeyframes[getMeshAttachmentKey(attachment)];
  if (!attachmentKeyframes) return attachment.meshVertices;

  const frames = Object.keys(attachmentKeyframes).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return attachment.meshVertices;

  let prev: number | null = null;
  let next: number | null = null;

  for (const keyframe of frames) {
    if (keyframe <= frame) prev = keyframe;
    if (keyframe >= frame && next === null) next = keyframe;
  }

  if (prev === null && next !== null) {
    if (next === 0) {
      return attachment.meshVertices.map((vertex, index) => ({
        ...vertex,
        x: attachmentKeyframes[next]?.vertices[index]?.x ?? vertex.x,
        y: attachmentKeyframes[next]?.vertices[index]?.y ?? vertex.y,
      }));
    }

    const t = applyEasing(
      attachmentKeyframes[next]?.easing,
      frame / next,
    );
    return attachment.meshVertices.map((vertex, index) => {
      const to = attachmentKeyframes[next]?.vertices[index];
      return {
        ...vertex,
        x: lerp(vertex.x, to?.x ?? vertex.x, t),
        y: lerp(vertex.y, to?.y ?? vertex.y, t),
      };
    });
  }

  if (prev !== null && next === null) {
    return attachment.meshVertices.map((vertex, index) => ({
      ...vertex,
      x: attachmentKeyframes[prev]?.vertices[index]?.x ?? vertex.x,
      y: attachmentKeyframes[prev]?.vertices[index]?.y ?? vertex.y,
    }));
  }

  if (prev !== null && next !== null) {
    if (prev === next) {
      return attachment.meshVertices.map((vertex, index) => ({
        ...vertex,
        x: attachmentKeyframes[prev]?.vertices[index]?.x ?? vertex.x,
        y: attachmentKeyframes[prev]?.vertices[index]?.y ?? vertex.y,
      }));
    }

    const t = applyEasing(
      attachmentKeyframes[prev]?.easing,
      (frame - prev) / (next - prev),
    );
    return attachment.meshVertices.map((vertex, index) => {
      const from = attachmentKeyframes[prev]?.vertices[index];
      const to = attachmentKeyframes[next]?.vertices[index];
      return {
        ...vertex,
        x: lerp(from?.x ?? vertex.x, to?.x ?? vertex.x, t),
        y: lerp(from?.y ?? vertex.y, to?.y ?? vertex.y, t),
      };
    });
  }

  return attachment.meshVertices;
};

export const resolveAttachmentAtFrame = (
  attachment: Attachment,
  frame: number,
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes = {},
): Attachment => {
  return {
    ...attachment,
    opacity: resolveAttachmentOpacityAtFrame(attachment, frame, attachmentOpacityKeyframes),
    meshVertices:
      attachment.type === 'mesh'
        ? resolveMeshVerticesAtFrame(attachment, frame, meshDeformKeyframes)
        : attachment.meshVertices,
  };
};

import type {
  Attachment,
  AttachmentOpacityKeyframes,
  MeshDeformKeyframes,
  MeshTriangle,
  MeshVertex,
} from '../types';

export const createGridMeshVertices = (
  attachment: Attachment,
  columns = 3,
  rows = 3,
): MeshVertex[] => {
  const vertices: MeshVertex[] = [];
  const left = -attachment.width / 2;
  const top = -attachment.height / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const u = columns === 1 ? 0 : col / (columns - 1);
      const v = rows === 1 ? 0 : row / (rows - 1);
      vertices.push({
        x: left + attachment.width * u,
        y: top + attachment.height * v,
        u,
        v,
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

    const t = (frame - prev) / (next - prev);
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
    return attachment.meshVertices.map((vertex, index) => ({
      ...vertex,
      x: attachmentKeyframes[next]?.vertices[index]?.x ?? vertex.x,
      y: attachmentKeyframes[next]?.vertices[index]?.y ?? vertex.y,
    }));
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

    const t = (frame - prev) / (next - prev);
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

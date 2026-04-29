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
  meshGrid: attachment.meshGrid ?? { columns: 3, rows: 3 },
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

// ─── Mesh editing helpers ────────────────────────────────────────────────────

type ScreenPoint = { x: number; y: number };

type Barycentric = { t0: number; t1: number; t2: number };

const EPSILON = 1e-6;
const HIT_TOLERANCE = 0.001;

const getGridVertexIndex = (columns: number, row: number, col: number) =>
  row * columns + col;

const getBarycentric = (
  point: ScreenPoint,
  p0: ScreenPoint,
  p1: ScreenPoint,
  p2: ScreenPoint,
): Barycentric | null => {
  const denom =
    (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(denom) < EPSILON) return null;

  const t0 =
    ((p1.y - p2.y) * (point.x - p2.x) + (p2.x - p1.x) * (point.y - p2.y)) / denom;
  const t1 =
    ((p2.y - p0.y) * (point.x - p2.x) + (p0.x - p2.x) * (point.y - p2.y)) / denom;
  const t2 = 1 - t0 - t1;

  return { t0, t1, t2 };
};

const isInsideBarycentric = ({ t0, t1, t2 }: Barycentric) =>
  t0 >= -HIT_TOLERANCE && t1 >= -HIT_TOLERANCE && t2 >= -HIT_TOLERANCE;

const interpolateMeshVertex = (
  bary: Barycentric,
  v0: MeshVertex,
  v1: MeshVertex,
  v2: MeshVertex,
): MeshVertex => ({
  x: bary.t0 * v0.x + bary.t1 * v1.x + bary.t2 * v2.x,
  y: bary.t0 * v0.y + bary.t1 * v1.y + bary.t2 * v2.y,
  u: bary.t0 * v0.u + bary.t1 * v1.u + bary.t2 * v2.u,
  v: bary.t0 * v0.v + bary.t1 * v1.v + bary.t2 * v2.v,
});

const insertSortedUnique = (values: number[], value: number) => {
  const clamped = Math.max(0, Math.min(1, value));
  if (values.some(existing => Math.abs(existing - clamped) < 0.0001)) return values;
  return [...values, clamped].sort((a, b) => a - b);
};

const findAxisSegment = (values: number[], value: number) => {
  if (values.length < 2) return 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    const a = values[i]!;
    const b = values[i + 1]!;
    if (value >= a - EPSILON && value <= b + EPSILON) return i;
  }
  return Math.max(0, values.length - 2);
};

const sampleGridPosition = (
  vertices: MeshVertex[],
  columns: number,
  rows: number,
  uValues: number[],
  vValues: number[],
  u: number,
  v: number,
) => {
  const col = findAxisSegment(uValues, u);
  const row = findAxisSegment(vValues, v);
  const u0 = uValues[col] ?? 0;
  const u1 = uValues[col + 1] ?? u0;
  const v0 = vValues[row] ?? 0;
  const v1 = vValues[row + 1] ?? v0;
  const tx = Math.abs(u1 - u0) < EPSILON ? 0 : (u - u0) / (u1 - u0);
  const ty = Math.abs(v1 - v0) < EPSILON ? 0 : (v - v0) / (v1 - v0);

  const topLeft = vertices[getGridVertexIndex(columns, row, col)]!;
  const topRight = vertices[getGridVertexIndex(columns, row, Math.min(col + 1, columns - 1))]!;
  const bottomLeft = vertices[getGridVertexIndex(columns, Math.min(row + 1, rows - 1), col)]!;
  const bottomRight = vertices[
    getGridVertexIndex(columns, Math.min(row + 1, rows - 1), Math.min(col + 1, columns - 1))
  ]!;

  const topX = lerp(topLeft.x, topRight.x, tx);
  const topY = lerp(topLeft.y, topRight.y, tx);
  const bottomX = lerp(bottomLeft.x, bottomRight.x, tx);
  const bottomY = lerp(bottomLeft.y, bottomRight.y, tx);

  return {
    x: lerp(topX, bottomX, ty),
    y: lerp(topY, bottomY, ty),
  };
};

const rebuildGridFromAxes = (
  vertices: MeshVertex[],
  columns: number,
  rows: number,
  nextUValues: number[],
  nextVValues: number[],
): MeshVertex[] => {
  const uValues = Array.from({ length: columns }, (_, col) =>
    vertices[getGridVertexIndex(columns, 0, col)]?.u ?? (columns === 1 ? 0 : col / (columns - 1)),
  );
  const vValues = Array.from({ length: rows }, (_, row) =>
    vertices[getGridVertexIndex(columns, row, 0)]?.v ?? (rows === 1 ? 0 : row / (rows - 1)),
  );

  const nextVertices: MeshVertex[] = [];
  for (const v of nextVValues) {
    for (const u of nextUValues) {
      const pos = sampleGridPosition(vertices, columns, rows, uValues, vValues, u, v);
      nextVertices.push({ ...pos, u, v });
    }
  }
  return nextVertices;
};

const tryInsertGridLinesAtPoint = (
  attachment: Attachment,
  screenX: number,
  screenY: number,
  screenVertices: ScreenPoint[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } | null => {
  const { meshGrid, meshVertices } = attachment;
  if (!meshGrid || !meshVertices?.length) return null;

  const { columns, rows } = meshGrid;
  if (columns < 2 || rows < 2 || meshVertices.length !== columns * rows) return null;

  const point = { x: screenX, y: screenY };
  let inserted: Pick<MeshVertex, 'u' | 'v'> | null = null;

  for (let row = 0; row < rows - 1 && !inserted; row += 1) {
    for (let col = 0; col < columns - 1; col += 1) {
      const i0 = getGridVertexIndex(columns, row, col);
      const i1 = getGridVertexIndex(columns, row, col + 1);
      const i2 = getGridVertexIndex(columns, row + 1, col + 1);
      const i3 = getGridVertexIndex(columns, row + 1, col);
      const p0 = screenVertices[i0];
      const p1 = screenVertices[i1];
      const p2 = screenVertices[i2];
      const p3 = screenVertices[i3];
      const v0 = meshVertices[i0];
      const v1 = meshVertices[i1];
      const v2 = meshVertices[i2];
      const v3 = meshVertices[i3];
      if (!p0 || !p1 || !p2 || !p3 || !v0 || !v1 || !v2 || !v3) continue;

      const first = getBarycentric(point, p0, p1, p2);
      if (first && isInsideBarycentric(first)) {
        inserted = interpolateMeshVertex(first, v0, v1, v2);
        break;
      }

      const second = getBarycentric(point, p0, p2, p3);
      if (second && isInsideBarycentric(second)) {
        inserted = interpolateMeshVertex(second, v0, v2, v3);
        break;
      }
    }
  }

  if (!inserted) return null;

  const uValues = Array.from({ length: columns }, (_, col) => meshVertices[getGridVertexIndex(columns, 0, col)]?.u ?? 0);
  const vValues = Array.from({ length: rows }, (_, row) => meshVertices[getGridVertexIndex(columns, row, 0)]?.v ?? 0);
  const nextUValues = insertSortedUnique(uValues, inserted.u);
  const nextVValues = insertSortedUnique(vValues, inserted.v);
  if (nextUValues.length === uValues.length && nextVValues.length === vValues.length) return null;

  const nextColumns = nextUValues.length;
  const nextRows = nextVValues.length;
  const nextVertices = rebuildGridFromAxes(meshVertices, columns, rows, nextUValues, nextVValues);

  const nextKeyframes = { ...meshDeformKeyframes };
  const existing = nextKeyframes[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      const frameVertices = meshVertices.map((vertex, index) => ({
        ...vertex,
        x: kf.vertices[index]?.x ?? vertex.x,
        y: kf.vertices[index]?.y ?? vertex.y,
      }));
      updated[Number(frameStr)] = {
        ...kf,
        vertices: rebuildGridFromAxes(
          frameVertices,
          columns,
          rows,
          nextUValues,
          nextVValues,
        ).map(({ x, y }) => ({ x, y })),
      };
    }
    nextKeyframes[attachmentKey] = updated;
  }

  return {
    attachment: {
      ...attachment,
      meshVertices: nextVertices,
      meshTriangles: createGridMeshTriangles(nextColumns, nextRows),
      meshGrid: { columns: nextColumns, rows: nextRows },
      meshPinnedVertices: undefined,
      meshVertexWeights: undefined,
    },
    meshDeformKeyframes: nextKeyframes,
  };
};

/** Reverse-project a vertex's UV back to the attachment-local base position. */
export const getVertexBasePosition = (
  vertex: MeshVertex,
  attachment: Attachment,
): { x: number; y: number } => ({
  x: vertex.u * attachment.width - attachment.width / 2,
  y: vertex.v * attachment.height - attachment.height / 2,
});

/** Build a per-vertex neighbour set from triangle data. */
export const buildMeshAdjacency = (
  triangles: MeshTriangle[],
  vertexCount: number,
): Set<number>[] => {
  const adj: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const [a, b, c] of triangles) {
    adj[a]?.add(b); adj[a]?.add(c);
    adj[b]?.add(a); adj[b]?.add(c);
    adj[c]?.add(a); adj[c]?.add(b);
  }
  return adj;
};

/**
 * One step of Laplacian smoothing.
 * Only moves selected non-pinned vertices toward their neighbour average.
 */
export const relaxMeshVertices = (
  vertices: MeshVertex[],
  triangles: MeshTriangle[],
  selectedIndices: number[],
  pinnedIndices: number[],
  strength = 0.5,
): MeshVertex[] => {
  const adj = buildMeshAdjacency(triangles, vertices.length);
  const selected = new Set(selectedIndices);
  const pinned = new Set(pinnedIndices);

  return vertices.map((v, i) => {
    if (!selected.has(i) || pinned.has(i)) return v;
    const neighbors = Array.from(adj[i] ?? [])
      .map(j => vertices[j])
      .filter((n): n is MeshVertex => !!n);
    if (neighbors.length === 0) return v;
    const avgX = neighbors.reduce((s, n) => s + n.x, 0) / neighbors.length;
    const avgY = neighbors.reduce((s, n) => s + n.y, 0) / neighbors.length;
    return { ...v, x: v.x + (avgX - v.x) * strength, y: v.y + (avgY - v.y) * strength };
  });
};

/**
 * Rebuild the mesh as a new grid (cols×rows).
 * Clears pinned/weight data since vertex count changes.
 */
export const rebuildMeshGrid = (
  attachment: Attachment,
  cols: number,
  rows: number,
): Attachment => ({
  ...attachment,
  meshVertices: createGridMeshVertices(attachment, cols, rows),
  meshTriangles: createGridMeshTriangles(cols, rows),
  meshGrid: { columns: cols, rows },
  meshPinnedVertices: undefined,
  meshVertexWeights: undefined,
});

/**
 * Insert a new vertex by splitting the triangle that contains the given
 * screen-space point. Interpolates UV and local position via barycentric coords.
 * All existing deform keyframes receive a new entry for the vertex at its
 * base position so the animation is unaffected.
 */
export const insertMeshVertex = (
  attachment: Attachment,
  screenX: number,
  screenY: number,
  screenVertices: ScreenPoint[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } | null => {
  const { meshVertices, meshTriangles } = attachment;
  if (!meshVertices?.length || !meshTriangles?.length) return null;

  const gridInsert = tryInsertGridLinesAtPoint(
    attachment,
    screenX,
    screenY,
    screenVertices,
    meshDeformKeyframes,
    attachmentKey,
  );
  if (gridInsert) return gridInsert;

  // Find the triangle that contains the click position in screen space.
  let triIndex = -1;
  let bary = { t0: 0, t1: 0, t2: 0 };

  for (let ti = 0; ti < meshTriangles.length; ti++) {
    const [i0, i1, i2] = meshTriangles[ti];
    const p0 = screenVertices[i0];
    const p1 = screenVertices[i1];
    const p2 = screenVertices[i2];
    if (!p0 || !p1 || !p2) continue;

    const hit = getBarycentric({ x: screenX, y: screenY }, p0, p1, p2);
    if (hit && isInsideBarycentric(hit)) {
      triIndex = ti;
      bary = hit;
      break;
    }
  }

  if (triIndex < 0) return null;

  const [i0, i1, i2] = meshTriangles[triIndex];
  const v0 = meshVertices[i0]!;
  const v1 = meshVertices[i1]!;
  const v2 = meshVertices[i2]!;

  const newVertex = interpolateMeshVertex(bary, v0, v1, v2);

  const newIdx = meshVertices.length;
  const newVertices = [...meshVertices, newVertex];
  const newTriangles: MeshTriangle[] = [
    ...meshTriangles.filter((_, ti) => ti !== triIndex),
    [i0, i1, newIdx],
    [i1, i2, newIdx],
    [i2, i0, newIdx],
  ];

  // Append the base position to every existing deform keyframe.
  const nextKeyframes = { ...meshDeformKeyframes };
  const existing = nextKeyframes[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      updated[Number(frameStr)] = {
        ...kf,
        vertices: [...kf.vertices, { x: newVertex.x, y: newVertex.y }],
      };
    }
    nextKeyframes[attachmentKey] = updated;
  }

  return {
    attachment: {
      ...attachment,
      meshVertices: newVertices,
      meshTriangles: newTriangles,
      meshGrid: undefined,
      meshPinnedVertices: attachment.meshPinnedVertices
        ? [...attachment.meshPinnedVertices, false]
        : undefined,
      meshVertexWeights: attachment.meshVertexWeights
        ? [...attachment.meshVertexWeights, []]
        : undefined,
    },
    meshDeformKeyframes: nextKeyframes,
  };
};

/**
 * Simple Delaunay triangulation using Bowyer-Watson algorithm.
 * Returns triangle indices for the given vertices.
 */
const delaunayTriangulate = (vertices: MeshVertex[]): MeshTriangle[] => {
  if (vertices.length < 3) return [];
  
  // Create super-triangle that contains all points
  const minX = Math.min(...vertices.map(v => v.x));
  const minY = Math.min(...vertices.map(v => v.y));
  const maxX = Math.max(...vertices.map(v => v.x));
  const maxY = Math.max(...vertices.map(v => v.y));
  const dx = maxX - minX;
  const dy = maxY - minY;
  const deltaMax = Math.max(dx, dy) * 2;
  
  const superVertices: MeshVertex[] = [
    { x: minX - deltaMax, y: minY - deltaMax, u: 0, v: 0 },
    { x: minX + deltaMax * 2, y: minY - deltaMax, u: 0, v: 0 },
    { x: minX - deltaMax, y: minY + deltaMax * 2, u: 0, v: 0 },
  ];
  
  const allVertices = [...vertices, ...superVertices];
  const triangles: MeshTriangle[] = [[vertices.length, vertices.length + 1, vertices.length + 2]];
  
  // Helper: check if point is inside triangle's circumcircle
  const inCircumcircle = (px: number, py: number, tri: MeshTriangle): boolean => {
    const [i, j, k] = tri;
    const a = allVertices[i]!;
    const b = allVertices[j]!;
    const c = allVertices[k]!;
    
    const ax = a.x - px;
    const ay = a.y - py;
    const bx = b.x - px;
    const by = b.y - py;
    const cx = c.x - px;
    const cy = c.y - py;
    
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) -
                (bx * bx + by * by) * (ax * cy - cx * ay) +
                (cx * cx + cy * cy) * (ax * by - bx * ay);
    
    return det > 0;
  };
  
  // Add each vertex one at a time
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i]!;
    const badTriangles: MeshTriangle[] = [];
    
    // Find all triangles whose circumcircle contains the vertex
    for (const tri of triangles) {
      if (inCircumcircle(vertex.x, vertex.y, tri)) {
        badTriangles.push(tri);
      }
    }
    
    // Find the boundary of the polygonal hole
    const polygon: Array<[number, number]> = [];
    for (const tri of badTriangles) {
      const edges: Array<[number, number]> = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      
      for (const edge of edges) {
        const isShared = badTriangles.some(otherTri => {
          if (otherTri === tri) return false;
          return (
            (otherTri.includes(edge[0]) && otherTri.includes(edge[1]))
          );
        });
        
        if (!isShared) {
          polygon.push(edge);
        }
      }
    }
    
    // Remove bad triangles
    for (const tri of badTriangles) {
      const idx = triangles.indexOf(tri);
      if (idx >= 0) triangles.splice(idx, 1);
    }
    
    // Re-triangulate the hole with the new vertex
    for (const edge of polygon) {
      triangles.push([edge[0], edge[1], i]);
    }
  }
  
  // Remove triangles that use super-triangle vertices
  const finalTriangles = triangles.filter(tri => 
    tri.every(idx => idx < vertices.length)
  );
  
  return finalTriangles;
};

/**
 * Remove vertices at the given indices.
 * Retriangulates the mesh to preserve coverage without leaving holes.
 * Remaining triangle indices and all deform keyframe entries are remapped.
 */
export const removeMeshVertices = (
  attachment: Attachment,
  removeIndices: number[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } => {
  const { meshVertices, meshTriangles } = attachment;
  if (!meshVertices?.length || !meshTriangles?.length) {
    return { attachment, meshDeformKeyframes };
  }

  const removeSet = new Set(removeIndices);
  const indexRemap = new Map<number, number>();
  let nextIdx = 0;
  for (let i = 0; i < meshVertices.length; i++) {
    if (!removeSet.has(i)) indexRemap.set(i, nextIdx++);
  }

  const newVertices = meshVertices.filter((_, i) => !removeSet.has(i));
  
  // Retriangulate to preserve mesh coverage
  const newTriangles = delaunayTriangulate(newVertices);

  const nextKeyframes = { ...meshDeformKeyframes };
  const existing = nextKeyframes[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      updated[Number(frameStr)] = {
        ...kf,
        vertices: kf.vertices.filter((_, i) => !removeSet.has(i)),
      };
    }
    nextKeyframes[attachmentKey] = updated;
  }

  const newPinned = attachment.meshPinnedVertices?.filter((_, i) => !removeSet.has(i));
  const newWeights = attachment.meshVertexWeights?.filter((_, i) => !removeSet.has(i));

  return {
    attachment: {
      ...attachment,
      meshVertices: newVertices,
      meshTriangles: newTriangles,
      meshPinnedVertices: newPinned?.length ? newPinned : undefined,
      meshVertexWeights: newWeights?.length ? newWeights : undefined,
    },
    meshDeformKeyframes: nextKeyframes,
  };
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

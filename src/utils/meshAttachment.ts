import type {
  Attachment,
  AttachmentMesh,
  MeshDeformKeyframes,
  MeshTriangle,
  MeshVertex,
} from '../types';
import { applyEasing } from './easing';
import { getOpaqueBoundsFromImageData } from './attachmentUtils';

// ─── Edge helpers ──────────────────────────────────────────────────────────

/** Build unique undirected edges from a triangle list (for wireframe rendering). */
export const buildMeshEdges = (triangles: MeshTriangle[]): [number, number][] => {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([u < v ? u : v, u < v ? v : u]);
      }
    }
  }
  return edges;
};

// ─── Grid mesh creation ───────────────────────────────────────────────────

export const createGridMeshVertices = (
  attachment: Attachment,
  columns = 3,
  rows = 3,
): MeshVertex[] => {
  const bounds = attachment.opaqueBounds ?? {
    x: 0,
    y: 0,
    width: attachment.width,
    height: attachment.height,
  };
  const left = bounds.x - attachment.width / 2;
  const top = bounds.y - attachment.height / 2;
  // When the stored image is already cropped to its opaque bounds, the texture
  // IS the opaque region, so the grid (which spans that region) maps to UV 0..1.
  // Otherwise the texture is the full image and UVs are the opaque sub-range.
  const cropped = attachment.imageIsCropped && attachment.opaqueBounds;
  const vertices: MeshVertex[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const u = columns === 1 ? 0 : col / (columns - 1);
      const v = rows === 1 ? 0 : row / (rows - 1);
      vertices.push({
        x: left + bounds.width * u,
        y: top + bounds.height * v,
        u: cropped ? u : (bounds.x + bounds.width * u) / attachment.width,
        v: cropped ? v : (bounds.y + bounds.height * v) / attachment.height,
      });
    }
  }
  return vertices;
};

export const createGridMeshTriangles = (columns = 3, rows = 3): MeshTriangle[] => {
  const triangles: MeshTriangle[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < columns - 1; col += 1) {
      const tl = row * columns + col;
      const tr = tl + 1;
      const bl = tl + columns;
      const br = bl + 1;
      triangles.push([tl, tr, br]);
      triangles.push([tl, br, bl]);
    }
  }
  return triangles;
};

const createGridMesh = (attachment: Attachment, cols: number, rows: number): AttachmentMesh => {
  const vertices = createGridMeshVertices(attachment, cols, rows);
  const triangles = createGridMeshTriangles(cols, rows);
  return { vertices, triangles, edges: buildMeshEdges(triangles), grid: { columns: cols, rows } };
};

// ─── Mesh attachment creation ──────────────────────────────────────────────

/** Ensure an attachment has a rest mesh, returning it unchanged if already a mesh. */
export const ensureMeshAttachment = (attachment: Attachment): Attachment => {
  if (attachment.type === 'mesh' && attachment.mesh?.vertices.length) return attachment;
  const mesh = createGridMesh(attachment, 3, 3);
  return { ...attachment, type: 'mesh', mesh };
};

export const ensureMeshAttachmentAsync = async (attachment: Attachment): Promise<Attachment> => {
  const opaqueBounds =
    attachment.opaqueBounds ??
    (attachment.imageData ? await getOpaqueBoundsFromImageData(attachment.imageData) : undefined);
  return ensureMeshAttachment({ ...attachment, opaqueBounds });
};

/**
 * Rebuild the attachment's mesh as a cols×rows grid.
 * Clears weight/pin data because vertex count changes.
 */
export const rebuildMeshGrid = (attachment: Attachment, cols: number, rows: number): Attachment => ({
  ...attachment,
  type: 'mesh',
  mesh: createGridMesh(attachment, cols, rows),
  vertexWeights: undefined,
  pinned: undefined,
});

// ─── Relax (Laplacian smoothing) ──────────────────────────────────────────

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
    const neighbours = Array.from(adj[i] ?? []).map((j) => vertices[j]).filter((n): n is MeshVertex => !!n);
    if (neighbours.length === 0) return v;
    const avgX = neighbours.reduce((s, n) => s + n.x, 0) / neighbours.length;
    const avgY = neighbours.reduce((s, n) => s + n.y, 0) / neighbours.length;
    return { ...v, x: v.x + (avgX - v.x) * strength, y: v.y + (avgY - v.y) * strength };
  });
};

// ─── Vertex base position ─────────────────────────────────────────────────

/** UV back-project to attachment-local rest position. */
export const getVertexBasePosition = (
  vertex: MeshVertex,
  attachment: Attachment,
): { x: number; y: number } => ({
  x: vertex.u * attachment.width - attachment.width / 2,
  y: vertex.v * attachment.height - attachment.height / 2,
});

// ─── Mesh deform resolution ───────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const resolveMeshVerticesAtFrame = (
  attachment: Attachment,
  frame: number,
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): MeshVertex[] => {
  const restVerts = attachment.mesh?.vertices;
  if (!restVerts?.length) return [];

  const attachmentKFs = meshDeformKeyframes[attachmentKey];
  if (!attachmentKFs) return restVerts;

  const frames = Object.keys(attachmentKFs).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return restVerts;

  let prev: number | null = null;
  let next: number | null = null;
  for (const kf of frames) {
    if (kf <= frame) prev = kf;
    if (kf >= frame && next === null) next = kf;
  }

  if (prev === null && next !== null) {
    if (next === 0) {
      return restVerts.map((v, i) => ({
        ...v,
        x: attachmentKFs[next]?.vertices[i]?.x ?? v.x,
        y: attachmentKFs[next]?.vertices[i]?.y ?? v.y,
      }));
    }
    const t = applyEasing(attachmentKFs[next]?.easing, frame / next);
    return restVerts.map((v, i) => {
      const to = attachmentKFs[next]?.vertices[i];
      return { ...v, x: lerp(v.x, to?.x ?? v.x, t), y: lerp(v.y, to?.y ?? v.y, t) };
    });
  }

  if (prev !== null && next === null) {
    return restVerts.map((v, i) => ({
      ...v,
      x: attachmentKFs[prev]?.vertices[i]?.x ?? v.x,
      y: attachmentKFs[prev]?.vertices[i]?.y ?? v.y,
    }));
  }

  if (prev !== null && next !== null) {
    if (prev === next) {
      return restVerts.map((v, i) => ({
        ...v,
        x: attachmentKFs[prev]?.vertices[i]?.x ?? v.x,
        y: attachmentKFs[prev]?.vertices[i]?.y ?? v.y,
      }));
    }
    const t = applyEasing(attachmentKFs[prev]?.easing, (frame - prev) / (next - prev));
    return restVerts.map((v, i) => {
      const from = attachmentKFs[prev]?.vertices[i];
      const to = attachmentKFs[next]?.vertices[i];
      return {
        ...v,
        x: lerp(from?.x ?? v.x, to?.x ?? v.x, t),
        y: lerp(from?.y ?? v.y, to?.y ?? v.y, t),
      };
    });
  }

  return restVerts;
};

// ─── Delaunay triangulation (Bowyer-Watson) ───────────────────────────────

const delaunayTriangulate = (vertices: MeshVertex[]): MeshTriangle[] => {
  if (vertices.length < 3) return [];

  const minX = Math.min(...vertices.map((v) => v.x));
  const minY = Math.min(...vertices.map((v) => v.y));
  const maxX = Math.max(...vertices.map((v) => v.x));
  const maxY = Math.max(...vertices.map((v) => v.y));
  const d = Math.max(maxX - minX, maxY - minY) * 2;

  const superVerts: MeshVertex[] = [
    { x: minX - d, y: minY - d, u: 0, v: 0 },
    { x: minX + d * 2, y: minY - d, u: 0, v: 0 },
    { x: minX - d, y: minY + d * 2, u: 0, v: 0 },
  ];
  const allVerts = [...vertices, ...superVerts];
  const n = vertices.length;
  const tris: MeshTriangle[] = [[n, n + 1, n + 2]];

  const inCircumcircle = (px: number, py: number, tri: MeshTriangle): boolean => {
    const [i, j, k] = tri;
    const a = allVerts[i]!; const b = allVerts[j]!; const c = allVerts[k]!;
    const ax = a.x - px; const ay = a.y - py;
    const bx = b.x - px; const by = b.y - py;
    const cx = c.x - px; const cy = c.y - py;
    return (
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay)
    ) > 0;
  };

  for (let i = 0; i < n; i += 1) {
    const { x, y } = vertices[i]!;
    const bad = tris.filter((t) => inCircumcircle(x, y, t));
    const polygon: [number, number][] = [];
    for (const tri of bad) {
      const edges: [number, number][] = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      for (const edge of edges) {
        if (!bad.some((other) => other !== tri && other.includes(edge[0]) && other.includes(edge[1]))) {
          polygon.push(edge);
        }
      }
    }
    for (const tri of bad) tris.splice(tris.indexOf(tri), 1);
    for (const edge of polygon) tris.push([edge[0], edge[1], i]);
  }

  return tris.filter((t) => t.every((idx) => idx < n));
};

// ─── Vertex insertion ─────────────────────────────────────────────────────

type ScreenPoint = { x: number; y: number };
const EPSILON = 1e-6;
const HIT_TOLERANCE = 0.001;

const getBarycentric = (p: ScreenPoint, p0: ScreenPoint, p1: ScreenPoint, p2: ScreenPoint) => {
  const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(denom) < EPSILON) return null;
  const t0 = ((p1.y - p2.y) * (p.x - p2.x) + (p2.x - p1.x) * (p.y - p2.y)) / denom;
  const t1 = ((p2.y - p0.y) * (p.x - p2.x) + (p0.x - p2.x) * (p.y - p2.y)) / denom;
  const t2 = 1 - t0 - t1;
  return { t0, t1, t2 };
};

const isInside = (b: { t0: number; t1: number; t2: number }) =>
  b.t0 >= -HIT_TOLERANCE && b.t1 >= -HIT_TOLERANCE && b.t2 >= -HIT_TOLERANCE;

const interpVertex = (
  b: { t0: number; t1: number; t2: number },
  v0: MeshVertex, v1: MeshVertex, v2: MeshVertex,
): MeshVertex => ({
  x: b.t0 * v0.x + b.t1 * v1.x + b.t2 * v2.x,
  y: b.t0 * v0.y + b.t1 * v1.y + b.t2 * v2.y,
  u: b.t0 * v0.u + b.t1 * v1.u + b.t2 * v2.u,
  v: b.t0 * v0.v + b.t1 * v1.v + b.t2 * v2.v,
});

// Grid-line insertion helpers
const insertSortedUnique = (values: number[], value: number) => {
  const c = Math.max(0, Math.min(1, value));
  if (values.some((e) => Math.abs(e - c) < 0.0001)) return values;
  return [...values, c].sort((a, b) => a - b);
};

const gridIdx = (cols: number, row: number, col: number) => row * cols + col;

const findSeg = (values: number[], value: number) => {
  for (let i = 0; i < values.length - 1; i += 1) {
    if (value >= (values[i] ?? 0) - EPSILON && value <= (values[i + 1] ?? 1) + EPSILON) return i;
  }
  return Math.max(0, values.length - 2);
};

const sampleGridPos = (
  verts: MeshVertex[], cols: number, rows: number,
  uVals: number[], vVals: number[], u: number, v: number,
) => {
  const col = findSeg(uVals, u);
  const row = findSeg(vVals, v);
  const u0 = uVals[col] ?? 0; const u1 = uVals[col + 1] ?? u0;
  const v0 = vVals[row] ?? 0; const v1 = vVals[row + 1] ?? v0;
  const tx = Math.abs(u1 - u0) < EPSILON ? 0 : (u - u0) / (u1 - u0);
  const ty = Math.abs(v1 - v0) < EPSILON ? 0 : (v - v0) / (v1 - v0);
  const tl = verts[gridIdx(cols, row, col)]!;
  const tr = verts[gridIdx(cols, row, Math.min(col + 1, cols - 1))]!;
  const bl = verts[gridIdx(cols, Math.min(row + 1, rows - 1), col)]!;
  const br = verts[gridIdx(cols, Math.min(row + 1, rows - 1), Math.min(col + 1, cols - 1))]!;
  return {
    x: lerp(lerp(tl.x, tr.x, tx), lerp(bl.x, br.x, tx), ty),
    y: lerp(lerp(tl.y, tr.y, tx), lerp(bl.y, br.y, tx), ty),
  };
};

const rebuildGridFromAxes = (
  verts: MeshVertex[], cols: number, rows: number,
  nextU: number[], nextV: number[],
): MeshVertex[] => {
  const uVals = Array.from({ length: cols }, (_, c) => verts[gridIdx(cols, 0, c)]?.u ?? c / (cols - 1 || 1));
  const vVals = Array.from({ length: rows }, (_, r) => verts[gridIdx(cols, r, 0)]?.v ?? r / (rows - 1 || 1));
  const out: MeshVertex[] = [];
  for (const v of nextV) {
    for (const u of nextU) {
      const pos = sampleGridPos(verts, cols, rows, uVals, vVals, u, v);
      out.push({ ...pos, u, v });
    }
  }
  return out;
};

const tryGridInsert = (
  attachment: Attachment,
  sx: number, sy: number,
  screenVerts: ScreenPoint[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } | null => {
  const { mesh } = attachment;
  if (!mesh?.grid || !mesh.vertices.length) return null;
  const { columns: cols, rows } = mesh.grid;
  if (cols < 2 || rows < 2 || mesh.vertices.length !== cols * rows) return null;

  const point = { x: sx, y: sy };
  let inserted: Pick<MeshVertex, 'u' | 'v'> | null = null;

  for (let row = 0; row < rows - 1 && !inserted; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const [i0, i1, i2, i3] = [
        gridIdx(cols, row, col), gridIdx(cols, row, col + 1),
        gridIdx(cols, row + 1, col + 1), gridIdx(cols, row + 1, col),
      ];
      const [p0, p1, p2, p3] = [screenVerts[i0], screenVerts[i1], screenVerts[i2], screenVerts[i3]];
      const [v0, v1, v2, v3] = [mesh.vertices[i0], mesh.vertices[i1], mesh.vertices[i2], mesh.vertices[i3]];
      if (!p0 || !p1 || !p2 || !p3 || !v0 || !v1 || !v2 || !v3) continue;
      const b1 = getBarycentric(point, p0, p1, p2);
      if (b1 && isInside(b1)) { inserted = interpVertex(b1, v0, v1, v2); break; }
      const b2 = getBarycentric(point, p0, p2, p3);
      if (b2 && isInside(b2)) { inserted = interpVertex(b2, v0, v2, v3); break; }
    }
  }
  if (!inserted) return null;

  const uVals = Array.from({ length: cols }, (_, c) => mesh.vertices[gridIdx(cols, 0, c)]?.u ?? 0);
  const vVals = Array.from({ length: rows }, (_, r) => mesh.vertices[gridIdx(cols, r, 0)]?.v ?? 0);
  const nextU = insertSortedUnique(uVals, inserted.u);
  const nextV = insertSortedUnique(vVals, inserted.v);
  if (nextU.length === uVals.length && nextV.length === vVals.length) return null;

  const nextCols = nextU.length; const nextRows = nextV.length;
  const nextVerts = rebuildGridFromAxes(mesh.vertices, cols, rows, nextU, nextV);
  const nextTris = createGridMeshTriangles(nextCols, nextRows);
  const nextKFs = { ...meshDeformKeyframes };
  const existing = nextKFs[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      const frameVerts = mesh.vertices.map((v, i) => ({
        ...v, x: kf.vertices[i]?.x ?? v.x, y: kf.vertices[i]?.y ?? v.y,
      }));
      updated[Number(frameStr)] = {
        ...kf,
        vertices: rebuildGridFromAxes(frameVerts, cols, rows, nextU, nextV).map(({ x, y }) => ({ x, y })),
      };
    }
    nextKFs[attachmentKey] = updated;
  }

  return {
    attachment: {
      ...attachment,
      mesh: { vertices: nextVerts, triangles: nextTris, edges: buildMeshEdges(nextTris), grid: { columns: nextCols, rows: nextRows } },
      vertexWeights: undefined,
      pinned: undefined,
    },
    meshDeformKeyframes: nextKFs,
  };
};

/**
 * Insert a vertex by splitting the triangle that contains (sx, sy) in screen space.
 * For grid meshes, inserts a new grid row/column through the point instead.
 * Returns null if (sx, sy) is outside all triangles.
 */
export const insertMeshVertex = (
  attachment: Attachment,
  sx: number, sy: number,
  screenVerts: ScreenPoint[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } | null => {
  const { mesh } = attachment;
  if (!mesh?.vertices.length || !mesh.triangles.length) return null;

  // Try grid-line insertion first
  const gridResult = tryGridInsert(attachment, sx, sy, screenVerts, meshDeformKeyframes, attachmentKey);
  if (gridResult) return gridResult;

  // Fall back: split the triangle that contains the click
  const point = { x: sx, y: sy };
  let newVertex: MeshVertex | null = null;
  let splitTri: MeshTriangle | null = null;

  for (const tri of mesh.triangles) {
    const [i0, i1, i2] = tri;
    const p0 = screenVerts[i0]; const p1 = screenVerts[i1]; const p2 = screenVerts[i2];
    const v0 = mesh.vertices[i0]; const v1 = mesh.vertices[i1]; const v2 = mesh.vertices[i2];
    if (!p0 || !p1 || !p2 || !v0 || !v1 || !v2) continue;
    const b = getBarycentric(point, p0, p1, p2);
    if (b && isInside(b)) { newVertex = interpVertex(b, v0, v1, v2); splitTri = tri; break; }
  }

  if (!newVertex || !splitTri) return null;

  const newIdx = mesh.vertices.length;
  const newVerts = [...mesh.vertices, newVertex];
  const [a, b, c] = splitTri;
  const newTris = [
    ...mesh.triangles.filter((t) => t !== splitTri),
    [a, b, newIdx] as MeshTriangle,
    [b, c, newIdx] as MeshTriangle,
    [c, a, newIdx] as MeshTriangle,
  ];

  const nextKFs = { ...meshDeformKeyframes };
  const existing = nextKFs[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      updated[Number(frameStr)] = {
        ...kf,
        vertices: [...kf.vertices, { x: newVertex.x, y: newVertex.y }],
      };
    }
    nextKFs[attachmentKey] = updated;
  }

  return {
    attachment: {
      ...attachment,
      mesh: { vertices: newVerts, triangles: newTris, edges: buildMeshEdges(newTris) },
      pinned: attachment.pinned ? [...attachment.pinned, false] : undefined,
      vertexWeights: attachment.vertexWeights ? [...attachment.vertexWeights, []] : undefined,
    },
    meshDeformKeyframes: nextKFs,
  };
};

// ─── Vertex removal ───────────────────────────────────────────────────────

/**
 * Remove vertices at `removeIndices`, retriangulate via Delaunay, remap keyframes.
 */
export const removeMeshVertices = (
  attachment: Attachment,
  removeIndices: number[],
  meshDeformKeyframes: MeshDeformKeyframes,
  attachmentKey: string,
): { attachment: Attachment; meshDeformKeyframes: MeshDeformKeyframes } => {
  const { mesh } = attachment;
  if (!mesh?.vertices.length || !mesh.triangles.length) return { attachment, meshDeformKeyframes };

  const removeSet = new Set(removeIndices);
  const newVerts = mesh.vertices.filter((_, i) => !removeSet.has(i));
  const newTris = delaunayTriangulate(newVerts);

  const nextKFs = { ...meshDeformKeyframes };
  const existing = nextKFs[attachmentKey];
  if (existing) {
    const updated: typeof existing = {};
    for (const [frameStr, kf] of Object.entries(existing)) {
      updated[Number(frameStr)] = {
        ...kf,
        vertices: kf.vertices.filter((_, i) => !removeSet.has(i)),
      };
    }
    nextKFs[attachmentKey] = updated;
  }

  return {
    attachment: {
      ...attachment,
      mesh: { vertices: newVerts, triangles: newTris, edges: buildMeshEdges(newTris) },
      pinned: attachment.pinned?.filter((_, i) => !removeSet.has(i)),
      vertexWeights: attachment.vertexWeights?.filter((_, i) => !removeSet.has(i)),
    },
    meshDeformKeyframes: nextKFs,
  };
};

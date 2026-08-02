import type { Attachment, AttachmentMesh, MeshVertex } from '../types';
import { buildMeshEdges } from './meshAttachment';

type Pt = { x: number; y: number };
type Tri = [number, number, number];

// ─── marching squares ─────────────────────────────────────────────────────────
//
// Encoding:  case = (TL?1:0)|(TR?2:0)|(BL?4:0)|(BR?8:0)
// Edges:     0=Top  1=Right  2=Bottom  3=Left
// Midpoints: Top=(cx+0.5,cy)  Right=(cx+1,cy+0.5)  Bottom=(cx+0.5,cy+1)  Left=(cx,cy+0.5)

const MS: number[][][] = [
  [],       [[0,3]], [[0,1]], [[3,1]], [[3,2]], [[0,2]],
  [[0,1],[3,2]],     // 6: TR+BL saddle → Top-Right and Left-Bottom
  [[1,2]],
  [[1,2]], [[0,3],[1,2]],   // 9: TL+BR saddle → Top-Left and Right-Bottom
  [[0,2]], [[3,2]], [[3,1]], [[0,1]], [[0,3]], [],
];

const eMid = (cx: number, cy: number, e: number): Pt =>
  e === 0 ? { x: cx + 0.5, y: cy }
  : e === 1 ? { x: cx + 1,   y: cy + 0.5 }
  : e === 2 ? { x: cx + 0.5, y: cy + 1 }
  :           { x: cx,       y: cy + 0.5 };

const runMS = (alpha: Uint8ClampedArray, w: number, h: number, thr: number): [Pt, Pt][] => {
  const segs: [Pt, Pt][] = [];
  const ia = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x]! >= thr;
  for (let cy = 0; cy < h - 1; cy++) {
    for (let cx = 0; cx < w - 1; cx++) {
      const c =
        (ia(cx,   cy)   ? 1 : 0) | (ia(cx+1, cy)   ? 2 : 0) |
        (ia(cx,   cy+1) ? 4 : 0) | (ia(cx+1, cy+1) ? 8 : 0);
      for (const [e1, e2] of (MS[c] ?? [])) {
        segs.push([eMid(cx, cy, e1!), eMid(cx, cy, e2!)]);
      }
    }
  }
  return segs;
};

const alphaArea = (alpha: Uint8ClampedArray, thr: number): number => {
  let area = 0;
  for (const a of alpha) {
    if (a >= thr) area += 1;
  }
  return area;
};

const alphaCentroid = (
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  thr: number,
): Pt => {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (alpha[y * w + x]! < thr) continue;
      sx += x + 0.5;
      sy += y + 0.5;
      count += 1;
    }
  }
  return count > 0 ? { x: sx / count, y: sy / count } : { x: w / 2, y: h / 2 };
};

const traceAlphaEnvelope = (
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  thr: number,
): Pt[] => {
  const pts: Pt[] = [];
  const isOn = (x: number, y: number) => alpha[y * w + x]! >= thr;

  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      if (isOn(x, y)) {
        pts.push({ x: x + 0.5, y });
        break;
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      if (isOn(x, y)) {
        pts.push({ x: x + 1, y: y + 0.5 });
        break;
      }
    }
  }
  for (let x = w - 1; x >= 0; x -= 1) {
    for (let y = h - 1; y >= 0; y -= 1) {
      if (isOn(x, y)) {
        pts.push({ x: x + 0.5, y: y + 1 });
        break;
      }
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = 0; x < w; x += 1) {
      if (isOn(x, y)) {
        pts.push({ x, y: y + 0.5 });
        break;
      }
    }
  }

  return pts.filter((p, i) => i === 0 || pk(p) !== pk(pts[i - 1]!));
};

// ─── segment chaining ─────────────────────────────────────────────────────────

// Half-integer coords: multiply by 2 to get integers for a stable key
const pk = (p: Pt) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

const chainSegments = (segs: [Pt, Pt][]): Pt[][] => {
  const adj = new Map<string, Pt[]>();
  const ptOf = new Map<string, Pt>();
  for (const [a, b] of segs) {
    const ka = pk(a), kb = pk(b);
    ptOf.set(ka, a); ptOf.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(b);
    adj.get(kb)!.push(a);
  }

  const visited = new Set<string>();
  const chains: Pt[][] = [];

  for (const startKey of adj.keys()) {
    if (visited.has(startKey)) continue;
    const chain: Pt[] = [];
    let cur = startKey, prev = '';
    while (!visited.has(cur)) {
      visited.add(cur);
      chain.push(ptOf.get(cur)!);
      const next = (adj.get(cur) ?? []).find((n) => pk(n) !== prev);
      if (!next) break;
      prev = cur;
      cur = pk(next);
    }
    if (chain.length >= 3) chains.push(chain);
  }
  return chains;
};

// ─── Douglas-Peucker ──────────────────────────────────────────────────────────

const perpDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
};

const dpRec = (pts: Pt[], eps: number): Pt[] => {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, pts[0]!, pts[pts.length - 1]!);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= eps) return [pts[0]!, pts[pts.length - 1]!];
  return [...dpRec(pts.slice(0, maxI + 1), eps).slice(0, -1),
          ...dpRec(pts.slice(maxI), eps)];
};

// Closed-polygon simplification: stitch the loop at a far-enough start edge
const simplifyPoly = (pts: Pt[], eps: number): Pt[] => {
  if (pts.length <= 3) return pts;
  // Find the longest edge as the "break" point to avoid DP artifacts at the stitch
  let maxEdge = 0, breakIdx = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const d = Math.hypot(pts[j]!.x - pts[i]!.x, pts[j]!.y - pts[i]!.y);
    if (d > maxEdge) { maxEdge = d; breakIdx = j; }
  }
  const rotated = [...pts.slice(breakIdx), ...pts.slice(0, breakIdx)];
  const closed = [...rotated, rotated[0]!];
  return dpRec(closed, eps).slice(0, -1);
};

const signedArea = (poly: Pt[]): number => {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const contourScore = (poly: Pt[]): number => {
  const area = Math.abs(signedArea(poly));
  return area > 1e-3 ? area : poly.length;
};

// ─── radial-ring triangulation ────────────────────────────────────────────────

const buildRadialMesh = (
  outline: Pt[],
  center: Pt,
  density: number,
): { points: Pt[]; triangles: Tri[] } => {
  const innerRingCount = Math.max(1, Math.min(3, Math.round(1 + density * 2)));
  const rings: Pt[][] = [];

  for (let ring = 1; ring <= innerRingCount; ring += 1) {
    const t = ring / (innerRingCount + 1);
    rings.push(
      outline.map((p) => ({
        x: center.x + (p.x - center.x) * t,
        y: center.y + (p.y - center.y) * t,
      })),
    );
  }
  rings.push(outline);

  const points = [center, ...rings.flat()];
  const triangles: Tri[] = [];
  const count = outline.length;
  const idx = (ring: number, point: number) => 1 + ring * count + (point % count);

  for (let i = 0; i < count; i += 1) {
    triangles.push([0, idx(0, i), idx(0, i + 1)]);
  }

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let i = 0; i < count; i += 1) {
      const a = idx(ring, i);
      const b = idx(ring, i + 1);
      const c = idx(ring + 1, i);
      const d = idx(ring + 1, i + 1);
      triangles.push([a, b, d]);
      triangles.push([a, d, c]);
    }
  }

  return { points, triangles };
};

// ─── image loading ────────────────────────────────────────────────────────────

const loadAlphaGrid = (
  src: string, maxSize: number,
): Promise<{ alpha: Uint8ClampedArray; w: number; h: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(4, Math.round(img.width * s));
      const h = Math.max(4, Math.round(img.height * s));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const alpha = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3]!;
      resolve({ alpha, w, h });
    };
    img.onerror = () => reject(new Error('Failed to load image for mesh generation'));
    img.src = src;
  });

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Generate a mesh that follows the sprite alpha outline.
 *
 * @param attachment  Source attachment (must have imageData)
 * @param density     0 = coarse (few interior points), 1 = fine
 * @param edgeDetail  0 = smooth outline, 1 = precise outline
 */
export const generateAutoMesh = async (
  attachment: Attachment,
  density = 0.5,
  edgeDetail = 0.4,
): Promise<AttachmentMesh | null> => {
  if (!attachment.imageData) return null;

  const MAX_GRID = 128;
  const ALPHA_THRESH = 32;

  const { alpha, w, h } = await loadAlphaGrid(attachment.imageData, MAX_GRID);

  // 1. Marching squares → contour segments
  const segs = runMS(alpha, w, h, ALPHA_THRESH);
  if (segs.length === 0) return null;

  // 2. Chain segments → closed polygons. Some sprites produce broken
  // marching-squares chains; compare them against a row/column alpha envelope
  // so auto mesh still surrounds the full visible sprite instead of a thin band.
  const chains = chainSegments(segs);
  const tracedOutline = chains.reduce<Pt[]>(
    (best, c) => (contourScore(c) > contourScore(best) ? c : best),
    [],
  );
  const maskArea = alphaArea(alpha, ALPHA_THRESH);
  const envelopeOutline = traceAlphaEnvelope(alpha, w, h, ALPHA_THRESH);
  const tracedScore = contourScore(tracedOutline);
  const envelopeScore = contourScore(envelopeOutline);
  const outline =
    tracedScore >= maskArea * 0.65 && tracedScore >= envelopeScore * 0.75
      ? tracedOutline
      : envelopeOutline;
  if (outline.length < 3) return null;

  // 3. Simplify outline with Douglas-Peucker
  const eps = 1.8 - edgeDetail * 1.55; // [1.8 → 0.25] as edgeDetail [0 → 1]
  const simplified = simplifyPoly(outline, Math.max(0.25, eps));
  if (simplified.length < 3) return null;

  // 4. Build stable rings from the alpha center out to the outline.
  const { points: allPts, triangles } = buildRadialMesh(
    simplified,
    alphaCentroid(alpha, w, h, ALPHA_THRESH),
    density,
  );
  if (triangles.length === 0) return null;

  // 5. Convert grid coords → attachment-local space + UVs
  const { width = 100, height = 100 } = attachment;
  const cropped = attachment.imageIsCropped && attachment.opaqueBounds;
  const localBounds = cropped
    ? attachment.opaqueBounds!
    : { x: 0, y: 0, width, height };
  const vertices: MeshVertex[] = allPts.map((p) => ({
    x: localBounds.x + localBounds.width * (p.x / w) - width / 2,
    y: localBounds.y + localBounds.height * (p.y / h) - height / 2,
    u: p.x / w,
    v: p.y / h,
  }));

  const edges = buildMeshEdges(triangles);

  return { vertices, triangles, edges };
};

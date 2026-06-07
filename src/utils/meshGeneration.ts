import type { Attachment, AttachmentMesh, MeshVertex, MeshTriangle } from '../types';
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

// ─── point-in-polygon (ray casting) ──────────────────────────────────────────

const inPoly = (px: number, py: number, poly: Pt[]): boolean => {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i]!.x, yi = poly[i]!.y;
    const xj = poly[j]!.x, yj = poly[j]!.y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

// ─── interior sampling ────────────────────────────────────────────────────────

const sampleInterior = (poly: Pt[], spacing: number): Pt[] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pts: Pt[] = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      const jx = x + (Math.random() - 0.5) * spacing * 0.4;
      const jy = y + (Math.random() - 0.5) * spacing * 0.4;
      if (inPoly(jx, jy, poly)) pts.push({ x: jx, y: jy });
    }
  }
  return pts;
};

// ─── Bowyer-Watson Delaunay ────────────────────────────────────────────────────

const ccContains = (
  aug: Pt[], ai: number, bi: number, ci: number, px: number, py: number,
): boolean => {
  const { x: ax, y: ay } = aug[ai]!;
  const { x: bx, y: by } = aug[bi]!;
  const { x: cx, y: cy } = aug[ci]!;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return false;
  const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
  const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
  return (px-ux)**2 + (py-uy)**2 < (ax-ux)**2 + (ay-uy)**2;
};

const triangulate = (pts: Pt[]): Tri[] => {
  const n = pts.length;
  if (n < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const d = Math.max(maxX - minX, maxY - minY) * 10 || 1;
  const mcx = (minX + maxX) / 2, mcy = (minY + maxY) / 2;
  const aug: Pt[] = [
    ...pts,
    { x: mcx - d,     y: mcy - d },
    { x: mcx,         y: mcy + d },
    { x: mcx + d,     y: mcy - d },
  ];

  let tris: Tri[] = [[n, n + 1, n + 2]];

  for (let pi = 0; pi < n; pi++) {
    const { x: px, y: py } = pts[pi]!;
    const bad: Tri[] = [], good: Tri[] = [];
    for (const t of tris) {
      (ccContains(aug, t[0], t[1], t[2], px, py) ? bad : good).push(t);
    }

    const boundary: [number, number][] = [];
    for (const t of bad) {
      const te: [number,number][] = [[t[0],t[1]], [t[1],t[2]], [t[2],t[0]]];
      for (const [ea, eb] of te) {
        const shared = bad.some(
          (b) => b !== t && (
            (b[0]===ea&&b[1]===eb)||(b[0]===eb&&b[1]===ea)||
            (b[1]===ea&&b[2]===eb)||(b[1]===eb&&b[2]===ea)||
            (b[2]===ea&&b[0]===eb)||(b[2]===eb&&b[0]===ea)
          ),
        );
        if (!shared) boundary.push([ea, eb]);
      }
    }

    tris = [...good, ...boundary.map(([a, b]) => [a, b, pi] as Tri)];
  }

  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
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

  // 2. Chain segments → closed polygons; keep the largest
  const chains = chainSegments(segs);
  const outline = chains.reduce<Pt[]>((best, c) => c.length > best.length ? c : best, []);
  if (outline.length < 3) return null;

  // 3. Simplify outline with Douglas-Peucker
  const eps = 4.5 - edgeDetail * 4.0; // [4.5 → 0.5] as edgeDetail [0 → 1]
  const simplified = simplifyPoly(outline, Math.max(0.5, eps));
  if (simplified.length < 3) return null;

  // 4. Sample interior grid (density controls spacing)
  const spacingMax = w * 0.22;
  const spacingMin = w * 0.065;
  const spacing = spacingMax - density * (spacingMax - spacingMin);
  const interior = sampleInterior(simplified, spacing);

  // 5. Triangulate boundary + interior
  const allPts = [...simplified, ...interior];
  const tris = triangulate(allPts);

  // 6. Keep only triangles whose centroid is inside the outline
  const finalTris = tris.filter(([a, b, c]) =>
    inPoly(
      (allPts[a]!.x + allPts[b]!.x + allPts[c]!.x) / 3,
      (allPts[a]!.y + allPts[b]!.y + allPts[c]!.y) / 3,
      simplified,
    ),
  );
  if (finalTris.length === 0) return null;

  // 7. Convert grid coords → attachment-local space + UVs
  const { width = 100, height = 100 } = attachment;
  const vertices: MeshVertex[] = allPts.map((p) => ({
    x: width  * (p.x / w - 0.5),
    y: height * (p.y / h - 0.5),
    u: p.x / w,
    v: p.y / h,
  }));

  const triangles = finalTris as MeshTriangle[];
  const edges = buildMeshEdges(triangles);

  return { vertices, triangles, edges };
};

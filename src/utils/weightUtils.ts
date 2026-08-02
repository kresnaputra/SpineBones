import type { Attachment, Bone, MeshVertex, MeshVertexWeight } from '../types';
import { getVertexWorldPos } from '../engine/meshSkinning';

const DEG2RAD = Math.PI / 180;
const MIN_DIST = 1e-4;

const distToSegment = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.max(MIN_DIST, Math.hypot(px - ax - t * dx, py - ay - t * dy));
};

/**
 * Compute auto-weights for each vertex based on inverse-distance squared to each
 * bone segment. Uses the vertex's rigid world position (attached to fallbackBone).
 * Bones with zero length are treated as points.
 */
export const computeAutoWeights = (
  vertices: Array<Pick<MeshVertex, 'x' | 'y'>>,
  attachment: Attachment,
  fallbackBone: Bone,
  allBones: Bone[],
): MeshVertexWeight[][] => {
  const bonesWithLength = allBones.filter((b) => b.length > 0 || b.id === fallbackBone.id);
  if (bonesWithLength.length === 0) return vertices.map(() => []);

  return vertices.map((v) => {
    const [wx, wy] = getVertexWorldPos(v, attachment, fallbackBone);

    const invD2: { boneId: number; w: number }[] = bonesWithLength.map((b) => {
      const r = b._wrot * DEG2RAD;
      const tipX = b._wx + Math.cos(r) * b.length * b.scaleX;
      const tipY = b._wy + Math.sin(r) * b.length * b.scaleY;
      const d = distToSegment(wx, wy, b._wx, b._wy, tipX, tipY);
      return { boneId: b.id, w: 1 / (d * d) };
    });

    const total = invD2.reduce((s, d) => s + d.w, 0);
    const raw = invD2.map((d) => ({ boneId: d.boneId, weight: d.w / total }));

    // Keep only significant influences (≥ 1%) and renormalize
    const sig = raw.filter((w) => w.weight >= 0.01);
    const sigTotal = sig.reduce((s, w) => s + w.weight, 0);
    return sig.map((w) => ({ boneId: w.boneId, weight: w.weight / sigTotal }));
  });
};

/**
 * Paint boneId's weight at a single vertex by delta (positive = add, negative = erase).
 * The remaining weight budget is redistributed proportionally among other bones.
 * Falls back to [{ boneId: fallbackBoneId, weight: 1 }] if current is empty.
 */
export const paintWeightBrush = (
  current: MeshVertexWeight[],
  boneId: number,
  fallbackBoneId: number,
  delta: number,
): MeshVertexWeight[] => {
  const base: MeshVertexWeight[] =
    current.length > 0 ? [...current] : [{ boneId: fallbackBoneId, weight: 1 }];

  const idx = base.findIndex((w) => w.boneId === boneId);
  const existingW = idx >= 0 ? base[idx]!.weight : 0;
  const newW = Math.max(0, Math.min(1, existingW + delta));

  // Build updated list with boneId's new weight
  const updated =
    idx >= 0
      ? base.map((w, i) => (i === idx ? { ...w, weight: newW } : w))
      : [...base, { boneId, weight: newW }];

  const others = updated.filter((w) => w.boneId !== boneId);
  const othersSum = others.reduce((s, w) => s + w.weight, 0);
  const remaining = 1 - newW;

  let result: MeshVertexWeight[];
  if (newW >= 1) {
    result = [{ boneId, weight: 1 }];
  } else if (othersSum > 0) {
    const scale = remaining / othersSum;
    result = [
      { boneId, weight: newW },
      ...others.map((w) => ({ ...w, weight: w.weight * scale })),
    ];
  } else {
    // All other weights are 0: give remaining to fallback
    result = newW > 0
      ? [{ boneId, weight: newW }, { boneId: fallbackBoneId === boneId ? boneId : fallbackBoneId, weight: remaining }]
      : [{ boneId: fallbackBoneId, weight: 1 }];
  }

  return result.filter((w) => w.weight > 0.001);
};

/** Heatmap color for a 0–1 weight: blue (0) → green (0.5) → red (1). */
export const weightToColor = (w: number): string => {
  const r = Math.round(w < 0.5 ? 30 + w * 2 * 140 : 170 + (w - 0.5) * 2 * 85);
  const g = Math.round(w < 0.5 ? 100 + w * 2 * 120 : 220 - (w - 0.5) * 2 * 190);
  const b = Math.round(w < 0.5 ? 255 - w * 2 * 155 : 100 - (w - 0.5) * 2 * 70);
  const a = 0.5 + w * 0.4;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
};

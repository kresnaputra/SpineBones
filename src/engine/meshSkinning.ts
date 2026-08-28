import type { Attachment, Bone, Deformer, DeformerKeyframes, MeshVertex, MeshVertexWeight } from '../types';
import { applyEasing } from '../utils/easing';
import {
  create,
  fromRotationX,
  fromRotationY,
  fromTranslation,
  fromTranslationRotationZ,
  multiply,
  transformPoint,
  type Mat4,
} from './mat4';

/**
 * Pure geometry module shared by the live WebGL preview and the offscreen
 * export renderer. Produces **world-space** vertex positions (the same
 * coordinate system as bone `_wx`/`_wy`), so the GPU only needs a single
 * world→clip matrix. No DOM or GL dependency lives here.
 *
 * All math mirrors the legacy Canvas-2D renderer exactly, with the screen
 * `zoom` factor divided out:
 *   - the Canvas renderer placed attachments at `attachment.x * zoom` screen px
 *     and sized them by `zoom * 0.5`; in world units that is `attachment.x` and
 *     a constant `0.5` sprite scale.
 */

export interface AttachmentGeometry {
  /**
   * Interleaved is avoided: positions are world-space x,y,z triplets. Z is
   * always 0 for now — nothing writes depth until the renderer can sort by it —
   * but the buffer carries it so the vertex format never has to change again.
   */
  positions: Float32Array;
  /** Texture coords, u,v pairs (parallel to positions). */
  uvs: Float32Array;
  /** Triangle indices. */
  indices: Uint16Array;
}

const SPRITE_SCALE = 0.5;

interface AttachmentFrame {
  /** `T(bone._wx, bone._wy) * Rz(bone._wrot + attachment.rotation)`. */
  matrix: Mat4;
  totalScaleX: number;
  totalScaleY: number;
  flipX: number;
  flipY: number;
}

/**
 * Scratch matrices.
 *
 * `boneFrame` runs once per vertex *per bone weight*, so a dense weighted mesh
 * would allocate hundreds of matrices per attachment per frame. Each of the
 * three call sites below owns one buffer instead. They are safe to share within
 * a call site because every one of them is a synchronous leaf: a frame is built
 * and consumed before the next `boneFrame` call, and none of them nest.
 */
const SKIN_FRAME: Mat4 = create();
const QUAD_FRAME: Mat4 = create();
const POINT_FRAME: Mat4 = create();
const CENTRE_FRAME: Mat4 = create();

/**
 * Build the world-space transform for an attachment on a single bone.
 *
 * The rotation is summed in degrees *before* being turned into a matrix, on
 * purpose: composing `Rz(bone._wrot) * Rz(attachment.rotation)` instead would
 * evaluate cos(a+b) as cos(a)cos(b) - sin(a)sin(b) and drift from the value the
 * scalar pipeline produces.
 */
const boneFrame = (
  attachment: Attachment,
  bone: Bone,
  out: Mat4,
  depth = 0,
): AttachmentFrame => {
  const totalScaleX = attachment.scaleX * bone.scaleX;
  const totalScaleY = attachment.scaleY * bone.scaleY;
  const rotZ = bone._wrot + attachment.rotation;
  const rotX = bone.rotationX ?? 0;
  const rotY = bone.rotationY ?? 0;

  let matrix: Mat4;
  if (bone._wm) {
    // The rig uses 3D rotation, so the bone's full world orientation — including
    // everything inherited from its parents — already lives in `_wm`. Only the
    // attachment's own in-plane spin and the layer depth are left to apply.
    matrix = multiply(
      fromTranslation(0, 0, depth),
      multiply(bone._wm, fromTranslationRotationZ(0, 0, attachment.rotation)),
      out,
    );
  } else if (rotX === 0 && rotY === 0) {
    // The 2D path, untouched. `boneFrame` runs once per vertex per bone weight,
    // so a rig that uses no out-of-plane rotation must not pay for three extra
    // matrix builds and three multiplies on every one of them — and taking this
    // branch is also what keeps existing projects bit-identical.
    matrix = fromTranslationRotationZ(bone._wx, bone._wy, rotZ, out);
    matrix[14] = depth;
  } else {
    // A bone tilts but `computeAllWorldTransforms` has not run for this pose yet.
    // Fall back to its own rotation alone — no inheritance, but never stale.
    const spin = multiply(
      multiply(fromRotationY(rotY), fromRotationX(rotX)),
      fromTranslationRotationZ(0, 0, rotZ),
    );
    matrix = multiply(fromTranslation(bone._wx, bone._wy, depth), spin, out);
  }

  return {
    matrix,
    totalScaleX,
    totalScaleY,
    flipX: totalScaleX < 0 ? -1 : 1,
    flipY: totalScaleY < 0 ? -1 : 1,
  };
};

/** Place attachment-local (lx, ly, lz) into world space. */
const toWorld = (
  frame: AttachmentFrame,
  lx: number,
  ly: number,
  lz = 0,
): [number, number, number] => transformPoint(frame.matrix, lx, ly, lz);

/**
 * World-space position of a single mesh vertex, blended across its bone
 * weights. Falls back to the slot's own bone when no usable weights exist.
 */
const skinVertex = (
  vertex: Pick<MeshVertex, 'x' | 'y'>,
  weights: MeshVertexWeight[] | undefined,
  attachment: Attachment,
  bone: Bone,
  allBones: Bone[],
  depth: number,
): [number, number, number] => {
  if (weights && weights.length >= 2 && allBones.length > 0) {
    let wx = 0;
    let wy = 0;
    let wz = 0;
    let total = 0;
    for (const { boneId, weight } of weights) {
      if (weight <= 0) continue;
      const wb = allBones.find((b) => b.id === boneId) ?? bone;
      const frame = boneFrame(attachment, wb, SKIN_FRAME, depth);
      const lx = attachment.x * frame.flipX + vertex.x * frame.totalScaleX * SPRITE_SCALE;
      const ly = attachment.y * frame.flipY + vertex.y * frame.totalScaleY * SPRITE_SCALE;
      const [px, py, pz] = toWorld(frame, lx, ly);
      wx += weight * px;
      wy += weight * py;
      wz += weight * pz;
      total += weight;
    }
    if (total > 0) return [wx / total, wy / total, wz / total];
  }

  const frame = boneFrame(attachment, bone, SKIN_FRAME, depth);
  const lx = attachment.x * frame.flipX + vertex.x * frame.totalScaleX * SPRITE_SCALE;
  const ly = attachment.y * frame.flipY + vertex.y * frame.totalScaleY * SPRITE_SCALE;
  return toWorld(frame, lx, ly);
};

/** World-space position of one vertex rigidly attached to a single bone (no weights). */
export const getVertexWorldPos = (
  vertex: Pick<MeshVertex, 'x' | 'y'>,
  attachment: Attachment,
  bone: Bone,
): [number, number] => {
  const frame = boneFrame(attachment, bone, POINT_FRAME);
  const lx = attachment.x * frame.flipX + vertex.x * frame.totalScaleX * SPRITE_SCALE;
  const ly = attachment.y * frame.flipY + vertex.y * frame.totalScaleY * SPRITE_SCALE;
  const [wx, wy] = toWorld(frame, lx, ly);
  return [wx, wy];
};

/**
 * World-space position of an attachment's pivot, at its layer depth.
 *
 * Used as the sort key for painter's ordering — it does not need to be the exact
 * centroid, only a stable, cheap point that moves with the part. One matrix
 * build per attachment per frame, against one per *vertex* for real geometry.
 */
export const getAttachmentWorldCentre = (
  attachment: Attachment,
  bone: Bone,
  depth: number,
): [number, number, number] => {
  const frame = boneFrame(attachment, bone, CENTRE_FRAME, depth);
  return toWorld(frame, attachment.x, attachment.y);
};

/** Quad geometry for a plain image attachment (matches Canvas drawAttachment). */
const quadGeometry = (attachment: Attachment, bone: Bone, depth: number): AttachmentGeometry => {
  const frame = boneFrame(attachment, bone, QUAD_FRAME, depth);
  const fullW = attachment.width * Math.abs(frame.totalScaleX) * SPRITE_SCALE;
  const fullH = attachment.height * Math.abs(frame.totalScaleY) * SPRITE_SCALE;

  let left: number;
  let top: number;
  let right: number;
  let bottom: number;

  if (attachment.imageIsCropped && attachment.opaqueBounds) {
    // The stored image is already the cropped sub-image; place it in its slot.
    const { x: ox, y: oy, width: cw, height: ch } = attachment.opaqueBounds;
    const sxw = fullW / attachment.width;
    const syw = fullH / attachment.height;
    left = attachment.x - fullW / 2 + ox * sxw;
    top = attachment.y - fullH / 2 + oy * syw;
    right = left + cw * sxw;
    bottom = top + ch * syw;
  } else {
    left = attachment.x - fullW / 2;
    top = attachment.y - fullH / 2;
    right = attachment.x + fullW / 2;
    bottom = attachment.y + fullH / 2;
  }

  // Apply flip about the attachment pivot (attachment.x, attachment.y), matching
  // the Canvas `scale(flipX, flipY)` that wraps the draw.
  const fx = (x: number) => attachment.x + (x - attachment.x) * frame.flipX;
  const fy = (y: number) => attachment.y + (y - attachment.y) * frame.flipY;

  // (lx,ly) are attachment-local offsets (already flipped); rotate+translate
  // around the bone pivot via toWorld, matching the Canvas transform stack.
  const corners: Array<[number, number, number, number]> = [
    [fx(left), fy(top), 0, 0],
    [fx(right), fy(top), 1, 0],
    [fx(right), fy(bottom), 1, 1],
    [fx(left), fy(bottom), 0, 1],
  ];

  const positions = new Float32Array(12);
  const uvs = new Float32Array(8);
  corners.forEach(([lx, ly, u, v], i) => {
    const [px, py, pz] = toWorld(frame, lx, ly);
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  });

  return {
    positions,
    uvs,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
};

/** Full triangle-mesh geometry for a mesh attachment, skinned to bones. */
const meshGeometry = (
  attachment: Attachment,
  bone: Bone,
  allBones: Bone[],
  depth: number,
): AttachmentGeometry => {
  const mesh = attachment.mesh!;
  const verts = mesh.vertices;
  const positions = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);

  for (let i = 0; i < verts.length; i += 1) {
    const v = verts[i]!;
    const weights = attachment.vertexWeights?.[i];
    const [px, py, pz] = skinVertex(v, weights, attachment, bone, allBones, depth);
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    uvs[i * 2] = v.u;
    uvs[i * 2 + 1] = v.v;
  }

  const indices = new Uint16Array(mesh.triangles.length * 3);
  mesh.triangles.forEach(([a, b, c], t) => {
    indices[t * 3] = a;
    indices[t * 3 + 1] = b;
    indices[t * 3 + 2] = c;
  });

  return { positions, uvs, indices };
};

/**
 * Screen-space positions for all mesh vertices (for overlay drawing and hit-testing).
 * `vertices` may be the resolved (deform-applied) vertex list; defaults to rest mesh.
 */
export const getMeshVertexScreenPositions = (
  attachment: Attachment,
  bone: Bone,
  allBones: Bone[],
  worldToScreen: (wx: number, wy: number) => { x: number; y: number },
  vertices?: Array<Pick<MeshVertex, 'x' | 'y'>>,
): Array<{ x: number; y: number }> => {
  const verts = vertices ?? attachment.mesh?.vertices ?? [];
  return verts.map((v, i) => {
    const weights = attachment.vertexWeights?.[i];
    const [wx, wy] = skinVertex(v, weights, attachment, bone, allBones, 0);
    return worldToScreen(wx, wy);
  });
};

/**
 * Resolve deformer control-point positions at a given frame by interpolating
 * between surrounding keyframes. Returns the rest positions if no keyframes
 * exist.
 */
export const resolveDeformerAtFrame = (
  deformer: Deformer,
  frame: number,
  keyframes: DeformerKeyframes,
): { x: number; y: number }[] => {
  const kfs = keyframes[deformer.id];
  if (!kfs) return deformer.rest;
  const frames = Object.keys(kfs).map(Number).sort((a, b) => a - b);
  if (!frames.length) return deformer.rest;
  const before = frames.filter((f) => f <= frame);
  const after = frames.filter((f) => f > frame);
  if (!before.length) {
    const f1 = after[0]!;
    if (f1 === 0) return kfs[f1]!.points;
    const t = applyEasing(kfs[f1]?.easing, frame / f1);
    const p1 = kfs[f1]!.points;
    return deformer.rest.map((p, i) => ({
      x: p.x + ((p1[i]?.x ?? p.x) - p.x) * t,
      y: p.y + ((p1[i]?.y ?? p.y) - p.y) * t,
    }));
  }
  if (!after.length) return kfs[before[before.length - 1]!]!.points;
  const f0 = before[before.length - 1]!;
  const f1 = after[0]!;
  if (f0 === frame) return kfs[f0]!.points;
  const t = applyEasing(kfs[f0]?.easing, (frame - f0) / (f1 - f0));
  const p0 = kfs[f0]!.points;
  const p1 = kfs[f1]!.points;
  return p0.map((p, i) => ({
    x: p.x + ((p1[i]?.x ?? p.x) - p.x) * t,
    y: p.y + ((p1[i]?.y ?? p.y) - p.y) * t,
  }));
};

/**
 * Apply a warp deformer to the attachment's mesh vertices before bone skinning.
 * Uses bilinear interpolation within the deformer grid.
 * Vertices that fall outside the deformer bounds are left unchanged.
 */
export const applyWarpToAttachment = (
  attachment: Attachment,
  deformer: Deformer,
  currentPts: { x: number; y: number }[],
): Attachment => {
  if (!attachment.mesh?.vertices.length) return attachment;
  const { cols, rows } = deformer.grid;
  const { minX, minY, maxX, maxY } = deformer.bounds;
  if (maxX === minX || maxY === minY) return attachment;
  const cellW = (maxX - minX) / cols;
  const cellH = (maxY - minY) / rows;

  const warpedVerts = attachment.mesh.vertices.map((v) => {
    const gx = (v.x - minX) / cellW;
    const gy = (v.y - minY) / cellH;
    if (gx < 0 || gx > cols || gy < 0 || gy > rows) return v;
    const cx = Math.min(Math.floor(gx), cols - 1);
    const cy = Math.min(Math.floor(gy), rows - 1);
    const fx = gx - cx;
    const fy = gy - cy;
    const i00 = cy * (cols + 1) + cx;
    const i10 = cy * (cols + 1) + cx + 1;
    const i01 = (cy + 1) * (cols + 1) + cx;
    const i11 = (cy + 1) * (cols + 1) + cx + 1;
    return {
      ...v,
      x:
        currentPts[i00]!.x * (1 - fx) * (1 - fy) +
        currentPts[i10]!.x * fx * (1 - fy) +
        currentPts[i01]!.x * (1 - fx) * fy +
        currentPts[i11]!.x * fx * fy,
      y:
        currentPts[i00]!.y * (1 - fx) * (1 - fy) +
        currentPts[i10]!.y * fx * (1 - fy) +
        currentPts[i01]!.y * (1 - fx) * fy +
        currentPts[i11]!.y * fx * fy,
    };
  });

  return { ...attachment, mesh: { ...attachment.mesh, vertices: warpedVerts } };
};

/**
 * World-space geometry for an attachment. Plain images become a quad; meshes
 * are skinned per-vertex. `attachment.mesh.vertices` are expected to already be
 * resolved for the current frame (deform keyframes applied by the caller).
 */
export const getAttachmentGeometry = (
  attachment: Attachment,
  bone: Bone,
  allBones: Bone[],
  /** World-space Z for every vertex — the attachment's layer. See `drawOrder`. */
  depth = 0,
): AttachmentGeometry => {
  if (attachment.type === 'mesh' && attachment.mesh?.vertices.length && attachment.mesh.triangles.length) {
    return meshGeometry(attachment, bone, allBones, depth);
  }
  return quadGeometry(attachment, bone, depth);
};

import type { Bone, Point } from '../types';
import {
  create,
  fromRotationX,
  fromRotationY,
  fromTranslation,
  fromTranslationRotationZ,
  multiply,
  type Mat4,
} from './mat4';

/**
 * Bone world transforms.
 *
 * ## The world frame is rigid, and scale is not part of it
 *
 * A bone's world transform is a translation plus a rotation. Scale never enters
 * it: a parent's scale is applied to its child's *local offset* only — one level
 * down, never accumulated along the chain — and a bone's own scale is read
 * directly by `meshSkinning.boneFrame` when it places an attachment.
 *
 * ## Why the maths stays scalar
 *
 * It is tempting to carry a 4x4 frame per bone and compose it as `parentFrame *
 * localFrame`. That changes the numbers: matrix composition evaluates cos(a+b)
 * as cos(a)cos(b) - sin(a)sin(b), which is not bit-identical to
 * `Math.cos(a+b)`, and the error compounds per level (measured at 8.5e-14 over
 * a 7-bone chain by `scripts/phase-a/verify-transform-parity.ts`).
 *
 * A stored frame would also have to survive `JSON.parse(JSON.stringify(...))`,
 * which every undo snapshot and every saved `.sbn` puts bones through — a typed
 * array does not. So `_wx/_wy/_wrot` stay the storage, and `meshSkinning` builds
 * the matrix it needs from them, per attachment, at the point of use.
 *
 * `_wrot` in particular is an accumulated, unnormalised degree sum that
 * legitimately runs past +/-360; `getBoneTip` and the IK solver depend on that.
 * It must never be recovered from a matrix via atan2.
 */

/** A bone with no resolvable parent: its world transform is its local one. */
const setRootTransform = (bone: Bone): void => {
  bone._wx = bone.x;
  bone._wy = bone.y;
  bone._wrot = bone.rotation;
};

/**
 * Place `bone` in its parent's frame. The parent's scale scales the child's
 * offset; the parent's world rotation rotates it.
 */
const setChildTransform = (bone: Bone, parent: Bone): void => {
  const rad = (parent._wrot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = bone.x * parent.scaleX;
  const localY = bone.y * parent.scaleY;

  bone._wx = parent._wx + localX * cos - localY * sin;
  bone._wy = parent._wy + localX * sin + localY * cos;
  bone._wrot = parent._wrot + bone.rotation;
};

const RESOLVING = 0;
const RESOLVED = 1;

/** True once any bone tilts out of the screen plane. */
const usesOutOfPlaneRotation = (bones: Bone[]): boolean =>
  bones.some((b) => (b.rotationX ?? 0) !== 0 || (b.rotationY ?? 0) !== 0);

const SCRATCH_LOCAL: Mat4 = create();
const SCRATCH_SPIN: Mat4 = create();

const writeMatrix = (bone: Bone, m: Mat4): void => {
  const out = bone._wm ?? (bone._wm = new Array<number>(16));
  for (let i = 0; i < 16; i += 1) out[i] = m[i]!;
};

/**
 * World frame for a bone in a rig that uses 3D rotation.
 *
 * Unlike the scalar path this genuinely composes matrices, because three
 * rotation axes cannot be accumulated as sums — `R(a) * R(b)` is not `R(a + b)`
 * once the axes differ. That costs bit-parity with the 2D formula, which is why
 * a rig that uses no out-of-plane rotation never comes down this path.
 *
 * `_wx/_wy` are still written, from the matrix translation, because 22 call
 * sites read them. `_wrot` keeps accumulating the Z component alone: it is the
 * best single scalar available, and `getBoneTip`, hit-testing and the Canvas-2D
 * exporters all still depend on it.
 */
const setFrame3D = (bone: Bone, parent: Bone | null): void => {
  const local = multiply(
    multiply(
      fromRotationY(bone.rotationY ?? 0, SCRATCH_SPIN),
      fromRotationX(bone.rotationX ?? 0),
    ),
    fromTranslationRotationZ(0, 0, bone.rotation),
    SCRATCH_LOCAL,
  );

  const offset = parent
    ? fromTranslation(bone.x * parent.scaleX, bone.y * parent.scaleY, 0)
    : fromTranslation(bone.x, bone.y, 0);

  const world = parent?._wm
    ? multiply(parent._wm, multiply(offset, local))
    : multiply(offset, local);

  writeMatrix(bone, world);
  bone._wx = world[12]!;
  bone._wy = world[13]!;
  bone._wrot = (parent ? parent._wrot : 0) + bone.rotation;
};

/**
 * Compute `_wx/_wy/_wrot` for every bone, in place.
 *
 * Resolves each bone after its parent regardless of array order. The previous
 * implementation ran five fixed passes over the array, which propagated exactly
 * one level per pass when children preceded parents — so a chain deeper than
 * five levels in an unfavourable order silently produced wrong world positions
 * for its deepest bones.
 *
 * Bones whose parent is missing from `bones` are treated as roots. This is
 * reachable: `skeletonStore.deleteBone` removes a bone and its direct children
 * but leaves grandchildren pointing at a parent that no longer exists. Such a
 * bone previously kept whatever world values it happened to hold and never
 * updated again.
 *
 * Parent cycles terminate: the bone at which the cycle is detected is treated as
 * a root. The editor's re-parent path rejects cycles up front, so this is a
 * safety net against a hang rather than a supported configuration.
 */
export const computeAllWorldTransforms = (bones: Bone[]): void => {
  const use3D = usesOutOfPlaneRotation(bones);
  if (!use3D) {
    // Drop any frames left over from a rig that used to tilt, so `meshSkinning`
    // goes back to its 2D fast path instead of reading a stale matrix.
    for (const bone of bones) if (bone._wm) delete bone._wm;
  }

  const byId = new Map<number, Bone>();
  for (const bone of bones) byId.set(bone.id, bone);

  const state = new Map<number, number>();

  const resolve = (bone: Bone): void => {
    const seen = state.get(bone.id);
    if (seen === RESOLVED) return;
    if (seen === RESOLVING) {
      // Cycle: break it here so the walk terminates.
      setRootTransform(bone);
      state.set(bone.id, RESOLVED);
      return;
    }

    state.set(bone.id, RESOLVING);

    // `=== null` matters: bone ids start at 0, so the first bone ever created is
    // a perfectly valid parent whose id is falsy.
    const parent = bone.parentId === null ? undefined : byId.get(bone.parentId);
    if (parent) resolve(parent);

    if (use3D) {
      setFrame3D(bone, parent ?? null);
    } else if (parent) {
      setChildTransform(bone, parent);
    } else {
      setRootTransform(bone);
    }

    state.set(bone.id, RESOLVED);
  };

  for (const bone of bones) resolve(bone);
};

export const getBoneTip = (bone: Bone): Point => {
  const r = (bone._wrot * Math.PI) / 180;
  return {
    x: bone._wx + Math.cos(r) * bone.length * bone.scaleX,
    y: bone._wy + Math.sin(r) * bone.length * bone.scaleY,
  };
};

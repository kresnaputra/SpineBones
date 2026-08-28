import type { Bone, Point } from '../types';
import { computeAllWorldTransforms, getBoneTip } from '../engine/transforms';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export type IkChain = {
  root: Bone;
  child: Bone;
  end: Bone | null;
  joint: Point;
  target: Point;
};

export const getSingleChildBone = (rootId: number, bones: Bone[]) => {
  const children = bones.filter((bone) => bone.parentId === rootId);
  return children.length === 1 ? children[0] : null;
};

export const getIkRootForBone = (boneId: number, bones: Bone[]) => {
  const bone = bones.find((item) => item.id === boneId);
  if (!bone) return null;

  const parent = bone.parentId !== null
    ? bones.find((item) => item.id === bone.parentId) ?? null
    : null;
  const directChild = getSingleChildBone(bone.id, bones);
  const parentOwnsBone = parent ? getSingleChildBone(parent.id, bones)?.id === bone.id : false;
  const grandParentId = parentOwnsBone ? parent?.parentId ?? null : null;
  const grandParent = grandParentId !== null
    ? bones.find((item) => item.id === grandParentId) ?? null
    : null;
  const grandParentOwnsParent =
    grandParent && parent ? getSingleChildBone(grandParent.id, bones)?.id === parent.id : false;

  if (grandParentOwnsParent) {
    return grandParent;
  }

  if (parentOwnsBone) {
    return parent;
  }

  return directChild ? bone : null;
};

export const getIkChain = (rootId: number, bones: Bone[]): IkChain | null => {
  const root = bones.find((bone) => bone.id === rootId);
  if (!root) return null;

  const child = getSingleChildBone(rootId, bones);
  if (!child) return null;
  const end = getSingleChildBone(child.id, bones);

  computeAllWorldTransforms(bones);

  return {
    root,
    child,
    end,
    joint: { x: child._wx, y: child._wy },
    target: end ? { x: end._wx, y: end._wy } : getBoneTip(child),
  };
};

/**
 * Whether an IK chain is tilted out of the screen plane.
 *
 * The solver below works in world XY with unforeshortened bone lengths. A tilted
 * chain is foreshortened in that plane — a bone of length 80 tilted 40 degrees
 * spans only 61 — so the solver aims for a reach it does not have and the tip
 * falls short. Measured: 18.6 units off at 40 degrees, 45.9 at 65.
 *
 * Solving this properly means working in the chain's own plane rather than the
 * screen's: intersect the cursor ray with the plane spanned by the root bone's
 * local axes, map the hit into that frame, and solve there. Until that exists,
 * refusing is the honest answer — a silently wrong limb is worse than one that
 * does not move.
 */
export const isIkChainTilted = (rootId: number, bones: Bone[]): boolean => {
  const chain = getIkChain(rootId, bones);
  if (!chain) return false;

  // A threshold, not an exact comparison. Dragging a gizmo ring back to "flat"
  // by eye leaves something like 0.0003 degrees behind, and an exact test would
  // then keep IK switched off forever with no way to tell why. Half a degree
  // foreshortens an 80-unit bone by 0.003 units — far below anything visible.
  const TILT_EPSILON_DEGREES = 0.5;
  const tilted = (bone: Bone | null | undefined): boolean =>
    !!bone &&
    (Math.abs(bone.rotationX ?? 0) > TILT_EPSILON_DEGREES ||
      Math.abs(bone.rotationY ?? 0) > TILT_EPSILON_DEGREES);

  // Ancestors count too: inherited tilt foreshortens the chain just the same.
  let ancestor: Bone | null | undefined = chain.root;
  const seen = new Set<number>();
  while (ancestor && !seen.has(ancestor.id)) {
    seen.add(ancestor.id);
    if (tilted(ancestor)) return true;
    ancestor = ancestor.parentId === null ? null : bones.find((b) => b.id === ancestor!.parentId);
  }

  return tilted(chain.child) || tilted(chain.end);
};

export const solveTwoBoneIk = (
  rootId: number,
  target: Point,
  bones: Bone[],
): { rootRotation: number; childRotation: number; childX?: number; childY?: number } | null => {
  const chain = getIkChain(rootId, bones);
  if (!chain) return null;

  // See `isIkChainTilted`: the maths below cannot represent a chain that leaves
  // the screen plane, so refuse rather than return a plausible wrong answer.
  if (isIkChainTilted(rootId, bones)) return null;

  const { root, child, end, target: currentTarget } = chain;
  const parent = root.parentId !== null
    ? bones.find((bone) => bone.id === root.parentId) ?? null
    : null;

  const rootWorldX = root._wx;
  const rootWorldY = root._wy;
  const parentWorldRotation = parent?._wrot ?? 0;

  let childX = child.x;
  let childY = child.y;
  let jointLocalX = child.x * root.scaleX;
  let jointLocalY = child.y * root.scaleY;
  let len1 = Math.hypot(jointLocalX, jointLocalY);
  let targetLocalX = end ? end.x * child.scaleX : child.length * child.scaleX;
  let targetLocalY = end ? end.y * child.scaleY : 0;
  let len2 = Math.hypot(targetLocalX, targetLocalY);

  if (len1 < 1e-4) {
    childX = root.length;
    childY = 0;
    jointLocalX = childX * root.scaleX;
    jointLocalY = 0;
    len1 = Math.hypot(jointLocalX, jointLocalY);
  }

  if (len2 < 1e-4) {
    targetLocalX = child.length * child.scaleX;
    targetLocalY = 0;
    len2 = Math.hypot(targetLocalX, targetLocalY);
  }

  if (len1 < 1e-4 || len2 < 1e-4) return null;

  const distanceToTarget = Math.hypot(target.x - rootWorldX, target.y - rootWorldY);
  const clampedDistance = clamp(distanceToTarget, 1e-4, len1 + len2 - 1e-4);
  const baseAngle = Math.atan2(target.y - rootWorldY, target.x - rootWorldX);
  const jointOffsetAngle = Math.atan2(jointLocalY, jointLocalX);
  const targetOffsetAngle = Math.atan2(targetLocalY, targetLocalX);
  const currentCross =
    (child._wx - root._wx) * (currentTarget.y - child._wy) -
    (child._wy - root._wy) * (currentTarget.x - child._wx);
  const targetCross =
    (child._wx - root._wx) * (target.y - root._wy) -
    (child._wy - root._wy) * (target.x - root._wx);
  const bendDirection =
    Math.abs(targetCross) > 1e-4 ? (targetCross >= 0 ? 1 : -1) : currentCross >= 0 ? 1 : -1;

  const rootOffset = Math.acos(
    clamp(
      (len1 * len1 + clampedDistance * clampedDistance - len2 * len2) /
        (2 * len1 * clampedDistance),
      -1,
      1,
    ),
  );
  const elbowAngle = Math.acos(
    clamp(
      (len1 * len1 + len2 * len2 - clampedDistance * clampedDistance) /
        (2 * len1 * len2),
      -1,
      1,
    ),
  );

  const firstSegmentAngle = baseAngle - bendDirection * rootOffset;
  const secondSegmentAngle = firstSegmentAngle + bendDirection * (Math.PI - elbowAngle);
  const rootWorldRotation = firstSegmentAngle - jointOffsetAngle;
  const childWorldRotation = secondSegmentAngle - targetOffsetAngle;

  return {
    rootRotation: (rootWorldRotation * 180) / Math.PI - parentWorldRotation,
    childRotation: (childWorldRotation * 180) / Math.PI - (rootWorldRotation * 180) / Math.PI,
    childX: childX !== child.x ? childX : undefined,
    childY: childY !== child.y ? childY : undefined,
  };
};

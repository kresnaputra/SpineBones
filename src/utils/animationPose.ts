import type { Bone, KeyframeData, Keyframes, SetupPose } from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';
import { applyEasing, normalizeKeyframeData } from './easing';

export const getAdjacentKeyframes = (
  keyframes: Keyframes,
  frame: number,
): { previous: number | null; next: number | null } => {
  const allFrames = Array.from(
    new Set(
      Object.values(keyframes).flatMap((boneKeyframes) =>
        Object.keys(boneKeyframes).map(Number),
      ),
    ),
  ).sort((a, b) => a - b);

  let previous: number | null = null;
  let next: number | null = null;

  for (const keyframeFrame of allFrames) {
    if (keyframeFrame < frame) {
      previous = keyframeFrame;
      continue;
    }

    if (keyframeFrame > frame) {
      next = keyframeFrame;
      break;
    }
  }

  return { previous, next };
};

/**
 * The pose a bone falls back to when it has no keyframes.
 *
 * `SetupPose` predates 3D rotation and does not carry it, so the tilt always
 * comes from the bone itself. That means a bone with no keyframes keeps whatever
 * tilt it was given, rather than being reset to flat.
 */
const getBasePose = (bone: Bone, setupPose: SetupPose): KeyframeData => {
  const defaults = {
    rotationX: bone.rotationX ?? 0,
    rotationY: bone.rotationY ?? 0,
    order: setupPose[bone.id]?.order ?? bone.order,
  };
  const pose = setupPose[bone.id];
  return pose
    ? { ...pose, ...defaults }
    : {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY,
        ...defaults,
      };
};

/**
 * Fill in tilt on a keyframe written before the fields existed.
 *
 * Absent means 0, deliberately: once a bone is keyframed, the keyframes define
 * its pose completely — exactly as they already do for x, y and rotation.
 */
const withDefaults = (k: KeyframeData, fallbackOrder: number): KeyframeData => ({
  ...k,
  rotationX: k.rotationX ?? 0,
  rotationY: k.rotationY ?? 0,
  order: k.order ?? fallbackOrder,
});

export const sampleBonePoseAtFrame = (
  bone: Bone,
  keyframes: Keyframes,
  setupPose: SetupPose,
  frame: number,
  inBetweenEnabled = true,
): KeyframeData => {
  const boneKeyframes = keyframes[bone.id];
  if (!boneKeyframes) {
    return getBasePose(bone, setupPose);
  }

  const frames = Object.keys(boneKeyframes)
    .map(Number)
    .sort((a, b) => a - b);

  if (frames.length === 0) {
    return getBasePose(bone, setupPose);
  }

  let prev: number | null = null;
  let next: number | null = null;

  for (const keyframeFrame of frames) {
    if (keyframeFrame <= frame) prev = keyframeFrame;
    if (keyframeFrame >= frame && next === null) next = keyframeFrame;
  }

  if (prev === null && next !== null) {
    return withDefaults(normalizeKeyframeData(boneKeyframes[next]), bone.order);
  }

  if (prev !== null && next === null) {
    return withDefaults(normalizeKeyframeData(boneKeyframes[prev]), bone.order);
  }

  if (prev === null || next === null) {
    return getBasePose(bone, setupPose);
  }

  if (prev === next) {
    return withDefaults(normalizeKeyframeData(boneKeyframes[prev]), bone.order);
  }

  const kp = normalizeKeyframeData(boneKeyframes[prev]);
  const kn = normalizeKeyframeData(boneKeyframes[next]);
  const t = inBetweenEnabled
    ? applyEasing(kp.easing, (frame - prev) / (next - prev))
    : 0;
  const lerp = (a: number, b: number) => a + (b - a) * t;

  return {
    x: lerp(kp.x, kn.x),
    y: lerp(kp.y, kn.y),
    rotation: lerp(kp.rotation, kn.rotation),
    rotationX: lerp(kp.rotationX ?? 0, kn.rotationX ?? 0),
    rotationY: lerp(kp.rotationY ?? 0, kn.rotationY ?? 0),
    scaleX: lerp(kp.scaleX, kn.scaleX),
    scaleY: lerp(kp.scaleY, kn.scaleY),
    order: kp.order ?? setupPose[bone.id]?.order ?? bone.order,
    easing: kp.easing,
  };
};

export const sampleBonesAtFrame = (
  bones: Bone[],
  keyframes: Keyframes,
  setupPose: SetupPose,
  frame: number,
  inBetweenEnabled = true,
): Bone[] => {
  const sampledBones = bones.map((bone) => {
    const pose = sampleBonePoseAtFrame(bone, keyframes, setupPose, frame, inBetweenEnabled);
    return {
      ...bone,
      ...pose,
      _wx: bone._wx,
      _wy: bone._wy,
      _wrot: bone._wrot,
    };
  });

  computeAllWorldTransforms(sampledBones);
  return sampledBones;
};

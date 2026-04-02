import type { Bone, KeyframeData, Keyframes, SetupPose } from '../types';
import { computeAllWorldTransforms } from '../engine/transforms';

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

const getBasePose = (bone: Bone, setupPose: SetupPose): KeyframeData =>
  setupPose[bone.id] ?? {
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
  };

export const sampleBonePoseAtFrame = (
  bone: Bone,
  keyframes: Keyframes,
  setupPose: SetupPose,
  frame: number,
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
    return boneKeyframes[next];
  }

  if (prev !== null && next === null) {
    return boneKeyframes[prev];
  }

  if (prev === null || next === null) {
    return getBasePose(bone, setupPose);
  }

  if (prev === next) {
    return boneKeyframes[prev];
  }

  const kp = boneKeyframes[prev];
  const kn = boneKeyframes[next];
  const t = (frame - prev) / (next - prev);
  const lerp = (a: number, b: number) => a + (b - a) * t;

  return {
    x: lerp(kp.x, kn.x),
    y: lerp(kp.y, kn.y),
    rotation: lerp(kp.rotation, kn.rotation),
    scaleX: lerp(kp.scaleX, kn.scaleX),
    scaleY: lerp(kp.scaleY, kn.scaleY),
  };
};

export const sampleBonesAtFrame = (
  bones: Bone[],
  keyframes: Keyframes,
  setupPose: SetupPose,
  frame: number,
): Bone[] => {
  const sampledBones = bones.map((bone) => {
    const pose = sampleBonePoseAtFrame(bone, keyframes, setupPose, frame);
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

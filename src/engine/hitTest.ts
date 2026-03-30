import type { Bone, Point } from '../types';
import { distance, distanceToSegment } from './math';
import { computeAllWorldTransforms, getBoneTip } from './transforms';

export const hitTestBone = (
  screenPoint: Point,
  bones: Bone[],
  worldToScreen: (wx: number, wy: number) => Point
): Bone | null => {
  computeAllWorldTransforms(bones);

  for (let i = bones.length - 1; i >= 0; i--) {
    const bone = bones[i];
    const screenStart = worldToScreen(bone._wx, bone._wy);
    const tip = getBoneTip(bone);
    const screenEnd = worldToScreen(tip.x, tip.y);

    const headDist = distance(screenPoint, screenStart);
    if (headDist < 10) return bone;

    const segDist = distanceToSegment(screenPoint, screenStart, screenEnd);
    if (segDist < 10) return bone;
  }

  return null;
};

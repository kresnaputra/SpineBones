import type { RagAnimationData, RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { SemanticBoneMap } from './boneMapper';

export interface FlatKeyframeEntry {
  boneName: string;
  frame: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  easing: RagKeyframeEasing;
}

// Flatten nested bone tracks into per-frame entries, remapping bone names via semanticBoneMap.
// Tracks whose source bone has no entry in semanticBoneMap are skipped.
export const flattenDatasetKeyframes = (
  animData: RagAnimationData,
  semanticBoneMap: SemanticBoneMap,
): FlatKeyframeEntry[] => {
  const entries: FlatKeyframeEntry[] = [];
  for (const track of animData.keyframes) {
    const targetBoneName = semanticBoneMap[track.boneName];
    if (!targetBoneName) continue;
    for (const kf of track.frames) {
      entries.push({
        boneName: targetBoneName,
        frame: kf.frame,
        x: kf.x,
        y: kf.y,
        rotation: kf.rotation,
        scaleX: kf.scaleX,
        scaleY: kf.scaleY,
        easing: kf.easing,
      });
    }
  }
  return entries;
};

export const adaptDatasetAnimationToTargetRig = (
  item: RagAnimationDatasetItem,
  semanticBoneMap: SemanticBoneMap,
) => ({
  itemId: item.id,
  semanticBoneMap,
  animation: item.animation,
});

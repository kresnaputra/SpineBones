import type { RagAnimationData, RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { BoneBindingMap } from './boneMapper';

export interface FlatKeyframeEntry {
  sourceBoneId?: number;
  targetBoneId?: number;
  boneName: string;
  frame: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  easing: RagKeyframeEasing;
}

// Flatten nested bone tracks into per-frame entries. Each track is looked up by its own source
// bone id, so a rig that reuses a bone name still drives two separate destinations. Tracks with
// no binding onto the active rig are skipped.
export const flattenDatasetKeyframes = (
  animData: RagAnimationData,
  bindings: BoneBindingMap,
): FlatKeyframeEntry[] => {
  const entries: FlatKeyframeEntry[] = [];
  for (const track of animData.keyframes) {
    const binding = bindings.get(track.boneId);
    if (!binding) continue;
    for (const kf of track.frames) {
      entries.push({
        sourceBoneId: track.boneId,
        targetBoneId: binding.targetBoneId,
        boneName: binding.targetBoneName,
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

// Destinations are decided when bindings are built, so resolution here is an id lookup. The name
// fallback only covers entries produced outside the binding path.
export const resolveKeyframeTarget = <T extends { id: number; name: string }>(
  entry: FlatKeyframeEntry,
  bones: T[],
): T | undefined => {
  if (entry.targetBoneId !== undefined) return bones.find((bone) => bone.id === entry.targetBoneId);
  const matches = bones.filter((bone) => bone.name.toLowerCase() === entry.boneName.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
};

export const adaptDatasetAnimationToTargetRig = (
  item: RagAnimationDatasetItem,
  bindings: BoneBindingMap,
) => ({
  itemId: item.id,
  bindings,
  animation: item.animation,
});

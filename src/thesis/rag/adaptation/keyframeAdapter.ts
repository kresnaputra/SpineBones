import type { RagAnimationData, RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { SemanticBoneMap } from './boneMapper';

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
        sourceBoneId: track.boneId,
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

type RigBone = { id: number; name: string; parentId: number | null };

// Source IDs are local to a rig. Only reuse them when the complete source
// hierarchy matches; otherwise require a unique mapped name on the target rig.
export const bindKeyframeTargets = (
  entries: FlatKeyframeEntry[],
  source: RagAnimationData,
  bones: RigBone[],
): FlatKeyframeEntry[] => {
  const sameRig = Array.isArray(source.bones) && source.bones.length === bones.length &&
    new Set(source.bones.map((bone) => bone.id)).size === source.bones.length &&
    source.bones.every((bone) => bones.some((target) =>
      target.id === bone.id && target.name === bone.name && target.parentId === bone.parentId));
  return entries.map((entry) => {
    const matches = bones.filter((bone) => bone.name.toLowerCase() === entry.boneName.toLowerCase());
    const target = sameRig && entry.sourceBoneId !== undefined
      ? matches.find((bone) => bone.id === entry.sourceBoneId)
      : matches.length === 1 ? matches[0] : undefined;
    return { ...entry, targetBoneId: target?.id };
  });
};

export const resolveKeyframeTarget = <T extends { id: number; name: string }>(entry: FlatKeyframeEntry, bones: T[]): T | undefined => {
  const matches = bones.filter((bone) => bone.name.toLowerCase() === entry.boneName.toLowerCase());
  if (entry.targetBoneId !== undefined) return matches.find((bone) => bone.id === entry.targetBoneId);
  return matches.length === 1 ? matches[0] : undefined;
};

export const adaptDatasetAnimationToTargetRig = (
  item: RagAnimationDatasetItem,
  semanticBoneMap: SemanticBoneMap,
) => ({
  itemId: item.id,
  semanticBoneMap,
  animation: item.animation,
});

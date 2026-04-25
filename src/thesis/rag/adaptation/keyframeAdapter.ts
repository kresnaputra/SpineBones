import type { RagAnimationDatasetItem } from '../types/ragTypes';
import type { SemanticBoneMap } from './boneMapper';

export const adaptDatasetAnimationToTargetRig = (
  item: RagAnimationDatasetItem,
  semanticBoneMap: SemanticBoneMap,
) => ({
  itemId: item.id,
  semanticBoneMap,
  animation: item.animation,
});

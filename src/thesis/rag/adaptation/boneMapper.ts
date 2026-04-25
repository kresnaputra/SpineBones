export type SemanticBoneMap = Record<string, string>;

export const buildSemanticBoneMap = (
  datasetBoneMapping: Record<string, string>,
  targetSemanticMapping: Record<string, string>,
): SemanticBoneMap => {
  const next: SemanticBoneMap = {};

  for (const [semanticBone, sourceBoneName] of Object.entries(datasetBoneMapping)) {
    const targetBoneName = targetSemanticMapping[semanticBone];
    if (!targetBoneName) continue;
    next[sourceBoneName] = targetBoneName;
  }

  return next;
};

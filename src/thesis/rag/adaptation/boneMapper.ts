import type { RagAnimationDatasetItem } from '../types/ragTypes';

// Bone binding: which bone on the active rig each source track drives.
//
// The previous mapping was keyed by source bone *name*, which silently lost tracks whenever a rig
// reused a name. The rhino rig points two semantics at one name —
//
//   "rightArm":  "right_arm",
//   "rightHand": "right_arm",
//
// — so the second entry overwrote the first and both arm tracks ended up aimed at one bone. The
// only thing that had been keeping this working was an exact whole-rig identity check that reused
// source bone ids, which switched off the moment a single bone was renamed.
//
// Bindings are keyed by source bone id instead, so two tracks sharing a name stay distinct from
// the dataset all the way to the timeline, and resolution no longer depends on the rigs matching
// bone-for-bone.

export interface RigBoneRef {
  id: number;
  name: string;
  parentId: number | null;
}

export interface BoneBinding {
  sourceBoneId: number;
  sourceBoneName: string;
  semantic: string | null;
  targetBoneId: number;
  targetBoneName: string;
}

export type BoneBindingMap = Map<number, BoneBinding>;

// Bone names are compared without case or separators, so a semantic label and a rig's own naming
// convention can meet in the middle: `rightHand` and `right_hand` both reduce to `righthand`.
const normalizeName = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, '');

// Give each source track its semantic role.
//
// boneMapping is semantic → source bone name, and several semantics may name the same bone. Roles
// are handed out in boneMapping order to name-matching tracks in track order, each track claimed
// at most once, so `rightArm` and `rightHand` land on the two distinct tracks rather than both
// resolving to whichever one matches first.
export const assignSourceSemantics = (item: RagAnimationDatasetItem): Map<number, string> => {
  const assigned = new Map<number, string>();
  const claimed = new Set<number>();

  for (const [semantic, sourceBoneName] of Object.entries(item.boneMapping)) {
    const track = item.animation.keyframes.find(
      (candidate) =>
        !claimed.has(candidate.boneId) && normalizeName(candidate.boneName) === normalizeName(sourceBoneName),
    );
    if (!track) continue;
    claimed.add(track.boneId);
    assigned.set(track.boneId, semantic);
  }

  return assigned;
};

type Matcher = (track: { boneId: number; boneName: string }, semantic: string | null, bone: RigBoneRef) => boolean;

// Resolution runs in priority passes rather than per-track first-come-first-served, so a track
// falling back to a plain name match cannot claim a bone that a later track would have matched by
// its semantic role.
const RESOLUTION_PASSES: Matcher[] = [
  // The rig names this bone by the role it plays. This is what makes renaming a rig bone to
  // `right_hand` actually do something — the old mapper only ever searched for the dataset's own
  // bone name and never looked at the semantic label at all.
  (_track, semantic, bone) => semantic !== null && normalizeName(bone.name) === normalizeName(semantic),
  // Same slot in a rig that still carries the source's naming. Narrower than the old whole-rig
  // identity check: one bone agreeing on id and name is enough, and an unrelated bone elsewhere in
  // the hierarchy no longer disables it.
  (track, _semantic, bone) => bone.id === track.boneId && normalizeName(bone.name) === normalizeName(track.boneName),
  // Plain name match, for rigs that share the dataset's naming but not its numbering.
  (track, _semantic, bone) => normalizeName(bone.name) === normalizeName(track.boneName),
];

export const buildBoneBindings = (
  item: RagAnimationDatasetItem,
  targetBones: RigBoneRef[],
): BoneBindingMap => {
  const semantics = assignSourceSemantics(item);
  const bindings: BoneBindingMap = new Map();
  const claimedTargets = new Set<number>();

  for (const matches of RESOLUTION_PASSES) {
    for (const track of item.animation.keyframes) {
      if (bindings.has(track.boneId)) continue;

      const semantic = semantics.get(track.boneId) ?? null;
      const candidates = targetBones.filter((bone) => !claimedTargets.has(bone.id) && matches(track, semantic, bone));
      if (candidates.length === 0) continue;

      // Prefer the bone sharing the source's id, then lowest id — the rig's array order is
      // presentation state and must not decide which of two equally-named bones wins.
      const target =
        candidates.find((bone) => bone.id === track.boneId) ?? [...candidates].sort((a, b) => a.id - b.id)[0]!;

      claimedTargets.add(target.id);
      bindings.set(track.boneId, {
        sourceBoneId: track.boneId,
        sourceBoneName: track.boneName,
        semantic,
        targetBoneId: target.id,
        targetBoneName: target.name,
      });
    }
  }

  // Final pass: place what is left by hierarchy. A track whose parent is already bound belongs
  // under that parent's target bone, so if exactly one unclaimed child sits there it is the only
  // consistent destination. This recovers the second of two same-named bones on datasets whose
  // boneMapping never named the role — a source `right_arm` parented to another `right_arm` lands
  // on the rig's `right_hand` because that is the one free child of the bone its parent took.
  // Requiring a single candidate keeps an ambiguous fan-out unbound rather than guessing, and the
  // loop repeats so a chain resolves outward one level at a time.
  const sourceParentById = new Map((item.animation.bones ?? []).map((bone) => [bone.id, bone.parentId]));
  let boundThisRound = true;
  while (boundThisRound) {
    boundThisRound = false;
    for (const track of item.animation.keyframes) {
      if (bindings.has(track.boneId)) continue;

      const sourceParentId = sourceParentById.get(track.boneId);
      if (sourceParentId === undefined || sourceParentId === null) continue;
      const parentBinding = bindings.get(sourceParentId);
      if (!parentBinding) continue;

      const candidates = targetBones.filter(
        (bone) => !claimedTargets.has(bone.id) && bone.parentId === parentBinding.targetBoneId,
      );
      if (candidates.length !== 1) continue;

      const target = candidates[0]!;
      claimedTargets.add(target.id);
      bindings.set(track.boneId, {
        sourceBoneId: track.boneId,
        sourceBoneName: track.boneName,
        semantic: semantics.get(track.boneId) ?? null,
        targetBoneId: target.id,
        targetBoneName: target.name,
      });
      boundThisRound = true;
    }
  }

  return bindings;
};

// Flat, human-readable view for logs and the MCP response. Keyed by semantic role where one
// exists, falling back to a name-and-id label — never by bare bone name, which is what collapsed
// two entries into one in the first place.
export const describeBindings = (bindings: BoneBindingMap): Record<string, string> => {
  const described: Record<string, string> = {};
  for (const binding of bindings.values()) {
    const key = binding.semantic ?? `${binding.sourceBoneName}#${binding.sourceBoneId}`;
    described[key] = binding.targetBoneName;
  }
  return described;
};

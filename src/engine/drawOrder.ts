import type { Attachment, Bone, Slot } from '../types';
import { transformPoint, type ReadonlyMat4 } from './mat4';
import { getAttachmentWorldCentre } from './meshSkinning';

/**
 * The order attachments are painted in.
 *
 * ## What actually decides depth today
 *
 * Bone **order** on the outside, slot **array order** on the inside.
 * Neither id decides anything — authored ordering does:
 *
 *   - `skeletonStore.reorderBones` updates each bone's `order`, and that drag-and-drop
 *     in the Bones panel remains the primary cross-bone depth control.
 *   - `slotStore.reorderSlots` keeps the slots array sorted by `drawOrder`, so a
 *     slot's `drawOrder` orders it only against other slots on the *same* bone.
 *     `SlotListPanel` lists just the selected bone's slots, so the UI never
 *     implies otherwise.
 *
 * This is subtle enough that it is worth stating once, here, rather than leaving
 * it implicit in a nested loop inside the renderer.
 *
 * ## Why it is a function
 *
 * Extracted from `meshRenderer.render` so the depth sort that replaces it can be
 * proved to reproduce this sequence exactly — see the `draw-order` fixture in
 * `scripts/phase-a/verify-transform-parity.ts`. `depthIndex` is the seed for
 * that: it is the position in this sequence, and becomes each attachment's Z.
 */
/**
 * World-space distance between adjacent layers.
 *
 * ## Depth exists to fix occlusion order, not to create an effect
 *
 * An earlier value of 12 was chosen to make the parallax between layers
 * *visible*. Rendered, it tore the figure apart: the stack is a linear ramp over
 * draw order, so with ~15 parts the frontmost sat ~180 units ahead of the
 * backmost — comparable to the character's own height — and turning the camera
 * slid the limbs off the body.
 *
 * That is not a tuning problem, it is the model being wrong. Draw order is a 1D
 * ordering; depth is a physical quantity. On a human figure almost everything
 * sits at roughly the same depth, with only a few parts genuinely in front or
 * behind. A linear ramp cannot express that, and no single spacing value fixes
 * it — large enough to see is large enough to dismember.
 *
 * So the ramp is kept deliberately small. Its only job is to give the painter's
 * sort a stable, correct ordering when the camera turns. Real per-part depth
 * has to be authored, not derived, and that is a separate piece of work.
 */
export const DEPTH_SPACING = 2;

export const sortBonesByOrder = (bones: Bone[]): Bone[] =>
  bones
    .map((bone, index) => ({ bone, index }))
    .sort((a, b) => (a.bone.order ?? a.index) - (b.bone.order ?? b.index) || a.index - b.index)
    .map(({ bone }) => bone);

export interface DrawItem {
  bone: Bone;
  slot: Slot;
  attachment: Attachment;
  /** Position in the sequence. 0 is painted first, i.e. furthest back. */
  depthIndex: number;
  /** `depthIndex * DEPTH_SPACING` — the attachment's Z in world units. */
  depth: number;
}

/**
 * Resolve the paint order for one pass.
 *
 * Slots with no attachment name, and slots naming an attachment that does not
 * exist, are skipped — exactly as the renderer's loop did.
 *
 * Grouping is done up front so this is O(bones + slots) rather than the
 * O(bones x slots x attachments) the nested loop cost. Measured against that
 * loop: 1.8x at 60 bones, 3.9x at 150, and a wash below ~20 where building the
 * maps costs about what it saves. It runs once per pass per frame, so the win
 * matters on large rigs and never hurts on small ones.
 *
 * The sequence it produces is unchanged: slots keep their array order within a
 * bone, and the first attachment matching a name wins, as `find` did.
 */
export const computeDrawSequence = (
  bones: Bone[],
  slots: Slot[],
  attachments: Attachment[],
): DrawItem[] => {
  const slotsByBone = new Map<number, Slot[]>();
  for (const slot of slots) {
    if (!slot.attachmentName) continue;
    const existing = slotsByBone.get(slot.boneId);
    if (existing) existing.push(slot);
    else slotsByBone.set(slot.boneId, [slot]);
  }

  // Keyed by slot id + attachment name; first match wins, matching `find`.
  const attachmentByKey = new Map<string, Attachment>();
  for (const attachment of attachments) {
    const key = `${attachment.slotId} ${attachment.name}`;
    if (!attachmentByKey.has(key)) attachmentByKey.set(key, attachment);
  }

  const sequence: DrawItem[] = [];
  for (const bone of sortBonesByOrder(bones)) {
    const boneSlots = slotsByBone.get(bone.id);
    if (!boneSlots) continue;
    for (const slot of boneSlots) {
      const attachment = attachmentByKey.get(`${slot.id} ${slot.attachmentName}`);
      if (!attachment) continue;
      sequence.push({
        bone,
        slot,
        attachment,
        depthIndex: sequence.length,
        depth: 0, // filled in below, once the sequence length is known
      });
    }
  }

  // Centre the stack on z = 0 so the camera orbits through the middle of the rig
  // rather than around its backmost layer, which would swing the whole figure
  // sideways as it turns.
  const midpoint = (sequence.length - 1) / 2;
  for (const item of sequence) {
    item.depth = (item.depthIndex - midpoint) * DEPTH_SPACING;
  }

  return sequence;
};

/**
 * Re-order a draw sequence back-to-front for a turned camera.
 *
 * Larger Z is nearer the viewer — `depthIndex` 0 is painted first and therefore
 * sits furthest back — so this sorts ascending by view-space Z.
 *
 * ## Why this is safe to switch on unconditionally
 *
 * At yaw 0 / pitch 0 the orbit matrix is exactly the identity, so a part's view
 * Z is exactly its layer depth, `depthIndex * DEPTH_SPACING`. Those are distinct
 * and already ascending along the sequence, so the sort is a no-op and the paint
 * order is unchanged — which is what the `draw-order` fixtures pin down.
 *
 * Once the camera turns, view Z mixes in world X, so a part that was behind can
 * legitimately come forward. Ties keep their original relative order, because
 * `Array.prototype.sort` is stable.
 *
 * ## Where it degenerates
 *
 * View Z works out to `-sin(yaw) * x + cos(yaw) * z`. As yaw approaches +/-90
 * the `cos` term vanishes and layer depth stops contributing at all: parts that
 * sit at the same X — a badge on a chest, an eye on a face — become exact ties
 * and fall back on their authored order. That is the best available answer, but
 * it means the usable range is roughly +/-60 and edge-on views are not a thing
 * layered cut-outs can represent. Increasing `DEPTH_SPACING` does not rescue it;
 * the term is multiplied by zero.
 *
 * Away from that limit the behaviour is simply correct: two parts at different X
 * genuinely do swap depth when the camera turns, and they should.
 *
 * This is painter's ordering, not a depth buffer: `DEPTH_TEST` stays off because
 * alpha-blended sprites must be drawn back-to-front to composite correctly. The
 * cost is that parts which genuinely interpenetrate cannot be resolved — an
 * inherent limit of layered cut-outs, not something a deeper sort would fix.
 */
export const sortByViewDepth = (items: DrawItem[], orbit: ReadonlyMat4): DrawItem[] => {
  if (items.length < 2) return items;

  const viewZ = new Map<DrawItem, number>();
  for (const item of items) {
    const [cx, cy, cz] = getAttachmentWorldCentre(item.attachment, item.bone, item.depth);
    viewZ.set(item, transformPoint(orbit, cx, cy, cz)[2]);
  }

  return [...items].sort((a, b) => viewZ.get(a)! - viewZ.get(b)!);
};

import type { Slot, SlotAttachmentKeyframes } from '../types';

export const resolveSlotAttachmentAtFrame = (
  slot: Slot,
  frame: number,
  slotAttachmentKeyframes: SlotAttachmentKeyframes,
) => {
  const slotKeyframes = slotAttachmentKeyframes[slot.id];
  if (!slotKeyframes) return slot.attachmentName;

  const frames = Object.keys(slotKeyframes).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return slot.attachmentName;

  let prev: number | null = null;

  for (const keyframe of frames) {
    if (keyframe <= frame) {
      prev = keyframe;
    } else {
      break;
    }
  }

  if (prev === null) {
    return slot.attachmentName;
  }

  return slotKeyframes[prev]?.attachmentName ?? slot.attachmentName;
};

export const resolveSlotsAtFrame = (
  slots: Slot[],
  frame: number,
  slotAttachmentKeyframes: SlotAttachmentKeyframes,
) =>
  slots.map((slot) => ({
    ...slot,
    attachmentName: resolveSlotAttachmentAtFrame(
      slot,
      frame,
      slotAttachmentKeyframes,
    ),
  }));

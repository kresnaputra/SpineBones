import type { Slot, SlotAttachmentKeyframes } from '../types';

export const getSlotAttachmentAtFrame = (
  slotId: number,
  frame: number,
  slotAttachmentKeyframes: SlotAttachmentKeyframes,
  fallbackAttachmentName: string | null,
) => {
  const slotKeyframes = slotAttachmentKeyframes[slotId];
  if (!slotKeyframes) return fallbackAttachmentName;

  const frames = Object.keys(slotKeyframes)
    .map(Number)
    .sort((a, b) => a - b);
  if (frames.length === 0) return fallbackAttachmentName;

  let resolvedAttachmentName = fallbackAttachmentName;

  for (const keyframe of frames) {
    if (keyframe > frame) break;
    resolvedAttachmentName = slotKeyframes[keyframe]?.attachmentName ?? null;
  }

  return resolvedAttachmentName;
};

export const resolveAnimatedSlots = (
  slots: Slot[],
  frame: number,
  slotAttachmentKeyframes: SlotAttachmentKeyframes,
) =>
  slots.map((slot) => ({
    ...slot,
    attachmentName: getSlotAttachmentAtFrame(
      slot.id,
      frame,
      slotAttachmentKeyframes,
      slot.attachmentName,
    ),
  }));

import { create } from 'zustand';
import type { Slot, Attachment } from '../types';

interface SlotState {
  slots: Slot[];
  attachments: Attachment[];
  nextSlotId: number;
  addSlot: (boneId: number, name: string) => Slot;
  updateSlot: (id: number, updates: Partial<Slot>) => void;
  deleteSlot: (id: number) => void;
  addAttachment: (slotId: number, attachment: Omit<Attachment, 'slotId'>) => void;
  updateAttachment: (slotId: number, name: string, updates: Partial<Attachment>) => void;
  deleteAttachment: (slotId: number, name: string) => void;
  setSlotAttachment: (slotId: number, attachmentName: string | null) => void;
  getSlotsByBone: (boneId: number) => Slot[];
  getAttachmentsBySlot: (slotId: number) => Attachment[];
  reorderSlots: (slotId: number, newDrawOrder: number) => void;
}

export const useSlotStore = create<SlotState>((set, get) => ({
  slots: [],
  attachments: [],
  nextSlotId: 1,

  addSlot: (boneId, name) => {
    const newSlot: Slot = {
      id: get().nextSlotId,
      name,
      boneId,
      color: '#ffffff',
      attachmentName: null,
      drawOrder: get().slots.length,
    };

    set((state) => ({
      slots: [...state.slots, newSlot],
      nextSlotId: state.nextSlotId + 1,
    }));

    return newSlot;
  },

  updateSlot: (id, updates) => {
    set((state) => ({
      slots: state.slots.map((slot) =>
        slot.id === id ? { ...slot, ...updates } : slot
      ),
    }));
  },

  deleteSlot: (id) => {
    set((state) => ({
      slots: state.slots.filter((slot) => slot.id !== id),
      attachments: state.attachments.filter((att) => att.slotId !== id),
    }));
  },

  addAttachment: (slotId, attachment) => {
    const newAttachment: Attachment = {
      ...attachment,
      slotId,
    };

    set((state) => ({
      attachments: [...state.attachments, newAttachment],
    }));
  },

  updateAttachment: (slotId, name, updates) => {
    set((state) => ({
      attachments: state.attachments.map((att) =>
        att.slotId === slotId && att.name === name
          ? { ...att, ...updates }
          : att
      ),
    }));
  },

  deleteAttachment: (slotId, name) => {
    set((state) => ({
      attachments: state.attachments.filter(
        (att) => !(att.slotId === slotId && att.name === name)
      ),
    }));
  },

  setSlotAttachment: (slotId, attachmentName) => {
    set((state) => ({
      slots: state.slots.map((slot) =>
        slot.id === slotId ? { ...slot, attachmentName } : slot
      ),
    }));
  },

  getSlotsByBone: (boneId) => {
    return get().slots.filter((slot) => slot.boneId === boneId);
  },

  getAttachmentsBySlot: (slotId) => {
    return get().attachments.filter((att) => att.slotId === slotId);
  },

  reorderSlots: (slotId, newDrawOrder) => {
    const { slots } = get();
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    const oldOrder = slot.drawOrder;
    const reordered = slots.map((s) => {
      if (s.id === slotId) {
        return { ...s, drawOrder: newDrawOrder };
      }
      if (oldOrder < newDrawOrder) {
        if (s.drawOrder > oldOrder && s.drawOrder <= newDrawOrder) {
          return { ...s, drawOrder: s.drawOrder - 1 };
        }
      } else {
        if (s.drawOrder >= newDrawOrder && s.drawOrder < oldOrder) {
          return { ...s, drawOrder: s.drawOrder + 1 };
        }
      }
      return s;
    });

    set({ slots: reordered.sort((a, b) => a.drawOrder - b.drawOrder) });
  },
}));

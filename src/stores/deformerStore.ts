import { create } from 'zustand';
import type { Deformer, DeformerKeyframes, KeyframeEasing } from '../types';

interface DeformerState {
  deformers: Deformer[];
  nextDeformerId: number;
  deformerKeyframes: DeformerKeyframes;

  addDeformer: (def: Omit<Deformer, 'id'>) => number;
  updateDeformer: (id: number, changes: Partial<Omit<Deformer, 'id'>>) => void;
  removeDeformer: (id: number) => void;
  setDeformerKeyframe: (
    deformerId: number,
    frame: number,
    points: { x: number; y: number }[],
  ) => void;
  deleteDeformerKeyframe: (deformerId: number, frame: number) => void;
  moveDeformerKeyframe: (deformerId: number, fromFrame: number, toFrame: number) => void;
  updateDeformerKeyframeEasing: (deformerId: number, frame: number, easing: KeyframeEasing) => void;
  clearDeformerKeyframes: (deformerId: number) => void;
  replaceAll: (
    deformers: Deformer[],
    nextDeformerId: number,
    deformerKeyframes: DeformerKeyframes,
  ) => void;
}

export const useDeformerStore = create<DeformerState>((set, get) => ({
  deformers: [],
  nextDeformerId: 1,
  deformerKeyframes: {},

  addDeformer: (def) => {
    const id = get().nextDeformerId;
    set((s) => ({
      deformers: [...s.deformers, { ...def, id }],
      nextDeformerId: s.nextDeformerId + 1,
    }));
    return id;
  },

  updateDeformer: (id, changes) =>
    set((s) => ({
      deformers: s.deformers.map((d) => (d.id === id ? { ...d, ...changes } : d)),
    })),

  removeDeformer: (id) =>
    set((s) => {
      const kfs = { ...s.deformerKeyframes };
      delete kfs[id];
      return { deformers: s.deformers.filter((d) => d.id !== id), deformerKeyframes: kfs };
    }),

  setDeformerKeyframe: (deformerId, frame, points) =>
    set((s) => ({
      deformerKeyframes: {
        ...s.deformerKeyframes,
        [deformerId]: {
          ...(s.deformerKeyframes[deformerId] ?? {}),
          [frame]: {
            points: points.map((p) => ({ x: p.x, y: p.y })),
            easing: s.deformerKeyframes[deformerId]?.[frame]?.easing ?? 'linear',
          },
        },
      },
    })),

  deleteDeformerKeyframe: (deformerId, frame) =>
    set((s) => {
      const df = { ...(s.deformerKeyframes[deformerId] ?? {}) };
      delete df[frame];
      const next = { ...s.deformerKeyframes };
      if (Object.keys(df).length === 0) delete next[deformerId];
      else next[deformerId] = df;
      return { deformerKeyframes: next };
    }),

  moveDeformerKeyframe: (deformerId, fromFrame, toFrame) => {
    if (fromFrame === toFrame) return;
    set((s) => {
      const df = s.deformerKeyframes[deformerId];
      const source = df?.[fromFrame];
      if (!df || !source) return s;
      const nextFrames = { ...df };
      delete nextFrames[fromFrame];
      nextFrames[toFrame] = {
        points: source.points.map((p) => ({ x: p.x, y: p.y })),
        easing: source.easing,
      };
      return {
        deformerKeyframes: {
          ...s.deformerKeyframes,
          [deformerId]: nextFrames,
        },
      };
    });
  },

  updateDeformerKeyframeEasing: (deformerId, frame, easing) =>
    set((s) => {
      const existing = s.deformerKeyframes[deformerId]?.[frame];
      if (!existing) return s;
      return {
        deformerKeyframes: {
          ...s.deformerKeyframes,
          [deformerId]: {
            ...s.deformerKeyframes[deformerId],
            [frame]: { ...existing, easing },
          },
        },
      };
    }),

  clearDeformerKeyframes: (deformerId) =>
    set((s) => {
      const kfs = { ...s.deformerKeyframes };
      delete kfs[deformerId];
      return { deformerKeyframes: kfs };
    }),

  replaceAll: (deformers, nextDeformerId, deformerKeyframes) =>
    set({ deformers, nextDeformerId, deformerKeyframes }),
}));

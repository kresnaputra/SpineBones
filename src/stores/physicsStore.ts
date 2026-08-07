import { create } from 'zustand';
import type { PhysicsConfig } from '../types';
import type { PhysicsRuntime } from '../engine/physics';

interface PhysicsState {
  configs: PhysicsConfig[];
  /** Runtime spring state per boneId (transient — not persisted). */
  runtimes: Record<number, PhysicsRuntime>;
  /** World-space offsets applied to bone._wx/_wy each render (transient). */
  offsets: Record<number, { dx: number; dy: number }>;

  addConfig: (config: PhysicsConfig) => void;
  updateConfig: (boneId: number, changes: Partial<Omit<PhysicsConfig, 'boneId'>>) => void;
  removeConfig: (boneId: number) => void;
  setRuntime: (boneId: number, rt: PhysicsRuntime) => void;
  clearOffsets: () => void;
  replaceAll: (configs: PhysicsConfig[]) => void;
}

export const usePhysicsStore = create<PhysicsState>((set) => ({
  configs: [],
  runtimes: {},
  offsets: {},

  addConfig: (config) =>
    set((s) => ({
      configs: s.configs.some((c) => c.boneId === config.boneId)
        ? s.configs
        : [...s.configs, config],
    })),

  updateConfig: (boneId, changes) =>
    set((s) => ({
      configs: s.configs.map((c) => (c.boneId === boneId ? { ...c, ...changes } : c)),
    })),

  removeConfig: (boneId) =>
    set((s) => ({
      configs: s.configs.filter((c) => c.boneId !== boneId),
      runtimes: Object.fromEntries(Object.entries(s.runtimes).filter(([k]) => Number(k) !== boneId)),
      offsets: Object.fromEntries(Object.entries(s.offsets).filter(([k]) => Number(k) !== boneId)),
    })),

  setRuntime: (boneId, rt) =>
    set((s) => ({ runtimes: { ...s.runtimes, [boneId]: rt } })),

  clearOffsets: () => set({ offsets: {}, runtimes: {} }),

  replaceAll: (configs) => set({ configs, runtimes: {}, offsets: {} }),
}));

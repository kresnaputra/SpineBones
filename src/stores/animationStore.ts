import { create } from 'zustand';
import type { Keyframes, KeyframeData } from '../types';
import { useSkeletonStore } from './skeletonStore';

interface AnimationState {
  keyframes: Keyframes;
  frame: number;
  duration: number;
  fps: number;
  playing: boolean;
  insertKeyframe: (boneId: number, frameData: KeyframeData) => void;
  clearKeyframes: (boneId: number) => void;
  setFrame: (frame: number) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  play: () => void;
  stop: () => void;
  applyKeyframes: () => void;
  getKeyframesForBone: (boneId: number) => number[];
}

export const useAnimationStore = create<AnimationState>((set, get) => ({
  keyframes: {},
  frame: 0,
  duration: 60,
  fps: 24,
  playing: false,

  insertKeyframe: (boneId, frameData) => {
    set((state) => ({
      keyframes: {
        ...state.keyframes,
        [boneId]: {
          ...state.keyframes[boneId],
          [state.frame]: frameData,
        },
      },
    }));
  },

  clearKeyframes: (boneId) => {
    set((state) => {
      const newKeyframes = { ...state.keyframes };
      delete newKeyframes[boneId];
      return { keyframes: newKeyframes };
    });
  },

  setFrame: (frame) => set({ frame }),
  setDuration: (duration) => set({ duration }),
  setFps: (fps) => set({ fps }),
  play: () => set({ playing: true }),
  stop: () => set({ playing: false }),

  applyKeyframes: () => {
    const { keyframes, frame } = get();
    const { bones, updateBone } = useSkeletonStore.getState();

    bones.forEach((bone) => {
      const boneKeyframes = keyframes[bone.id];
      if (!boneKeyframes) return;

      const frames = Object.keys(boneKeyframes)
        .map(Number)
        .sort((a, b) => a - b);

      if (frames.length === 0) return;

      let prev: number | null = null;
      let next: number | null = null;

      for (const f of frames) {
        if (f <= frame) prev = f;
        if (f >= frame && next === null) next = f;
      }

      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

      if (prev === null && next !== null) {
        updateBone(bone.id, boneKeyframes[next]);
      } else if (prev !== null && next === null) {
        updateBone(bone.id, boneKeyframes[prev]);
      } else if (prev !== null && next !== null) {
        const t = prev === next ? 1 : (frame - prev) / (next - prev);
        const kp = boneKeyframes[prev];
        const kn = boneKeyframes[next];
        updateBone(bone.id, {
          x: lerp(kp.x, kn.x, t),
          y: lerp(kp.y, kn.y, t),
          rotation: lerp(kp.rotation, kn.rotation, t),
          scaleX: lerp(kp.scaleX, kn.scaleX, t),
          scaleY: lerp(kp.scaleY, kn.scaleY, t),
        });
      }
    });
  },

  getKeyframesForBone: (boneId) => {
    const boneKeyframes = get().keyframes[boneId];
    if (!boneKeyframes) return [];
    return Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
  },
}));

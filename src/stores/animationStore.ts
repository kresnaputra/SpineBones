import { create } from 'zustand';
import type { Keyframes, KeyframeData } from '../types';
import { useSkeletonStore } from './skeletonStore';

interface AnimationState {
  keyframes: Keyframes;
  frame: number;
  duration: number;
  fps: number;
  playing: boolean;
  audioData: string | null;
  audioName: string | null;
  audioVolume: number;
  audioOffsetFrames: number;
  insertKeyframe: (boneId: number, frameData: KeyframeData) => void;
  moveKeyframe: (boneId: number, fromFrame: number, toFrame: number) => void;
  deleteKeyframe: (boneId: number, frame: number) => void;
  clearKeyframes: (boneId: number) => void;
  setFrame: (frame: number) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  setAudioTrack: (audioData: string, audioName: string) => void;
  clearAudioTrack: () => void;
  setAudioVolume: (volume: number) => void;
  setAudioOffsetFrames: (offsetFrames: number) => void;
  play: () => void;
  stop: () => void;
  applyKeyframes: () => void;
  getKeyframesForBone: (boneId: number) => number[];
  shiftKeyframes: (deltas: Record<number, { dx: number; dy: number; dRot: number; dScaleX: number; dScaleY: number }>) => void;
}

export const useAnimationStore = create<AnimationState>((set, get) => ({
  keyframes: {},
  frame: 0,
  duration: 60,
  fps: 24,
  playing: false,
  audioData: null,
  audioName: null,
  audioVolume: 0.8,
  audioOffsetFrames: 0,

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

  moveKeyframe: (boneId, fromFrame, toFrame) => {
    if (fromFrame === toFrame) return;

    set((state) => {
      const boneKeyframes = state.keyframes[boneId];
      const sourceKeyframe = boneKeyframes?.[fromFrame];
      if (!boneKeyframes || !sourceKeyframe) return state;

      const nextBoneKeyframes = { ...boneKeyframes };
      delete nextBoneKeyframes[fromFrame];
      nextBoneKeyframes[toFrame] = sourceKeyframe;

      return {
        keyframes: {
          ...state.keyframes,
          [boneId]: nextBoneKeyframes,
        },
      };
    });
  },

  deleteKeyframe: (boneId, frame) => {
    set((state) => {
      const boneKeyframes = { ...state.keyframes[boneId] };
      delete boneKeyframes[frame];
      
      const newKeyframes = { ...state.keyframes };
      if (Object.keys(boneKeyframes).length === 0) {
        delete newKeyframes[boneId];
      } else {
        newKeyframes[boneId] = boneKeyframes;
      }
      
      return { keyframes: newKeyframes };
    });
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
  setAudioTrack: (audioData, audioName) => set({ audioData, audioName, audioOffsetFrames: 0 }),
  clearAudioTrack: () => set({ audioData: null, audioName: null, audioOffsetFrames: 0 }),
  setAudioVolume: (audioVolume) => set({ audioVolume }),
  setAudioOffsetFrames: (audioOffsetFrames) => set({ audioOffsetFrames: Math.max(0, Math.round(audioOffsetFrames)) }),
  play: () => set({ playing: true }),
  stop: () => set({ playing: false }),

  applyKeyframes: () => {
    const { keyframes, frame } = get();
    const { bones, updateBone, setupPose } = useSkeletonStore.getState();

    bones.forEach((bone) => {
      const boneKeyframes = keyframes[bone.id];
      
      // If no keyframes for this bone, restore setup pose
      if (!boneKeyframes) {
        const pose = setupPose[bone.id];
        if (pose) {
          updateBone(bone.id, pose);
        }
        return;
      }

      const frames = Object.keys(boneKeyframes)
        .map(Number)
        .sort((a, b) => a - b);

      if (frames.length === 0) {
        // No keyframes, restore setup pose
        const pose = setupPose[bone.id];
        if (pose) {
          updateBone(bone.id, pose);
        }
        return;
      }

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

  shiftKeyframes: (deltas) => {
    set((state) => {
      const newKeyframes = { ...state.keyframes };
      for (const boneIdStr of Object.keys(newKeyframes)) {
        const boneId = Number(boneIdStr);
        const delta = deltas[boneId];
        if (!delta) continue;

        const boneFrames = { ...newKeyframes[boneId] };
        for (const frameStr of Object.keys(boneFrames)) {
          const f = Number(frameStr);
          const kf = boneFrames[f];
          boneFrames[f] = {
            x: kf.x + delta.dx,
            y: kf.y + delta.dy,
            rotation: kf.rotation + delta.dRot,
            scaleX: kf.scaleX + delta.dScaleX,
            scaleY: kf.scaleY + delta.dScaleY,
          };
        }
        newKeyframes[boneId] = boneFrames;
      }
      return { keyframes: newKeyframes };
    });
  },
}));

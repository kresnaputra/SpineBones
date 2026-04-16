import { create } from 'zustand';
import type {
  AttachmentOpacityKeyframes,
  Bone,
  Keyframes,
  KeyframeData,
  KeyframeEasing,
  MeshDeformKeyframes,
} from '../types';
import { useSkeletonStore } from './skeletonStore';
import { applyEasing, normalizeKeyframeData } from '../utils/easing';
import { sampleBonesAtFrame } from '../utils/animationPose';

interface AnimationState {
  keyframes: Keyframes;
  meshDeformKeyframes: MeshDeformKeyframes;
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes;
  frame: number;
  duration: number;
  fps: number;
  playing: boolean;
  audioData: string | null;
  audioName: string | null;
  audioVolume: number;
  audioOffsetFrames: number;
  insertKeyframe: (boneId: number, frameData: KeyframeData) => void;
  setMeshDeformKeyframe: (attachmentKey: string, vertices: Array<{ x: number; y: number }>) => void;
  deleteMeshDeformKeyframe: (attachmentKey: string, frame: number) => void;
  setAttachmentOpacityKeyframe: (attachmentKey: string, opacity: number) => void;
  deleteAttachmentOpacityKeyframe: (attachmentKey: string, frame: number) => void;
  moveKeyframe: (boneId: number, fromFrame: number, toFrame: number) => void;
  updateKeyframeEasing: (boneId: number, frame: number, easing: KeyframeEasing) => void;
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
  remapBoneKeyframesForParentChange: (boneId: number, newParentId: number | null) => void;
}

const toLocalPose = (worldBone: Bone, parentBone: Bone | null, sourcePose: KeyframeData): KeyframeData => {
  if (!parentBone) {
    return {
      ...sourcePose,
      x: worldBone._wx,
      y: worldBone._wy,
      rotation: worldBone._wrot,
    };
  }

  const dx = worldBone._wx - parentBone._wx;
  const dy = worldBone._wy - parentBone._wy;
  const cos = Math.cos((-parentBone._wrot * Math.PI) / 180);
  const sin = Math.sin((-parentBone._wrot * Math.PI) / 180);

  return {
    ...sourcePose,
    x: (dx * cos - dy * sin) / parentBone.scaleX,
    y: (dx * sin + dy * cos) / parentBone.scaleY,
    rotation: worldBone._wrot - parentBone._wrot,
  };
};

export const useAnimationStore = create<AnimationState>((set, get) => ({
  keyframes: {},
  meshDeformKeyframes: {},
  attachmentOpacityKeyframes: {},
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
          [state.frame]: normalizeKeyframeData(frameData),
        },
      },
    }));
  },

  setMeshDeformKeyframe: (attachmentKey, vertices) => {
    set((state) => ({
      meshDeformKeyframes: {
        ...state.meshDeformKeyframes,
        [attachmentKey]: {
          ...state.meshDeformKeyframes[attachmentKey],
          [state.frame]: {
            vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
          },
        },
      },
    }));
  },

  deleteMeshDeformKeyframe: (attachmentKey, frame) => {
    set((state) => {
      const attachmentKeyframes = { ...(state.meshDeformKeyframes[attachmentKey] ?? {}) };
      delete attachmentKeyframes[frame];

      const nextMeshDeformKeyframes = { ...state.meshDeformKeyframes };
      if (Object.keys(attachmentKeyframes).length === 0) {
        delete nextMeshDeformKeyframes[attachmentKey];
      } else {
        nextMeshDeformKeyframes[attachmentKey] = attachmentKeyframes;
      }

      return { meshDeformKeyframes: nextMeshDeformKeyframes };
    });
  },

  setAttachmentOpacityKeyframe: (attachmentKey, opacity) => {
    set((state) => ({
      attachmentOpacityKeyframes: {
        ...state.attachmentOpacityKeyframes,
        [attachmentKey]: {
          ...state.attachmentOpacityKeyframes[attachmentKey],
          [state.frame]: {
            opacity: Math.min(1, Math.max(0, opacity)),
          },
        },
      },
    }));
  },

  deleteAttachmentOpacityKeyframe: (attachmentKey, frame) => {
    set((state) => {
      const attachmentKeyframes = { ...(state.attachmentOpacityKeyframes[attachmentKey] ?? {}) };
      delete attachmentKeyframes[frame];

      const nextAttachmentOpacityKeyframes = { ...state.attachmentOpacityKeyframes };
      if (Object.keys(attachmentKeyframes).length === 0) {
        delete nextAttachmentOpacityKeyframes[attachmentKey];
      } else {
        nextAttachmentOpacityKeyframes[attachmentKey] = attachmentKeyframes;
      }

      return { attachmentOpacityKeyframes: nextAttachmentOpacityKeyframes };
    });
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

  updateKeyframeEasing: (boneId, frame, easing) => {
    set((state) => {
      const existing = state.keyframes[boneId]?.[frame];
      if (!existing) return state;

      return {
        keyframes: {
          ...state.keyframes,
          [boneId]: {
            ...state.keyframes[boneId],
            [frame]: {
              ...existing,
              easing,
            },
          },
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

      if (prev === null && next !== null) {
        updateBone(bone.id, normalizeKeyframeData(boneKeyframes[next]));
      } else if (prev !== null && next === null) {
        updateBone(bone.id, normalizeKeyframeData(boneKeyframes[prev]));
      } else if (prev !== null && next !== null) {
        const t = prev === next ? 1 : (frame - prev) / (next - prev);
        const easedT = applyEasing(boneKeyframes[prev]?.easing, t);
        const kp = normalizeKeyframeData(boneKeyframes[prev]);
        const kn = normalizeKeyframeData(boneKeyframes[next]);
        const lerp = (a: number, b: number, ratio: number) => a + (b - a) * ratio;
        updateBone(bone.id, {
          x: lerp(kp.x, kn.x, easedT),
          y: lerp(kp.y, kn.y, easedT),
          rotation: lerp(kp.rotation, kn.rotation, easedT),
          scaleX: lerp(kp.scaleX, kn.scaleX, easedT),
          scaleY: lerp(kp.scaleY, kn.scaleY, easedT),
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
            easing: kf.easing,
          };
        }
        newKeyframes[boneId] = boneFrames;
      }
      return { keyframes: newKeyframes };
    });
  },

  remapBoneKeyframesForParentChange: (boneId, newParentId) => {
    set((state) => {
      const boneKeyframes = state.keyframes[boneId];
      if (!boneKeyframes) return state;

      const { bones, setupPose } = useSkeletonStore.getState();
      const frames = Object.keys(boneKeyframes).map(Number);
      if (frames.length === 0) return state;

      const nextBoneKeyframes = { ...boneKeyframes };

      frames.forEach((frame) => {
        const sampledBones = sampleBonesAtFrame(bones, state.keyframes, setupPose, frame);
        const sampledBone = sampledBones.find((bone) => bone.id === boneId);
        if (!sampledBone) return;

        const sampledParent =
          newParentId === null
            ? null
            : sampledBones.find((bone) => bone.id === newParentId) ?? null;
        const sourcePose = normalizeKeyframeData(boneKeyframes[frame]);
        nextBoneKeyframes[frame] = toLocalPose(sampledBone, sampledParent, sourcePose);
      });

      return {
        keyframes: {
          ...state.keyframes,
          [boneId]: nextBoneKeyframes,
        },
      };
    });
  },
}));

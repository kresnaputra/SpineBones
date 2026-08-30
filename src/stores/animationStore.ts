import { create } from 'zustand';
import type {
  AttachmentOpacityKeyframes,
  AudioTrack,
  Bone,
  Keyframes,
  KeyframeData,
  KeyframeEasing,
  MeshDeformKeyframes,
  SlotAttachmentKeyframes,
} from '../types';
import { useSkeletonStore } from './skeletonStore';
import { applyEasing, normalizeKeyframeData } from '../utils/easing';
import { sampleBonesAtFrame } from '../utils/animationPose';
import { useEditorStore } from './editorStore';

// Sorted-frame-number cache keyed by a bone's keyframes object identity, which is
// only replaced when that bone's keyframes actually change (see insertKeyframe etc.
// below — always `{ ...state.keyframes[boneId], ... }`). Lets playback re-run
// applyKeyframes() every tick without re-sorting unchanged keyframe data each time.
const sortedFramesCache = new WeakMap<object, number[]>();
const getSortedFrames = (boneKeyframes: object): number[] => {
  const cached = sortedFramesCache.get(boneKeyframes);
  if (cached) return cached;
  const sorted = Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
  sortedFramesCache.set(boneKeyframes, sorted);
  return sorted;
};

interface AnimationState {
  keyframes: Keyframes;
  slotAttachmentKeyframes: SlotAttachmentKeyframes;
  attachmentOpacityKeyframes: AttachmentOpacityKeyframes;
  meshDeformKeyframes: MeshDeformKeyframes;
  frame: number;
  duration: number;
  fps: number;
  playing: boolean;
  audioTracks: AudioTrack[];
  activeAudioTrackId: number | null;
  nextAudioTrackId: number;
  audioData: string | null;
  audioName: string | null;
  audioVolume: number;
  audioOffsetFrames: number;
  insertKeyframe: (boneId: number, frameData: KeyframeData) => void;
  setSlotAttachmentKeyframeAtFrame: (
    slotId: number,
    frame: number,
    attachmentName: string | null,
  ) => void;
  setSlotAttachmentKeyframe: (slotId: number, attachmentName: string | null) => void;
  deleteSlotAttachmentKeyframe: (slotId: number, frame: number) => void;
  moveSlotAttachmentKeyframe: (slotId: number, fromFrame: number, toFrame: number) => void;
  setAttachmentOpacityKeyframeAtFrame: (attachmentKey: string, frame: number, opacity: number) => void;
  setAttachmentOpacityKeyframe: (attachmentKey: string, opacity: number) => void;
  deleteAttachmentOpacityKeyframe: (attachmentKey: string, frame: number) => void;
  moveAttachmentOpacityKeyframe: (attachmentKey: string, fromFrame: number, toFrame: number) => void;
  updateAttachmentOpacityKeyframeEasing: (attachmentKey: string, frame: number, easing: KeyframeEasing) => void;
  setMeshDeformKeyframeAtFrame: (attachmentKey: string, frame: number, vertices: Array<{ x: number; y: number }>) => void;
  setMeshDeformKeyframe: (attachmentKey: string, vertices: Array<{ x: number; y: number }>) => void;
  deleteMeshDeformKeyframe: (attachmentKey: string, frame: number) => void;
  moveMeshDeformKeyframe: (attachmentKey: string, fromFrame: number, toFrame: number) => void;
  updateMeshDeformKeyframeEasing: (attachmentKey: string, frame: number, easing: KeyframeEasing) => void;
  replaceMeshDeformKeyframesForAttachment: (attachmentKey: string, frames: MeshDeformKeyframes[string]) => void;
  clearMeshDeformKeyframesForAttachment: (attachmentKey: string) => void;
  moveKeyframe: (boneId: number, fromFrame: number, toFrame: number) => void;
  updateKeyframeEasing: (boneId: number, frame: number, easing: KeyframeEasing) => void;
  deleteKeyframe: (boneId: number, frame: number) => void;
  clearKeyframes: (boneId: number) => void;
  setFrame: (frame: number) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  setAudioTrack: (audioData: string, audioName: string) => void;
  addAudioTrack: (audioData: string, audioName: string) => AudioTrack;
  removeAudioTrack: (trackId?: number) => void;
  clearAudioTrack: () => void;
  setActiveAudioTrackId: (trackId: number | null) => void;
  setAudioVolume: (volume: number, trackId?: number) => void;
  setAudioOffsetFrames: (offsetFrames: number, trackId?: number) => void;
  play: () => void;
  stop: () => void;
  applyKeyframes: () => void;
  getKeyframesForBone: (boneId: number) => number[];
  shiftKeyframes: (deltas: Record<number, { dx: number; dy: number; dRot: number; dScaleX: number; dScaleY: number; dOrder: number }>) => void;
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
  slotAttachmentKeyframes: {},
  attachmentOpacityKeyframes: {},
  meshDeformKeyframes: {},
  frame: 0,
  duration: 60,
  fps: 24,
  playing: false,
  audioTracks: [],
  activeAudioTrackId: null,
  nextAudioTrackId: 1,
  audioData: null,
  audioName: null,
  audioVolume: 0.8,
  audioOffsetFrames: 0,

  insertKeyframe: (boneId, frameData) => {
    const bone = useSkeletonStore.getState().getBoneById(boneId);
    set((state) => ({
      keyframes: {
        ...state.keyframes,
        [boneId]: {
          ...state.keyframes[boneId],
          [state.frame]: normalizeKeyframeData({
            ...frameData,
            order: Math.round(frameData.order ?? bone?.order ?? 0),
          }),
        },
      },
    }));
  },

  setSlotAttachmentKeyframeAtFrame: (slotId, frame, attachmentName) => {
    set((state) => ({
      slotAttachmentKeyframes: {
        ...state.slotAttachmentKeyframes,
        [slotId]: {
          ...state.slotAttachmentKeyframes[slotId],
          [Math.max(0, Math.round(frame))]: { attachmentName },
        },
      },
    }));
  },

  setSlotAttachmentKeyframe: (slotId, attachmentName) => {
    set((state) => ({
      slotAttachmentKeyframes: {
        ...state.slotAttachmentKeyframes,
        [slotId]: {
          ...state.slotAttachmentKeyframes[slotId],
          [state.frame]: { attachmentName },
        },
      },
    }));
  },

  deleteSlotAttachmentKeyframe: (slotId, frame) => {
    set((state) => {
      const slotKeyframes = { ...(state.slotAttachmentKeyframes[slotId] ?? {}) };
      delete slotKeyframes[frame];

      const nextSlotAttachmentKeyframes = { ...state.slotAttachmentKeyframes };
      if (Object.keys(slotKeyframes).length === 0) {
        delete nextSlotAttachmentKeyframes[slotId];
      } else {
        nextSlotAttachmentKeyframes[slotId] = slotKeyframes;
      }

      return { slotAttachmentKeyframes: nextSlotAttachmentKeyframes };
    });
  },

  moveSlotAttachmentKeyframe: (slotId, fromFrame, toFrame) => {
    if (fromFrame === toFrame) return;

    set((state) => {
      const slotKeyframes = state.slotAttachmentKeyframes[slotId];
      const sourceKeyframe = slotKeyframes?.[fromFrame];
      if (!slotKeyframes || !sourceKeyframe) return state;

      const nextSlotKeyframes = { ...slotKeyframes };
      delete nextSlotKeyframes[fromFrame];
      nextSlotKeyframes[toFrame] = sourceKeyframe;

      return {
        slotAttachmentKeyframes: {
          ...state.slotAttachmentKeyframes,
          [slotId]: nextSlotKeyframes,
        },
      };
    });
  },

  setMeshDeformKeyframeAtFrame: (attachmentKey, frame, vertices) => {
    set((state) => ({
      meshDeformKeyframes: {
        ...state.meshDeformKeyframes,
        [attachmentKey]: {
          ...state.meshDeformKeyframes[attachmentKey],
          [Math.max(0, Math.round(frame))]: {
            vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
            easing: state.meshDeformKeyframes[attachmentKey]?.[Math.max(0, Math.round(frame))]?.easing ?? 'linear',
          },
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
            vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
            easing: state.meshDeformKeyframes[attachmentKey]?.[state.frame]?.easing ?? 'linear',
          },
        },
      },
    }));
  },

  deleteMeshDeformKeyframe: (attachmentKey, frame) => {
    set((state) => {
      const kfs = { ...(state.meshDeformKeyframes[attachmentKey] ?? {}) };
      delete kfs[frame];
      const next = { ...state.meshDeformKeyframes };
      if (Object.keys(kfs).length === 0) delete next[attachmentKey];
      else next[attachmentKey] = kfs;
      return { meshDeformKeyframes: next };
    });
  },

  replaceMeshDeformKeyframesForAttachment: (attachmentKey, frames) => {
    set((state) => ({
      meshDeformKeyframes: { ...state.meshDeformKeyframes, [attachmentKey]: frames },
    }));
  },

  clearMeshDeformKeyframesForAttachment: (attachmentKey) => {
    set((state) => {
      const next = { ...state.meshDeformKeyframes };
      delete next[attachmentKey];
      return { meshDeformKeyframes: next };
    });
  },

  moveMeshDeformKeyframe: (attachmentKey, fromFrame, toFrame) => {
    if (fromFrame === toFrame) return;
    set((state) => {
      const kfs = state.meshDeformKeyframes[attachmentKey];
      const src = kfs?.[fromFrame];
      if (!kfs || !src) return state;
      const next = { ...kfs };
      delete next[fromFrame];
      next[toFrame] = { vertices: src.vertices.map((v) => ({ x: v.x, y: v.y })), easing: src.easing };
      return { meshDeformKeyframes: { ...state.meshDeformKeyframes, [attachmentKey]: next } };
    });
  },

  updateMeshDeformKeyframeEasing: (attachmentKey, frame, easing) => {
    set((state) => {
      const existing = state.meshDeformKeyframes[attachmentKey]?.[frame];
      if (!existing) return state;
      return {
        meshDeformKeyframes: {
          ...state.meshDeformKeyframes,
          [attachmentKey]: { ...state.meshDeformKeyframes[attachmentKey], [frame]: { ...existing, easing } },
        },
      };
    });
  },

  setAttachmentOpacityKeyframeAtFrame: (attachmentKey, frame, opacity) => {
    set((state) => ({
      attachmentOpacityKeyframes: {
        ...state.attachmentOpacityKeyframes,
        [attachmentKey]: {
          ...state.attachmentOpacityKeyframes[attachmentKey],
          [Math.max(0, Math.round(frame))]: {
            opacity: Math.min(1, Math.max(0, opacity)),
            easing:
              state.attachmentOpacityKeyframes[attachmentKey]?.[
                Math.max(0, Math.round(frame))
              ]?.easing ?? 'linear',
          },
        },
      },
    }));
  },

  setAttachmentOpacityKeyframe: (attachmentKey, opacity) => {
    set((state) => ({
      attachmentOpacityKeyframes: {
        ...state.attachmentOpacityKeyframes,
        [attachmentKey]: {
          ...state.attachmentOpacityKeyframes[attachmentKey],
          [state.frame]: {
            opacity: Math.min(1, Math.max(0, opacity)),
            easing:
              state.attachmentOpacityKeyframes[attachmentKey]?.[state.frame]?.easing ??
              'linear',
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

  moveAttachmentOpacityKeyframe: (attachmentKey, fromFrame, toFrame) => {
    if (fromFrame === toFrame) return;

    set((state) => {
      const attachmentKeyframes = state.attachmentOpacityKeyframes[attachmentKey];
      const sourceKeyframe = attachmentKeyframes?.[fromFrame];
      if (!attachmentKeyframes || !sourceKeyframe) return state;

      const nextAttachmentKeyframes = { ...attachmentKeyframes };
      delete nextAttachmentKeyframes[fromFrame];
      nextAttachmentKeyframes[toFrame] = sourceKeyframe;

      return {
        attachmentOpacityKeyframes: {
          ...state.attachmentOpacityKeyframes,
          [attachmentKey]: nextAttachmentKeyframes,
        },
      };
    });
  },

  updateAttachmentOpacityKeyframeEasing: (attachmentKey, frame, easing) => {
    set((state) => {
      const existing = state.attachmentOpacityKeyframes[attachmentKey]?.[frame];
      if (!existing) return state;

      return {
        attachmentOpacityKeyframes: {
          ...state.attachmentOpacityKeyframes,
          [attachmentKey]: {
            ...state.attachmentOpacityKeyframes[attachmentKey],
            [frame]: {
              ...existing,
              easing,
            },
          },
        },
      };
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

  setFrame: (frame) =>
    set((state) => (state.frame === frame ? state : { frame })),
  setDuration: (duration) => set({ duration }),
  setFps: (fps) => set({ fps }),
  setAudioTrack: (audioData, audioName) => {
    const track = get().addAudioTrack(audioData, audioName);
    set({
      audioTracks: [track],
      activeAudioTrackId: track.id,
      nextAudioTrackId: track.id + 1,
      audioData: track.dataUrl,
      audioName: track.name,
      audioVolume: track.volume,
      audioOffsetFrames: track.offsetFrames,
    });
  },
  addAudioTrack: (audioData, audioName) => {
    const state = get();
    const track: AudioTrack = {
      id: state.nextAudioTrackId,
      name: audioName,
      dataUrl: audioData,
      volume: 0.8,
      offsetFrames: 0,
    };
    set({
      audioTracks: [...state.audioTracks, track],
      activeAudioTrackId: track.id,
      nextAudioTrackId: track.id + 1,
      audioData: track.dataUrl,
      audioName: track.name,
      audioVolume: track.volume,
      audioOffsetFrames: track.offsetFrames,
    });
    return track;
  },
  removeAudioTrack: (trackId) =>
    set((state) => {
      const targetId = trackId ?? state.activeAudioTrackId ?? state.audioTracks.at(-1)?.id ?? null;
      const audioTracks = targetId === null
        ? state.audioTracks
        : state.audioTracks.filter((track) => track.id !== targetId);
      const activeTrack =
        audioTracks.find((track) => track.id === state.activeAudioTrackId) ??
        audioTracks.at(-1) ??
        null;
      return {
        audioTracks,
        activeAudioTrackId: activeTrack?.id ?? null,
        audioData: activeTrack?.dataUrl ?? null,
        audioName: activeTrack?.name ?? null,
        audioVolume: activeTrack?.volume ?? 0.8,
        audioOffsetFrames: activeTrack?.offsetFrames ?? 0,
      };
    }),
  clearAudioTrack: () =>
    set({
      audioTracks: [],
      activeAudioTrackId: null,
      audioData: null,
      audioName: null,
      audioVolume: 0.8,
      audioOffsetFrames: 0,
    }),
  setActiveAudioTrackId: (trackId) =>
    set((state) => {
      const activeTrack = state.audioTracks.find((track) => track.id === trackId) ?? null;
      return {
        activeAudioTrackId: activeTrack?.id ?? null,
        audioData: activeTrack?.dataUrl ?? null,
        audioName: activeTrack?.name ?? null,
        audioVolume: activeTrack?.volume ?? 0.8,
        audioOffsetFrames: activeTrack?.offsetFrames ?? 0,
      };
    }),
  setAudioVolume: (audioVolume, trackId) =>
    set((state) => {
      const targetId = trackId ?? state.activeAudioTrackId;
      const volume = Math.max(0, Math.min(1, audioVolume));
      const targetTrack = state.audioTracks.find((track) => track.id === targetId);
      if (targetTrack?.volume === volume) return state;
      const audioTracks = state.audioTracks.map((track) =>
        track.id === targetId ? { ...track, volume } : track,
      );
      const activeTrack = audioTracks.find((track) => track.id === state.activeAudioTrackId) ?? null;
      return {
        audioTracks,
        audioVolume: activeTrack?.volume ?? volume,
      };
    }),
  setAudioOffsetFrames: (audioOffsetFrames, trackId) =>
    set((state) => {
      const targetId = trackId ?? state.activeAudioTrackId;
      const offsetFrames = Math.max(0, Math.round(audioOffsetFrames));
      const targetTrack = state.audioTracks.find((track) => track.id === targetId);
      if (targetTrack?.offsetFrames === offsetFrames) return state;
      const audioTracks = state.audioTracks.map((track) =>
        track.id === targetId ? { ...track, offsetFrames } : track,
      );
      const activeTrack = audioTracks.find((track) => track.id === state.activeAudioTrackId) ?? null;
      return {
        audioTracks,
        audioOffsetFrames: activeTrack?.offsetFrames ?? offsetFrames,
      };
    }),
  play: () => set({ playing: true }),
  stop: () => set({ playing: false }),

  applyKeyframes: () => {
    const { keyframes, frame } = get();
    const { setupPose } = useSkeletonStore.getState();

    useSkeletonStore.setState((state) => ({
      bones: state.bones.map((bone) => {
        const boneKeyframes = keyframes[bone.id];

        // If no keyframes for this bone, restore setup pose
        if (!boneKeyframes) {
          const pose = setupPose[bone.id];
          if (pose) {
            return { ...bone, ...pose };
          }
          return bone;
        }

        const frames = getSortedFrames(boneKeyframes);

        if (frames.length === 0) {
          // No keyframes, restore setup pose
          const pose = setupPose[bone.id];
          if (pose) {
            return { ...bone, ...pose };
          }
          return bone;
        }

        let prev: number | null = null;
        let next: number | null = null;

        for (const f of frames) {
          if (f <= frame) prev = f;
          if (f >= frame && next === null) next = f;
        }

        // A keyframe written before out-of-plane rotation existed has no tilt of
        // its own, and that means zero — the same rule every other channel
        // follows. Without this the tilt would simply never animate: it would
        // stick at whatever value the bone was last dragged to.
        const withDefaults = (k: KeyframeData): KeyframeData => ({
          ...k,
          rotationX: k.rotationX ?? 0,
          rotationY: k.rotationY ?? 0,
          order: k.order ?? setupPose[bone.id]?.order ?? bone.order,
        });

        if (prev === null && next !== null) {
          return { ...bone, ...withDefaults(normalizeKeyframeData(boneKeyframes[next])) };
        } else if (prev !== null && next === null) {
          return { ...bone, ...withDefaults(normalizeKeyframeData(boneKeyframes[prev])) };
        } else if (prev !== null && next !== null) {
          const t = prev === next ? 1 : (frame - prev) / (next - prev);
          const easedT = useEditorStore.getState().inBetweenEnabled
            ? applyEasing(boneKeyframes[prev]?.easing, t)
            : 0;
          const kp = normalizeKeyframeData(boneKeyframes[prev]);
          const kn = normalizeKeyframeData(boneKeyframes[next]);
          const lerp = (a: number, b: number, ratio: number) => a + (b - a) * ratio;
          return {
            ...bone,
            x: lerp(kp.x, kn.x, easedT),
            y: lerp(kp.y, kn.y, easedT),
            rotation: lerp(kp.rotation, kn.rotation, easedT),
            rotationX: lerp(kp.rotationX ?? 0, kn.rotationX ?? 0, easedT),
            rotationY: lerp(kp.rotationY ?? 0, kn.rotationY ?? 0, easedT),
            scaleX: lerp(kp.scaleX, kn.scaleX, easedT),
            scaleY: lerp(kp.scaleY, kn.scaleY, easedT),
            order: kp.order ?? setupPose[bone.id]?.order ?? bone.order,
          };
        }

        return bone;
      }),
    }));
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
            ...kf,
            x: kf.x + delta.dx,
            y: kf.y + delta.dy,
            rotation: kf.rotation + delta.dRot,
            scaleX: kf.scaleX + delta.dScaleX,
            scaleY: kf.scaleY + delta.dScaleY,
            order: (kf.order ?? 0) + delta.dOrder,
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

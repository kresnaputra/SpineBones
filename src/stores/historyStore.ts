import { create } from 'zustand';
import { useAnimationStore } from './animationStore';
import { useCameraStore } from './cameraStore';
import { useDeformerStore } from './deformerStore';
import type { Bone } from '../types';
import { useEditorStore } from './editorStore';
import { usePhysicsStore } from './physicsStore';
import { useSkeletonStore } from './skeletonStore';
import { useSlotStore } from './slotStore';

const HISTORY_LIMIT = 100;

interface ProjectSnapshot {
  editor: {
    mode: ReturnType<typeof useEditorStore.getState>['mode'];
    selectedBoneId: ReturnType<typeof useEditorStore.getState>['selectedBoneId'];
    selectedBoneIds: ReturnType<typeof useEditorStore.getState>['selectedBoneIds'];
    selectedSlotId: ReturnType<typeof useEditorStore.getState>['selectedSlotId'];
    pixelArtEnabled: ReturnType<typeof useEditorStore.getState>['pixelArtEnabled'];
    pixelArtSize: ReturnType<typeof useEditorStore.getState>['pixelArtSize'];
    lineBoilEnabled: ReturnType<typeof useEditorStore.getState>['lineBoilEnabled'];
  };
  skeleton: {
    bones: ReturnType<typeof useSkeletonStore.getState>['bones'];
    boneGroups: ReturnType<typeof useSkeletonStore.getState>['boneGroups'];
    setupPose: ReturnType<typeof useSkeletonStore.getState>['setupPose'];
    skins: ReturnType<typeof useSkeletonStore.getState>['skins'];
    activeSkinId: ReturnType<typeof useSkeletonStore.getState>['activeSkinId'];
    ikChainRootIds: ReturnType<typeof useSkeletonStore.getState>['ikChainRootIds'];
    boneIdCounter: ReturnType<typeof useSkeletonStore.getState>['boneIdCounter'];
    boneGroupIdCounter: ReturnType<typeof useSkeletonStore.getState>['boneGroupIdCounter'];
    skinIdCounter: ReturnType<typeof useSkeletonStore.getState>['skinIdCounter'];
  };
  animation: {
    keyframes: ReturnType<typeof useAnimationStore.getState>['keyframes'];
    slotAttachmentKeyframes: ReturnType<typeof useAnimationStore.getState>['slotAttachmentKeyframes'];
    attachmentOpacityKeyframes: ReturnType<typeof useAnimationStore.getState>['attachmentOpacityKeyframes'];
    meshDeformKeyframes: ReturnType<typeof useAnimationStore.getState>['meshDeformKeyframes'];
    frame: ReturnType<typeof useAnimationStore.getState>['frame'];
    duration: ReturnType<typeof useAnimationStore.getState>['duration'];
    fps: ReturnType<typeof useAnimationStore.getState>['fps'];
    audioTracks: ReturnType<typeof useAnimationStore.getState>['audioTracks'];
    activeAudioTrackId: ReturnType<typeof useAnimationStore.getState>['activeAudioTrackId'];
    nextAudioTrackId: ReturnType<typeof useAnimationStore.getState>['nextAudioTrackId'];
    audioData: ReturnType<typeof useAnimationStore.getState>['audioData'];
    audioName: ReturnType<typeof useAnimationStore.getState>['audioName'];
    audioVolume: ReturnType<typeof useAnimationStore.getState>['audioVolume'];
    audioOffsetFrames: ReturnType<typeof useAnimationStore.getState>['audioOffsetFrames'];
  };
  slots: {
    slots: ReturnType<typeof useSlotStore.getState>['slots'];
    attachments: ReturnType<typeof useSlotStore.getState>['attachments'];
    nextSlotId: ReturnType<typeof useSlotStore.getState>['nextSlotId'];
  };
  camera: {
    x: ReturnType<typeof useCameraStore.getState>['x'];
    y: ReturnType<typeof useCameraStore.getState>['y'];
    zoom: ReturnType<typeof useCameraStore.getState>['zoom'];
  };
  deformers: {
    deformers: ReturnType<typeof useDeformerStore.getState>['deformers'];
    nextDeformerId: ReturnType<typeof useDeformerStore.getState>['nextDeformerId'];
    deformerKeyframes: ReturnType<typeof useDeformerStore.getState>['deformerKeyframes'];
  };
  physics: {
    configs: ReturnType<typeof usePhysicsStore.getState>['configs'];
  };
}

interface HistoryState {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  isApplying: boolean;
  isDirty: boolean;
  captureSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  markClean: () => void;
}

/**
 * Drop the transient world frame before a bone is serialised.
 *
 * `_wm` is recomputed from the pose on every render, so persisting it is pure
 * waste — 16 numbers per bone in every undo step and every saved project.
 */
const stripWorldFrame = (bone: Bone): Bone => {
  if (!bone._wm) return bone;
  const copy = { ...bone };
  delete copy._wm;
  return copy;
};

const cloneSnapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createProjectSnapshot = (): ProjectSnapshot => {
  const editor = useEditorStore.getState();
  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  const slot = useSlotStore.getState();
  const camera = useCameraStore.getState();
  const deformerState = useDeformerStore.getState();
  const physicsState = usePhysicsStore.getState();

  return cloneSnapshot({
    editor: {
      mode: editor.mode,
      selectedBoneId: editor.selectedBoneId,
      selectedBoneIds: editor.selectedBoneIds,
      selectedSlotId: editor.selectedSlotId,
      pixelArtEnabled: editor.pixelArtEnabled,
      pixelArtSize: editor.pixelArtSize,
      lineBoilEnabled: editor.lineBoilEnabled,
    },
    skeleton: {
      // `_wm` is a transient render frame, recomputed every pose. Keeping it out
      // of the snapshot avoids 16 numbers per bone in every undo step.
      bones: skeleton.bones.map((bone) => stripWorldFrame(bone)),
      boneGroups: skeleton.boneGroups,
      setupPose: skeleton.setupPose,
      skins: skeleton.skins,
      activeSkinId: skeleton.activeSkinId,
      ikChainRootIds: skeleton.ikChainRootIds,
      boneIdCounter: skeleton.boneIdCounter,
      boneGroupIdCounter: skeleton.boneGroupIdCounter,
      skinIdCounter: skeleton.skinIdCounter,
    },
    animation: {
      keyframes: animation.keyframes,
      slotAttachmentKeyframes: animation.slotAttachmentKeyframes,
      attachmentOpacityKeyframes: animation.attachmentOpacityKeyframes,
      meshDeformKeyframes: animation.meshDeformKeyframes,
      frame: animation.frame,
      duration: animation.duration,
      fps: animation.fps,
      audioTracks: animation.audioTracks,
      activeAudioTrackId: animation.activeAudioTrackId,
      nextAudioTrackId: animation.nextAudioTrackId,
      audioData: animation.audioData,
      audioName: animation.audioName,
      audioVolume: animation.audioVolume,
      audioOffsetFrames: animation.audioOffsetFrames,
    },
    slots: {
      slots: slot.slots,
      attachments: slot.attachments,
      nextSlotId: slot.nextSlotId,
    },
    camera: {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
    },
    deformers: {
      deformers: deformerState.deformers,
      nextDeformerId: deformerState.nextDeformerId,
      deformerKeyframes: deformerState.deformerKeyframes,
    },
    physics: {
      configs: physicsState.configs,
    },
  });
};

const applyProjectSnapshot = (snapshot: ProjectSnapshot) => {
  useEditorStore.setState({
    mode: snapshot.editor.mode,
    selectedBoneId: snapshot.editor.selectedBoneId,
    selectedBoneIds: cloneSnapshot(snapshot.editor.selectedBoneIds),
    selectedSlotId: snapshot.editor.selectedSlotId,
    pixelArtEnabled: snapshot.editor.pixelArtEnabled ?? true,
    pixelArtSize: snapshot.editor.pixelArtSize ?? 4,
    lineBoilEnabled: snapshot.editor.lineBoilEnabled ?? true,
  });
  useSkeletonStore.setState({
    bones: cloneSnapshot(snapshot.skeleton.bones),
    boneGroups: cloneSnapshot(snapshot.skeleton.boneGroups),
    setupPose: cloneSnapshot(snapshot.skeleton.setupPose),
    skins: cloneSnapshot(snapshot.skeleton.skins),
    activeSkinId: snapshot.skeleton.activeSkinId,
    ikChainRootIds: cloneSnapshot(snapshot.skeleton.ikChainRootIds),
    boneIdCounter: snapshot.skeleton.boneIdCounter,
    boneGroupIdCounter: snapshot.skeleton.boneGroupIdCounter,
    skinIdCounter: snapshot.skeleton.skinIdCounter,
  });
  useAnimationStore.setState({
    keyframes: cloneSnapshot(snapshot.animation.keyframes),
    slotAttachmentKeyframes: cloneSnapshot(snapshot.animation.slotAttachmentKeyframes),
    attachmentOpacityKeyframes: cloneSnapshot(snapshot.animation.attachmentOpacityKeyframes),
    meshDeformKeyframes: cloneSnapshot(snapshot.animation.meshDeformKeyframes ?? {}),
    frame: snapshot.animation.frame,
    duration: snapshot.animation.duration,
    fps: snapshot.animation.fps,
    audioTracks: cloneSnapshot(snapshot.animation.audioTracks ?? []),
    activeAudioTrackId: snapshot.animation.activeAudioTrackId ?? null,
    nextAudioTrackId: snapshot.animation.nextAudioTrackId ?? 1,
    audioData: snapshot.animation.audioData,
    audioName: snapshot.animation.audioName,
    audioVolume: snapshot.animation.audioVolume,
    audioOffsetFrames: snapshot.animation.audioOffsetFrames,
    playing: false,
  });
  useSlotStore.setState({
    slots: cloneSnapshot(snapshot.slots.slots),
    attachments: cloneSnapshot(snapshot.slots.attachments),
    nextSlotId: snapshot.slots.nextSlotId,
  });
  useCameraStore.setState({
    x: snapshot.camera.x,
    y: snapshot.camera.y,
    zoom: snapshot.camera.zoom,
  });
  useDeformerStore.setState({
    deformers: cloneSnapshot(snapshot.deformers?.deformers ?? []),
    nextDeformerId: snapshot.deformers?.nextDeformerId ?? 1,
    deformerKeyframes: cloneSnapshot(snapshot.deformers?.deformerKeyframes ?? {}),
  });
  usePhysicsStore.getState().replaceAll(cloneSnapshot(snapshot.physics?.configs ?? []));
};

const isSameSnapshot = (a: ProjectSnapshot | undefined, b: ProjectSnapshot) => {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  isApplying: false,
  isDirty: false,

  captureSnapshot: () => {
    if (get().isApplying) return;

    const snapshot = createProjectSnapshot();

    set((state) => {
      if (isSameSnapshot(state.past[state.past.length - 1], snapshot)) {
        return state;
      }

      const nextPast = [...state.past, snapshot];
      return {
        past: nextPast.slice(-HISTORY_LIMIT),
        future: [],
        isDirty: true,
      };
    });
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const current = createProjectSnapshot();

    set({ isApplying: true });
    applyProjectSnapshot(previous);
    set({
      isApplying: false,
      past: past.slice(0, -1),
      future: [current, ...future].slice(0, HISTORY_LIMIT),
    });
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;

    const next = future[0];
    const current = createProjectSnapshot();

    set({ isApplying: true });
    applyProjectSnapshot(next);
    set({
      isApplying: false,
      past: [...past, current].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    });
  },

  clearHistory: () => set({ past: [], future: [], isDirty: false }),
  markClean: () => set({ isDirty: false }),
}));

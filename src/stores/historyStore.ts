import { create } from 'zustand';
import { useAnimationStore } from './animationStore';
import { useCameraStore } from './cameraStore';
import { useEditorStore } from './editorStore';
import { useSkeletonStore } from './skeletonStore';
import { useSlotStore } from './slotStore';

const HISTORY_LIMIT = 100;

interface ProjectSnapshot {
  editor: {
    mode: ReturnType<typeof useEditorStore.getState>['mode'];
    selectedBoneId: ReturnType<typeof useEditorStore.getState>['selectedBoneId'];
    selectedBoneIds: ReturnType<typeof useEditorStore.getState>['selectedBoneIds'];
    selectedSlotId: ReturnType<typeof useEditorStore.getState>['selectedSlotId'];
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
    meshDeformKeyframes: ReturnType<typeof useAnimationStore.getState>['meshDeformKeyframes'];
    attachmentOpacityKeyframes: ReturnType<typeof useAnimationStore.getState>['attachmentOpacityKeyframes'];
    frame: ReturnType<typeof useAnimationStore.getState>['frame'];
    duration: ReturnType<typeof useAnimationStore.getState>['duration'];
    fps: ReturnType<typeof useAnimationStore.getState>['fps'];
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
}

interface HistoryState {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  isApplying: boolean;
  captureSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

const cloneSnapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createProjectSnapshot = (): ProjectSnapshot => {
  const editor = useEditorStore.getState();
  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  const slot = useSlotStore.getState();
  const camera = useCameraStore.getState();

  return cloneSnapshot({
    editor: {
      mode: editor.mode,
      selectedBoneId: editor.selectedBoneId,
      selectedBoneIds: editor.selectedBoneIds,
      selectedSlotId: editor.selectedSlotId,
    },
    skeleton: {
      bones: skeleton.bones,
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
      meshDeformKeyframes: animation.meshDeformKeyframes,
      attachmentOpacityKeyframes: animation.attachmentOpacityKeyframes,
      frame: animation.frame,
      duration: animation.duration,
      fps: animation.fps,
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
  });
};

const applyProjectSnapshot = (snapshot: ProjectSnapshot) => {
  useEditorStore.setState({
    mode: snapshot.editor.mode,
    selectedBoneId: snapshot.editor.selectedBoneId,
    selectedBoneIds: cloneSnapshot(snapshot.editor.selectedBoneIds),
    selectedSlotId: snapshot.editor.selectedSlotId,
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
    meshDeformKeyframes: cloneSnapshot(snapshot.animation.meshDeformKeyframes),
    attachmentOpacityKeyframes: cloneSnapshot(snapshot.animation.attachmentOpacityKeyframes),
    frame: snapshot.animation.frame,
    duration: snapshot.animation.duration,
    fps: snapshot.animation.fps,
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
};

const isSameSnapshot = (a: ProjectSnapshot | undefined, b: ProjectSnapshot) => {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  isApplying: false,

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

  clearHistory: () => set({ past: [], future: [] }),
}));

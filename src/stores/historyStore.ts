import { create } from 'zustand';
import { useAnimationStore } from './animationStore';
import { useCameraStore } from './cameraStore';
import { useEditorStore } from './editorStore';
import { useSkeletonStore } from './skeletonStore';

const HISTORY_LIMIT = 100;

interface ProjectSnapshot {
  editor: {
    mode: ReturnType<typeof useEditorStore.getState>['mode'];
    selectedBoneId: ReturnType<typeof useEditorStore.getState>['selectedBoneId'];
    selectedBoneIds: ReturnType<typeof useEditorStore.getState>['selectedBoneIds'];
  };
  skeleton: {
    bones: ReturnType<typeof useSkeletonStore.getState>['bones'];
    skins: ReturnType<typeof useSkeletonStore.getState>['skins'];
    activeSkinId: ReturnType<typeof useSkeletonStore.getState>['activeSkinId'];
    boneIdCounter: ReturnType<typeof useSkeletonStore.getState>['boneIdCounter'];
    skinIdCounter: ReturnType<typeof useSkeletonStore.getState>['skinIdCounter'];
  };
  animation: {
    keyframes: ReturnType<typeof useAnimationStore.getState>['keyframes'];
    frame: ReturnType<typeof useAnimationStore.getState>['frame'];
    duration: ReturnType<typeof useAnimationStore.getState>['duration'];
    fps: ReturnType<typeof useAnimationStore.getState>['fps'];
    audioData: ReturnType<typeof useAnimationStore.getState>['audioData'];
    audioName: ReturnType<typeof useAnimationStore.getState>['audioName'];
    audioVolume: ReturnType<typeof useAnimationStore.getState>['audioVolume'];
    audioOffsetFrames: ReturnType<typeof useAnimationStore.getState>['audioOffsetFrames'];
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
  const camera = useCameraStore.getState();

  return cloneSnapshot({
    editor: {
      mode: editor.mode,
      selectedBoneId: editor.selectedBoneId,
      selectedBoneIds: editor.selectedBoneIds,
    },
    skeleton: {
      bones: skeleton.bones,
      skins: skeleton.skins,
      activeSkinId: skeleton.activeSkinId,
      boneIdCounter: skeleton.boneIdCounter,
      skinIdCounter: skeleton.skinIdCounter,
    },
    animation: {
      keyframes: animation.keyframes,
      frame: animation.frame,
      duration: animation.duration,
      fps: animation.fps,
      audioData: animation.audioData,
      audioName: animation.audioName,
      audioVolume: animation.audioVolume,
      audioOffsetFrames: animation.audioOffsetFrames,
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
  });
  useSkeletonStore.setState({
    bones: cloneSnapshot(snapshot.skeleton.bones),
    skins: cloneSnapshot(snapshot.skeleton.skins),
    activeSkinId: snapshot.skeleton.activeSkinId,
    boneIdCounter: snapshot.skeleton.boneIdCounter,
    skinIdCounter: snapshot.skeleton.skinIdCounter,
  });
  useAnimationStore.setState({
    keyframes: cloneSnapshot(snapshot.animation.keyframes),
    frame: snapshot.animation.frame,
    duration: snapshot.animation.duration,
    fps: snapshot.animation.fps,
    audioData: snapshot.animation.audioData,
    audioName: snapshot.animation.audioName,
    audioVolume: snapshot.animation.audioVolume,
    audioOffsetFrames: snapshot.animation.audioOffsetFrames,
    playing: false,
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

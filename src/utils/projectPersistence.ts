import { useAnimationStore } from '../stores/animationStore';
import { useCameraStore } from '../stores/cameraStore';
import { useEditorStore } from '../stores/editorStore';
import { useHistoryStore } from '../stores/historyStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useSlotStore } from '../stores/slotStore';
import type { ProjectData } from '../types';
import {
  getFileNameFromPath,
  openTextFile,
  saveTextFile,
  stripExtension,
} from './nativeIO';

const PROJECT_FILTERS = [
  {
    name: 'SpineBones Project',
    extensions: ['json'],
  },
];

export const buildProjectData = (): ProjectData => {
  const skeletonState = useSkeletonStore.getState();
  const animationState = useAnimationStore.getState();
  const slotState = useSlotStore.getState();
  const editorState = useEditorStore.getState();

  // Normalize keyframes so the earliest frame across all bones becomes frame 0
  const originalKeyframes = animationState.keyframes;
  let minFrame = Infinity;
  for (const boneId of Object.keys(originalKeyframes)) {
    for (const frame of Object.keys(originalKeyframes[Number(boneId)])) {
      minFrame = Math.min(minFrame, Number(frame));
    }
  }
  const normalizedKeyframes: typeof originalKeyframes = {};
  if (minFrame !== Infinity && minFrame > 0) {
    for (const boneIdStr of Object.keys(originalKeyframes)) {
      const boneId = Number(boneIdStr);
      normalizedKeyframes[boneId] = {};
      for (const frameStr of Object.keys(originalKeyframes[boneId])) {
        const frame = Number(frameStr);
        normalizedKeyframes[boneId][frame - minFrame] = originalKeyframes[boneId][frame];
      }
    }
  } else {
    Object.assign(normalizedKeyframes, originalKeyframes);
  }

  // Save bones with their setup pose positions, not current animation positions
  const savedBones = skeletonState.bones.map((bone) => {
    const pose = skeletonState.setupPose[bone.id];
    if (pose) {
      return { ...bone, ...pose };
    }
    return bone;
  });

  return {
    version: '1.1',
    bones: savedBones,
    skins: skeletonState.skins,
    activeSkinId: skeletonState.activeSkinId,
    ikChainRootIds: skeletonState.ikChainRootIds.filter((rootId) =>
      savedBones.some((bone) => bone.id === rootId) &&
      savedBones.filter((bone) => bone.parentId === rootId).length === 1,
    ),
    setupPose: skeletonState.setupPose,
    slots: slotState.slots,
    attachments: slotState.attachments,
    keyframes: normalizedKeyframes,
    duration: animationState.duration,
    fps: animationState.fps,
    backgroundImage: editorState.backgroundImage,
    audioData: animationState.audioData,
    audioName: animationState.audioName,
    audioVolume: animationState.audioVolume,
    audioOffsetFrames: animationState.audioOffsetFrames,
  };
};

export const applyProjectData = (
  projectData: Partial<ProjectData>,
  sourcePath: string | null,
) => {
  const bones = projectData.bones ?? [];
  const skins = projectData.skins ?? [{ id: 0, name: 'default', color: '#7c3aed' }];
  const slots = projectData.slots ?? [];

  useSkeletonStore.setState({
    bones,
    skins,
    activeSkinId: projectData.activeSkinId ?? skins[0]?.id ?? 0,
    ikChainRootIds: projectData.ikChainRootIds ?? [],
    setupPose: projectData.setupPose ?? {},
    boneIdCounter: Math.max(...bones.map((bone) => bone.id), 0) + 1,
    skinIdCounter: Math.max(...skins.map((skin) => skin.id), 0) + 1,
  });

  useSlotStore.setState({
    slots,
    attachments: projectData.attachments ?? [],
    nextSlotId: Math.max(...slots.map((slot) => slot.id), 0) + 1,
  });

  useAnimationStore.setState({
    keyframes: projectData.keyframes ?? {},
    duration: projectData.duration ?? 60,
    fps: projectData.fps ?? 24,
    frame: 0,
    playing: false,
    audioData: projectData.audioData ?? null,
    audioName: projectData.audioName ?? null,
    audioVolume: projectData.audioVolume ?? 0.8,
    audioOffsetFrames: projectData.audioOffsetFrames ?? 0,
  });

  useEditorStore.setState({
    backgroundImage: projectData.backgroundImage ?? null,
    currentProjectPath: sourcePath,
    selectedBoneId: null,
    selectedBoneIds: [],
  });

  if (!projectData.setupPose || Object.keys(projectData.setupPose).length === 0) {
    useSkeletonStore.getState().saveSetupPose();
  }

  // Restore bones to setup pose so they display correctly at frame 0
  useSkeletonStore.getState().restoreSetupPose();

  useHistoryStore.getState().clearHistory();
};

export const createNewProject = () => {
  useSkeletonStore.setState({
    bones: [],
    skins: [{ id: 0, name: 'default', color: '#7c3aed' }],
    activeSkinId: 0,
    ikChainRootIds: [],
    setupPose: {},
    boneIdCounter: 0,
    skinIdCounter: 1,
  });

  useSlotStore.setState({
    slots: [],
    attachments: [],
    nextSlotId: 1,
  });

  useAnimationStore.setState({
    keyframes: {},
    frame: 0,
    duration: 60,
    fps: 24,
    playing: false,
    audioData: null,
    audioName: null,
    audioVolume: 0.8,
    audioOffsetFrames: 0,
  });

  useEditorStore.setState((state) => ({
    tool: 'pose',
    mode: 'setup',
    selectedBoneId: null,
    selectedBoneIds: [],
    showBoneIndicators: state.showBoneIndicators,
    attachmentDragEnabled: false,
    backgroundImage: null,
    currentProjectPath: null,
  }));

  useCameraStore.setState((state) => ({
    x: 0,
    y: 0,
    zoom: 1,
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
  }));

  useHistoryStore.getState().clearHistory();
};

export const getSuggestedProjectFileName = () => {
  const currentProjectPath = useEditorStore.getState().currentProjectPath;
  if (!currentProjectPath) return 'spinebones-project.json';

  return `${stripExtension(getFileNameFromPath(currentProjectPath))}.json`;
};

export const saveProject = async (forceDialog = false) => {
  const projectData = buildProjectData();
  const currentProjectPath = useEditorStore.getState().currentProjectPath;
  const targetPath = await saveTextFile(
    getSuggestedProjectFileName(),
    JSON.stringify(projectData, null, 2),
    PROJECT_FILTERS,
    currentProjectPath,
    forceDialog,
  );

  if (targetPath) {
    useEditorStore.getState().setCurrentProjectPath(targetPath);
  }

  return targetPath;
};

export const loadProject = async () => {
  const loadedProject = await openTextFile('.json,application/json', {
    filters: PROJECT_FILTERS,
  });

  if (!loadedProject) return null;

  applyProjectData(JSON.parse(loadedProject.text) as ProjectData, loadedProject.path);
  return loadedProject.path;
};

import { useAnimationStore } from '../stores/animationStore';
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
    name: 'Spine Web Project',
    extensions: ['json'],
  },
];

export const buildProjectData = (): ProjectData => {
  const skeletonState = useSkeletonStore.getState();
  const animationState = useAnimationStore.getState();
  const slotState = useSlotStore.getState();
  const editorState = useEditorStore.getState();

  return {
    version: '1.1',
    bones: skeletonState.bones,
    skins: skeletonState.skins,
    activeSkinId: skeletonState.activeSkinId,
    setupPose: skeletonState.setupPose,
    slots: slotState.slots,
    attachments: slotState.attachments,
    keyframes: animationState.keyframes,
    duration: animationState.duration,
    fps: animationState.fps,
    backgroundImage: editorState.backgroundImage,
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
  });

  useEditorStore.setState({
    backgroundImage: projectData.backgroundImage ?? null,
    currentProjectPath: sourcePath,
    selectedBoneId: null,
  });

  if (!projectData.setupPose || Object.keys(projectData.setupPose).length === 0) {
    useSkeletonStore.getState().saveSetupPose();
  }

  useHistoryStore.getState().clearHistory();
};

export const getSuggestedProjectFileName = () => {
  const currentProjectPath = useEditorStore.getState().currentProjectPath;
  if (!currentProjectPath) return 'spine-project.json';

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

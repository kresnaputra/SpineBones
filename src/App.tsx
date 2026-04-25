import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EditorLayout } from './components/layout/EditorLayout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAnimationStore } from './stores/animationStore';
import { useEditorStore } from './stores/editorStore';
import { useSkeletonStore } from './stores/skeletonStore';
import { useSlotStore } from './stores/slotStore';
import { useCameraStore } from './stores/cameraStore';
import { useHistoryStore } from './stores/historyStore';
import { ensureDesktopMenu } from './utils/desktopMenu';
import { computeAllWorldTransforms } from './engine/transforms';
import { getIkChain, solveTwoBoneIk } from './utils/ik';
import {
  getFileNameFromPath,
  getLaunchProjectPath,
  getMcpBridgeInfo,
  isDesktopApp,
  loadAudioFileFromPath,
  loadImageFileFromPath,
  saveBlobToPath,
  updateMcpEditorState,
} from './utils/nativeIO';
import {
  createNewProject,
  getSuggestedProjectFileName,
  loadProject,
  loadProjectFromPath,
  saveProject,
} from './utils/projectPersistence';
import { clearRecentProjects, getRecentProjects, removeRecentProject } from './utils/recentProjects';
import { exportSpriteSheet } from './utils/spriteSheetExporter';
import { exportPngSequence } from './utils/pngSequenceExporter';
import { exportVideo } from './utils/videoExporter';
import type { Attachment, Mode, Tool } from './types';
import { applyRagAnimation, runRagPipeline } from './thesis/ragPipeline';

type McpEditorCommand = {
  commandType: string;
  mode?: Mode;
  tool?: Tool;
  prompt?: string;
  path?: string;
  outputPath?: string;
  name?: string;
  color?: string;
  value?: string | number | boolean | null;
  boneId?: number;
  boneName?: string;
  parentBoneId?: number;
  parentBoneName?: string;
  groupId?: number;
  groupName?: string;
  skinId?: number;
  skinName?: string;
  slotId?: number;
  slotName?: string;
  attachmentName?: string;
  attachmentPath?: string;
  drawOrder?: number;
  frame?: number;
  startFrame?: number;
  endFrame?: number;
  keyframeFrame?: number;
  duration?: number;
  fps?: number;
  x?: number;
  y?: number;
  rotation?: number;
  zoom?: number;
  factor?: number;
  volume?: number;
  offsetFrames?: number;
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  forceDialog?: boolean;
  boneIds?: number[];
  transforms?: Array<{
    boneId?: number;
    boneName?: string;
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
  }>;
  attachments?: Array<{
    slotId?: number;
    slotName?: string;
    boneId?: number;
    boneName?: string;
    name?: string;
    path?: string;
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
  }>;
  keyframes?: Array<{
    boneId?: number;
    boneName?: string;
    frame?: number;
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  }>;
  transform?: {
    x?: number;
    y?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  };
};

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

const resolveTargetBoneId = (boneId?: number, boneName?: string) => {
  const { bones } = useSkeletonStore.getState();

  if (typeof boneId === 'number') {
    return bones.some((bone) => bone.id === boneId) ? boneId : null;
  }

  if (boneName) {
    const normalized = boneName.trim().toLowerCase();
    const match = bones.find((bone) => bone.name.trim().toLowerCase() === normalized);
    return match?.id ?? null;
  }

  return null;
};

const isDescendantOfBone = (bones: ReturnType<typeof useSkeletonStore.getState>['bones'], boneId: number, ancestorId: number) => {
  let current = bones.find((bone) => bone.id === boneId) ?? null;
  while (current) {
    const parentId = current.parentId;
    if (parentId === null) return false;
    if (parentId === ancestorId) return true;
    current = bones.find((bone) => bone.id === parentId) ?? null;
  }
  return false;
};

const applyFrameIfNeeded = () => {
  const animation = useAnimationStore.getState();
  if (useEditorStore.getState().mode === 'animate') {
    animation.applyKeyframes();
  }
};

const setBoneTransformFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) {
    throw new Error('Bone not found for set_bone_transform');
  }

  const transform = payload.transform ?? {};
  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  const existingBone = skeleton.getBoneById(boneId);

  if (!existingBone) {
    throw new Error('Bone not found for set_bone_transform');
  }

  skeleton.updateBone(boneId, {
    x: transform.x ?? existingBone.x,
    y: transform.y ?? existingBone.y,
    rotation: transform.rotation ?? existingBone.rotation,
    scaleX: transform.scaleX ?? existingBone.scaleX,
    scaleY: transform.scaleY ?? existingBone.scaleY,
  });

  if (editor.mode === 'setup') {
    skeleton.updateSetupPoseBone(boneId, {
      x: transform.x ?? existingBone.x,
      y: transform.y ?? existingBone.y,
      rotation: transform.rotation ?? existingBone.rotation,
      scaleX: transform.scaleX ?? existingBone.scaleX,
      scaleY: transform.scaleY ?? existingBone.scaleY,
    });
  }

  editor.selectBone(boneId);
  applyFrameIfNeeded();

  return { ok: true, boneId };
};

const setBoneKeyframeFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) {
    throw new Error('Bone not found for set_keyframe');
  }

  const animation = useAnimationStore.getState();
  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  const existingBone = skeleton.getBoneById(boneId);

  if (!existingBone) {
    throw new Error('Bone not found for set_keyframe');
  }

  const targetFrame =
    typeof payload.frame === 'number'
      ? Math.max(0, Math.min(animation.duration, Math.round(payload.frame)))
      : animation.frame;

  animation.setFrame(targetFrame);

  const transform = payload.transform ?? {};
  const frameData = {
    x: transform.x ?? existingBone.x,
    y: transform.y ?? existingBone.y,
    rotation: transform.rotation ?? existingBone.rotation,
    scaleX: transform.scaleX ?? existingBone.scaleX,
    scaleY: transform.scaleY ?? existingBone.scaleY,
    easing: transform.easing ?? 'linear',
  };

  animation.insertKeyframe(boneId, frameData);
  editor.selectBone(boneId);
  animation.applyKeyframes();

  return { ok: true, boneId, frame: targetFrame };
};

const removeBoneKeyframeFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) {
    throw new Error('Bone not found for remove_keyframe');
  }

  const animation = useAnimationStore.getState();
  const targetFrame =
    typeof payload.frame === 'number'
      ? Math.max(0, Math.min(animation.duration, Math.round(payload.frame)))
      : animation.frame;

  animation.deleteKeyframe(boneId, targetFrame);
  animation.applyKeyframes();

  return { ok: true, boneId, frame: targetFrame };
};

const setMultipleBoneTransformsFromCommand = (payload: McpEditorCommand) => {
  const transforms = payload.transforms ?? [];
  if (transforms.length === 0) {
    throw new Error('No transforms supplied for set_multiple_bone_transforms');
  }

  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  const updatedBoneIds: number[] = [];

  transforms.forEach((entry) => {
    const boneId = resolveTargetBoneId(entry.boneId, entry.boneName);
    if (boneId === null) {
      throw new Error(`Bone not found for set_multiple_bone_transforms: ${entry.boneName ?? entry.boneId ?? 'unknown'}`);
    }

    const existingBone = skeleton.getBoneById(boneId);
    if (!existingBone) {
      throw new Error(`Bone not found for set_multiple_bone_transforms: ${boneId}`);
    }

    const nextPose = {
      x: entry.x ?? existingBone.x,
      y: entry.y ?? existingBone.y,
      rotation: entry.rotation ?? existingBone.rotation,
      scaleX: entry.scaleX ?? existingBone.scaleX,
      scaleY: entry.scaleY ?? existingBone.scaleY,
    };

    skeleton.updateBone(boneId, nextPose);
    if (editor.mode === 'setup') {
      skeleton.updateSetupPoseBone(boneId, nextPose);
    }

    updatedBoneIds.push(boneId);
  });

  if (updatedBoneIds.length > 0) {
    editor.selectBone(updatedBoneIds[updatedBoneIds.length - 1] ?? null);
  }
  applyFrameIfNeeded();

  return { ok: true, updatedBoneIds, count: updatedBoneIds.length };
};

const setMultipleKeyframesFromCommand = (payload: McpEditorCommand) => {
  const keyframes = payload.keyframes ?? [];
  if (keyframes.length === 0) {
    throw new Error('No keyframes supplied for set_multiple_keyframes');
  }

  const animation = useAnimationStore.getState();
  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  const originalFrame = animation.frame;
  const written: Array<{ boneId: number; frame: number }> = [];

  keyframes.forEach((entry) => {
    const boneId = resolveTargetBoneId(entry.boneId, entry.boneName);
    if (boneId === null) {
      throw new Error(`Bone not found for set_multiple_keyframes: ${entry.boneName ?? entry.boneId ?? 'unknown'}`);
    }

    const existingBone = skeleton.getBoneById(boneId);
    if (!existingBone) {
      throw new Error(`Bone not found for set_multiple_keyframes: ${boneId}`);
    }

    const targetFrame =
      typeof entry.frame === 'number'
        ? Math.max(0, Math.min(animation.duration, Math.round(entry.frame)))
        : animation.frame;
    animation.setFrame(targetFrame);
    animation.insertKeyframe(boneId, {
      x: entry.x ?? existingBone.x,
      y: entry.y ?? existingBone.y,
      rotation: entry.rotation ?? existingBone.rotation,
      scaleX: entry.scaleX ?? existingBone.scaleX,
      scaleY: entry.scaleY ?? existingBone.scaleY,
      easing: entry.easing ?? 'linear',
    });
    written.push({ boneId, frame: targetFrame });
  });

  animation.setFrame(originalFrame);
  editor.selectBone(written[written.length - 1]?.boneId ?? null);
  animation.applyKeyframes();

  return { ok: true, count: written.length, written };
};

const clearAnimationRangeFromCommand = (payload: McpEditorCommand) => {
  const animation = useAnimationStore.getState();
  const startFrame = Math.max(0, Math.round(payload.startFrame ?? 0));
  const endFrame = Math.max(startFrame, Math.round(payload.endFrame ?? animation.duration));
  const keyframes = animation.keyframes;
  let removedCount = 0;

  Object.entries(keyframes).forEach(([boneIdString, boneKeyframes]) => {
    const boneId = Number(boneIdString);
    Object.keys(boneKeyframes)
      .map(Number)
      .filter((frame) => frame >= startFrame && frame <= endFrame)
      .forEach((frame) => {
        animation.deleteKeyframe(boneId, frame);
        removedCount += 1;
      });
  });

  animation.applyKeyframes();
  return { ok: true, startFrame, endFrame, removedCount };
};

const duplicateKeyframeFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) {
    throw new Error('Bone not found for duplicate_keyframe');
  }

  const animation = useAnimationStore.getState();
  const sourceFrame =
    typeof payload.frame === 'number'
      ? Math.max(0, Math.min(animation.duration, Math.round(payload.frame)))
      : animation.frame;
  const targetFrame =
    typeof payload.keyframeFrame === 'number'
      ? Math.max(0, Math.min(animation.duration, Math.round(payload.keyframeFrame)))
      : typeof payload.endFrame === 'number'
        ? Math.max(0, Math.min(animation.duration, Math.round(payload.endFrame)))
        : null;

  if (targetFrame === null) {
    throw new Error('Target frame missing for duplicate_keyframe');
  }

  const sourceKeyframe = animation.keyframes[boneId]?.[sourceFrame];
  if (!sourceKeyframe) {
    throw new Error(`No keyframe found at frame ${sourceFrame} for duplicate_keyframe`);
  }

  const originalFrame = animation.frame;
  animation.setFrame(targetFrame);
  animation.insertKeyframe(boneId, { ...sourceKeyframe });
  animation.setFrame(originalFrame);
  animation.applyKeyframes();

  return { ok: true, boneId, sourceFrame, targetFrame };
};

const setBoneParentFromCommand = (payload: McpEditorCommand) => {
  const editor = useEditorStore.getState();
  if (editor.mode !== 'setup') {
    throw new Error('Parent relationships can only be changed in Setup mode');
  }

  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  const childId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (childId === null) {
    throw new Error('Bone not found for set_bone_parent');
  }

  const child = skeleton.getBoneById(childId);
  if (!child) {
    throw new Error('Bone not found for set_bone_parent');
  }

  const hasParentTarget =
    typeof payload.parentBoneId === 'number' ||
    typeof payload.parentBoneName === 'string';
  const newParentId = hasParentTarget
    ? resolveTargetBoneId(payload.parentBoneId, payload.parentBoneName)
    : null;

  if (hasParentTarget && newParentId === null) {
    throw new Error('Parent bone not found for set_bone_parent');
  }

  const newParent =
    newParentId === null ? null : skeleton.getBoneById(newParentId) ?? null;
  if (newParent && child.id === newParent.id) {
    throw new Error('A bone cannot be parented to itself');
  }
  if (newParent && isDescendantOfBone(skeleton.bones, newParent.id, child.id)) {
    throw new Error('Parent change would create a cycle');
  }
  if (child.parentId === newParentId) {
    return { ok: true, boneId: child.id, parentId: newParentId, unchanged: true };
  }

  computeAllWorldTransforms(skeleton.bones);
  animation.remapBoneKeyframesForParentChange(child.id, newParentId);

  const worldX = child._wx;
  const worldY = child._wy;
  const worldRot = child._wrot;
  let nextX = worldX;
  let nextY = worldY;
  let nextRotation = worldRot;

  if (newParent) {
    const cos = Math.cos((-newParent._wrot * Math.PI) / 180);
    const sin = Math.sin((-newParent._wrot * Math.PI) / 180);
    const dx = worldX - newParent._wx;
    const dy = worldY - newParent._wy;

    nextX = (dx * cos - dy * sin) / newParent.scaleX;
    nextY = (dx * sin + dy * cos) / newParent.scaleY;
    nextRotation = worldRot - newParent._wrot;
  }

  skeleton.updateBone(child.id, {
    parentId: newParent?.id ?? null,
    x: nextX,
    y: nextY,
    rotation: nextRotation,
  });
  skeleton.updateSetupPoseBone(child.id, {
    x: nextX,
    y: nextY,
    rotation: nextRotation,
    scaleX: child.scaleX,
    scaleY: child.scaleY,
  });
  editor.selectBone(child.id);

  return {
    ok: true,
    boneId: child.id,
    boneName: child.name,
    parentId: newParent?.id ?? null,
    parentName: newParent?.name ?? null,
  };
};

const getSlotByTarget = (slotId?: number, slotName?: string) => {
  const { slots } = useSlotStore.getState();
  if (typeof slotId === 'number') {
    return slots.find((slot) => slot.id === slotId) ?? null;
  }
  if (slotName) {
    const normalized = slotName.trim().toLowerCase();
    return slots.find((slot) => slot.name.trim().toLowerCase() === normalized) ?? null;
  }
  return null;
};

const getBoneIdsFromPayload = (payload: McpEditorCommand) => {
  if (Array.isArray(payload.boneIds) && payload.boneIds.length > 0) {
    return payload.boneIds.filter((boneId, index, array) => array.indexOf(boneId) === index);
  }
  const singleBoneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  return singleBoneId === null ? [] : [singleBoneId];
};

const readImageAttachmentFromPath = async (
  path: string,
  fallbackName: string,
): Promise<Omit<Attachment, 'slotId'>> => {
  const imageFile = await loadImageFileFromPath(path);
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error(`Failed to decode image: ${path}`));
    image.src = imageFile.dataUrl;
  });
  const targetSize = 200;
  const maxDimension = Math.max(dimensions.width, dimensions.height);
  const scale = maxDimension > targetSize ? targetSize / maxDimension : 1;

  return {
    name: fallbackName,
    type: 'image',
    imagePath: imageFile.path ?? imageFile.name,
    imageData: imageFile.dataUrl,
    width: dimensions.width,
    height: dimensions.height,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: scale,
    scaleY: scale,
  };
};

const listIkRoots = () => {
  const skeleton = useSkeletonStore.getState();
  return skeleton.ikChainRootIds.map((rootId) => {
    const root = skeleton.bones.find((bone) => bone.id === rootId);
    const child = skeleton.bones.find((bone) => bone.parentId === rootId);
    const end = child ? skeleton.bones.find((bone) => bone.parentId === child.id) : null;
    return {
      rootId,
      rootName: root?.name ?? null,
      childId: child?.id ?? null,
      childName: child?.name ?? null,
      endId: end?.id ?? null,
      endName: end?.name ?? null,
    };
  });
};

const setMultipleBoneSelectionFromCommand = (payload: McpEditorCommand) => {
  const boneIds = getBoneIdsFromPayload(payload);
  useEditorStore.setState({
    selectedBoneId: boneIds[boneIds.length - 1] ?? null,
    selectedBoneIds: boneIds,
  });
  return {
    ok: true,
    selectedBoneId: boneIds[boneIds.length - 1] ?? null,
    selectedBoneIds: boneIds,
  };
};

const clearSelectionFromCommand = () => {
  useEditorStore.setState({
    selectedBoneId: null,
    selectedBoneIds: [],
  });
  return { ok: true };
};

const setToolFromCommand = (payload: McpEditorCommand) => {
  const nextTool = payload.tool;
  if (!nextTool || !['pose', 'bone', 'move', 'rotate', 'scale'].includes(nextTool)) {
    throw new Error('Invalid tool for set_tool');
  }
  useEditorStore.getState().setTool(nextTool);
  return { ok: true, tool: nextTool };
};

const addBoneFromCommand = (payload: McpEditorCommand) => {
  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  const parentId =
    typeof payload.parentBoneId === 'number' || typeof payload.parentBoneName === 'string'
      ? resolveTargetBoneId(payload.parentBoneId, payload.parentBoneName)
      : null;
  if (
    (typeof payload.parentBoneId === 'number' || typeof payload.parentBoneName === 'string') &&
    parentId === null
  ) {
    throw new Error('Parent bone not found for add_bone');
  }

  const bone = skeleton.addBone({
    name: payload.name?.trim() || `bone_${skeleton.boneIdCounter}`,
    x: payload.x ?? 0,
    y: payload.y ?? 0,
    length: payload.value && typeof payload.value === 'number' ? payload.value : 50,
    rotation: payload.transform?.rotation ?? payload.rotation ?? 0,
    scaleX: payload.transform?.scaleX ?? 1,
    scaleY: payload.transform?.scaleY ?? 1,
    parentId,
    skinId: skeleton.activeSkinId,
    _wx: payload.x ?? 0,
    _wy: payload.y ?? 0,
    _wrot: payload.transform?.rotation ?? payload.rotation ?? 0,
  });
  skeleton.updateSetupPoseBone(bone.id, {
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
  });
  editor.selectBone(bone.id);
  return { ok: true, bone };
};

const renameBoneFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for rename_bone');
  const nextName = payload.name?.trim();
  if (!nextName) throw new Error('Missing name for rename_bone');
  useSkeletonStore.getState().updateBone(boneId, { name: nextName });
  return { ok: true, boneId, name: nextName };
};

const deleteBoneFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for delete_bone');
  useSkeletonStore.getState().deleteBone(boneId);
  return { ok: true, boneId };
};

const reorderBoneFromCommand = (payload: McpEditorCommand) => {
  const skeleton = useSkeletonStore.getState();
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for reorder_bone');
  const fromIndex = skeleton.bones.findIndex((bone) => bone.id === boneId);
  const toIndex = clampInt(typeof payload.value === 'number' ? payload.value : fromIndex, 0, Math.max(0, skeleton.bones.length - 1));
  skeleton.reorderBones(fromIndex, toIndex);
  return { ok: true, boneId, fromIndex, toIndex };
};

const mirrorBonesFromCommand = (payload: McpEditorCommand, axis: 'horizontal' | 'vertical') => {
  const boneIds = getBoneIdsFromPayload(payload);
  if (boneIds.length === 0) throw new Error('No bones selected for mirror');
  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  boneIds.forEach((boneId) => {
    const bone = skeleton.getBoneById(boneId);
    if (!bone) return;
    const nextScaleX = axis === 'horizontal' ? bone.scaleX * -1 : bone.scaleX;
    const nextScaleY = axis === 'vertical' ? bone.scaleY * -1 : bone.scaleY;
    skeleton.updateBone(boneId, {
      scaleX: nextScaleX,
      scaleY: nextScaleY,
    });
    if (useEditorStore.getState().mode === 'setup') {
      skeleton.updateSetupPoseBone(boneId, {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: nextScaleX,
        scaleY: nextScaleY,
      });
    } else {
      animation.insertKeyframe(boneId, {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: nextScaleX,
        scaleY: nextScaleY,
      });
    }
  });
  applyFrameIfNeeded();
  return { ok: true, axis, boneIds };
};

const saveSetupPoseFromCommand = () => {
  useSkeletonStore.getState().saveSetupPose();
  return { ok: true };
};

const upsertBoneGroupByPayload = (payload: McpEditorCommand) => {
  const skeleton = useSkeletonStore.getState();
  if (payload.commandType === 'create_bone_group') {
    const name = payload.name?.trim() || `Group ${skeleton.boneGroupIdCounter}`;
    return { ok: true, group: skeleton.addBoneGroup(name) };
  }
  const groupId = typeof payload.groupId === 'number'
    ? payload.groupId
    : skeleton.boneGroups.find((group) => group.name.trim().toLowerCase() === payload.groupName?.trim().toLowerCase())?.id;
  if (groupId === undefined) throw new Error('Bone group not found');
  if (payload.commandType === 'rename_bone_group') {
    const name = payload.name?.trim();
    if (!name) throw new Error('Missing name for rename_bone_group');
    skeleton.renameBoneGroup(groupId, name);
    return { ok: true, groupId, name };
  }
  if (payload.commandType === 'delete_bone_group') {
    skeleton.deleteBoneGroup(groupId);
    return { ok: true, groupId };
  }
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for group assignment');
  skeleton.assignBoneToGroup(boneId, payload.commandType === 'unassign_bone_from_group' ? null : groupId);
  return { ok: true, groupId, boneId };
};

const mutateSkinFromCommand = (payload: McpEditorCommand) => {
  const skeleton = useSkeletonStore.getState();
  const findSkinId = () => {
    if (typeof payload.skinId === 'number') return payload.skinId;
    if (payload.skinName) {
      return skeleton.skins.find((skin) => skin.name.trim().toLowerCase() === payload.skinName?.trim().toLowerCase())?.id;
    }
    return undefined;
  };

  if (payload.commandType === 'create_skin') {
    const name = payload.name?.trim() || `skin_${skeleton.skinIdCounter}`;
    const color = payload.color?.trim() || '#7c3aed';
    skeleton.addSkin(name, color);
    const created = useSkeletonStore.getState().skins.at(-1) ?? null;
    return { ok: true, skin: created };
  }

  const skinId = findSkinId();
  if (skinId === undefined) throw new Error('Skin not found');
  if (payload.commandType === 'set_active_skin') {
    skeleton.setActiveSkin(skinId);
    return { ok: true, skinId };
  }

  if (payload.commandType === 'rename_skin') {
    const nextName = payload.name?.trim();
    if (!nextName) throw new Error('Missing name for rename_skin');
    useSkeletonStore.setState((state) => ({
      skins: state.skins.map((skin) => (skin.id === skinId ? { ...skin, name: nextName } : skin)),
    }));
    return { ok: true, skinId, name: nextName };
  }

  if (payload.commandType === 'delete_skin') {
    if (skinId === 0) throw new Error('Default skin cannot be deleted');
    useSkeletonStore.setState((state) => {
      const nextSkins = state.skins.filter((skin) => skin.id !== skinId);
      return {
        skins: nextSkins.length > 0 ? nextSkins : [{ id: 0, name: 'default', color: '#7c3aed' }],
        activeSkinId: state.activeSkinId === skinId ? 0 : state.activeSkinId,
        bones: state.bones.map((bone) => (bone.skinId === skinId ? { ...bone, skinId: 0 } : bone)),
      };
    });
    return { ok: true, skinId };
  }

  throw new Error(`Unsupported skin mutation: ${payload.commandType}`);
};

const toggleIkChainFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for toggle_ik_chain');
  useSkeletonStore.getState().toggleIkChain(boneId);
  return {
    ok: true,
    ikRoots: listIkRoots(),
  };
};

const setIkTargetFromCommand = (payload: McpEditorCommand) => {
  const rootId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (rootId === null) throw new Error('Bone not found for set_ik_target');
  const skeleton = useSkeletonStore.getState();
  const editor = useEditorStore.getState();
  computeAllWorldTransforms(skeleton.bones);
  const chain = getIkChain(rootId, skeleton.bones);
  if (!chain) throw new Error('No valid 2-bone IK chain found');
  const solution = solveTwoBoneIk(rootId, { x: payload.x ?? chain.target.x, y: payload.y ?? chain.target.y }, skeleton.bones);
  if (!solution) throw new Error('Failed to solve IK target');

  skeleton.updateBone(rootId, { rotation: solution.rootRotation });
  skeleton.updateBone(chain.child.id, {
    rotation: solution.childRotation,
    ...(solution.childX !== undefined ? { x: solution.childX } : {}),
    ...(solution.childY !== undefined ? { y: solution.childY } : {}),
  });

  if (editor.mode === 'setup') {
    const root = skeleton.getBoneById(rootId);
    const child = skeleton.getBoneById(chain.child.id);
    if (root) {
      skeleton.updateSetupPoseBone(rootId, {
        x: root.x,
        y: root.y,
        rotation: root.rotation,
        scaleX: root.scaleX,
        scaleY: root.scaleY,
      });
    }
    if (child) {
      skeleton.updateSetupPoseBone(child.id, {
        x: child.x,
        y: child.y,
        rotation: child.rotation,
        scaleX: child.scaleX,
        scaleY: child.scaleY,
      });
    }
  } else {
    const animation = useAnimationStore.getState();
    [rootId, chain.child.id].forEach((boneId) => {
      const bone = skeleton.getBoneById(boneId);
      if (!bone) return;
      animation.insertKeyframe(boneId, {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY,
      });
    });
    animation.applyKeyframes();
  }

  return {
    ok: true,
    rootId,
    childId: chain.child.id,
    targetX: payload.x ?? chain.target.x,
    targetY: payload.y ?? chain.target.y,
  };
};

const addSlotFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for add_slot');
  const slotState = useSlotStore.getState();
  const slot = slotState.addSlot(boneId, payload.name?.trim() || `slot_${slotState.nextSlotId}`);
  return { ok: true, slot };
};

const updateSlotFromCommand = (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot) throw new Error('Slot not found');
  const updates: Record<string, unknown> = {};
  if (payload.name?.trim()) updates.name = payload.name.trim();
  if (typeof payload.drawOrder === 'number') updates.drawOrder = payload.drawOrder;
  if (typeof payload.boneId === 'number' || typeof payload.boneName === 'string') {
    const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
    if (boneId === null) throw new Error('Bone not found for update_slot');
    updates.boneId = boneId;
  }
  useSlotStore.getState().updateSlot(slot.id, updates);
  return { ok: true, slotId: slot.id, updates };
};

const deleteSlotFromCommand = (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot) throw new Error('Slot not found');
  useSlotStore.getState().deleteSlot(slot.id);
  return { ok: true, slotId: slot.id };
};

const setSlotAttachmentFromCommand = (payload: McpEditorCommand, attachmentName: string | null) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot) throw new Error('Slot not found');
  useSlotStore.getState().setSlotAttachment(slot.id, attachmentName);
  return { ok: true, slotId: slot.id, attachmentName };
};

const createAttachmentFromCommand = async (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot) throw new Error('Slot not found for create_attachment');
  if (!payload.attachmentPath && !payload.path) throw new Error('Missing attachment path for create_attachment');
  const path = payload.attachmentPath ?? payload.path!;
  const name = payload.attachmentName?.trim() || payload.name?.trim() || getFileNameFromPath(path).replace(/\.[^/.]+$/, '');
  const baseAttachment = await readImageAttachmentFromPath(path, name);
  const attachment: Omit<Attachment, 'slotId'> = {
    ...baseAttachment,
    x: payload.x ?? baseAttachment.x,
    y: payload.y ?? baseAttachment.y,
    rotation: payload.rotation ?? baseAttachment.rotation,
    scaleX:
      payload.transform?.scaleX ??
      (typeof payload.value === 'number' ? payload.value : baseAttachment.scaleX),
    scaleY: payload.transform?.scaleY ?? baseAttachment.scaleY,
  };
  useSlotStore.getState().addAttachment(slot.id, attachment);
  useSlotStore.getState().setSlotAttachment(slot.id, attachment.name);
  return { ok: true, slotId: slot.id, attachmentName: attachment.name };
};

const updateAttachmentFromCommand = (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot || !payload.attachmentName) throw new Error('Slot or attachment not found for update_attachment');
  const updates: Partial<Attachment> = {};
  if (payload.name?.trim()) updates.name = payload.name.trim();
  if (typeof payload.x === 'number') updates.x = payload.x;
  if (typeof payload.y === 'number') updates.y = payload.y;
  if (typeof payload.rotation === 'number') updates.rotation = payload.rotation;
  if (typeof payload.transform?.scaleX === 'number') updates.scaleX = payload.transform.scaleX;
  if (typeof payload.transform?.scaleY === 'number') updates.scaleY = payload.transform.scaleY;
  useSlotStore.getState().updateAttachment(slot.id, payload.attachmentName, updates);
  return { ok: true, slotId: slot.id, attachmentName: payload.attachmentName, updates };
};

const deleteAttachmentFromCommand = (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot || !payload.attachmentName) throw new Error('Slot or attachment not found for delete_attachment');
  useSlotStore.getState().deleteAttachment(slot.id, payload.attachmentName);
  if (slot.attachmentName === payload.attachmentName) {
    useSlotStore.getState().setSlotAttachment(slot.id, null);
  }
  return { ok: true, slotId: slot.id, attachmentName: payload.attachmentName };
};

const reorderSlotsFromCommand = (payload: McpEditorCommand) => {
  const slot = getSlotByTarget(payload.slotId, payload.slotName);
  if (!slot) throw new Error('Slot not found for reorder_slots');
  if (typeof payload.drawOrder !== 'number') throw new Error('Missing drawOrder for reorder_slots');
  useSlotStore.getState().reorderSlots(slot.id, payload.drawOrder);
  return { ok: true, slotId: slot.id, drawOrder: payload.drawOrder };
};

const setDurationFromCommand = (payload: McpEditorCommand) => {
  if (typeof payload.duration !== 'number') throw new Error('Missing duration');
  const duration = clampInt(payload.duration, 10, 300);
  useAnimationStore.getState().setDuration(duration);
  return { ok: true, duration };
};

const setFpsFromCommand = (payload: McpEditorCommand) => {
  if (typeof payload.fps !== 'number') throw new Error('Missing fps');
  const fps = clampInt(payload.fps, 1, 120);
  useAnimationStore.getState().setFps(fps);
  return { ok: true, fps };
};

const setPlaybackFromCommand = (commandType: string) => {
  const animation = useAnimationStore.getState();
  if (commandType === 'play_animation') {
    animation.play();
    return { ok: true, playing: true };
  }
  if (commandType === 'pause_animation') {
    animation.stop();
    return { ok: true, playing: false, paused: true };
  }
  animation.stop();
  animation.setFrame(0);
  animation.applyKeyframes();
  return { ok: true, playing: false, frame: 0 };
};

const moveKeyframeFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for move_keyframe');
  const animation = useAnimationStore.getState();
  const fromFrame = clampInt(payload.frame ?? animation.frame, 0, animation.duration);
  const toFrame = clampInt(payload.keyframeFrame ?? payload.endFrame ?? fromFrame, 0, animation.duration);
  animation.moveKeyframe(boneId, fromFrame, toFrame);
  animation.applyKeyframes();
  return { ok: true, boneId, fromFrame, toFrame };
};

const updateKeyframeEasingFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for update_keyframe_easing');
  const easing = payload.easing ?? payload.transform?.easing;
  if (!easing) throw new Error('Missing easing for update_keyframe_easing');
  const animation = useAnimationStore.getState();
  const frame = clampInt(payload.frame ?? animation.frame, 0, animation.duration);
  animation.updateKeyframeEasing(boneId, frame, easing);
  return { ok: true, boneId, frame, easing };
};

const clearBoneKeyframesFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for clear_bone_keyframes');
  useAnimationStore.getState().clearKeyframes(boneId);
  return { ok: true, boneId };
};

const copyFirstKeyframeFromCommand = (payload: McpEditorCommand) => {
  const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
  if (boneId === null) throw new Error('Bone not found for copy_first_keyframe');
  const animation = useAnimationStore.getState();
  const boneKeyframes = animation.keyframes[boneId];
  if (!boneKeyframes) throw new Error('Bone has no keyframes');
  const frames = Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
  const firstFrame = frames[0];
  if (firstFrame === undefined) throw new Error('Bone has no keyframes');
  const currentFrame = clampInt(payload.frame ?? animation.frame, 0, animation.duration);
  animation.setFrame(currentFrame);
  animation.insertKeyframe(boneId, { ...boneKeyframes[firstFrame] });
  animation.applyKeyframes();
  return { ok: true, boneId, sourceFrame: firstFrame, targetFrame: currentFrame };
};

const loopKeyframesFromCommand = () => {
  const animation = useAnimationStore.getState();
  const allKeyframes = animation.keyframes;
  const boneIds = Object.keys(allKeyframes).map(Number);
  let globalMax = 0;
  boneIds.forEach((boneId) => {
    const frames = Object.keys(allKeyframes[boneId] ?? {}).map(Number);
    const max = Math.max(...frames, 0);
    if (max > globalMax) globalMax = max;
  });
  boneIds.forEach((boneId) => {
    const boneKfs = allKeyframes[boneId];
    const frames = Object.keys(boneKfs ?? {}).map(Number).sort((a, b) => a - b);
    if (frames.length < 2) return;
    const lastFrame = frames[frames.length - 1];
    const reversed = frames.slice(0, -1).reverse();
    reversed.forEach((srcFrame) => {
      const gap = lastFrame - srcFrame;
      const destFrame = globalMax + gap;
      animation.setFrame(destFrame);
      animation.insertKeyframe(boneId, { ...boneKfs[srcFrame] });
    });
  });
  animation.setFrame(0);
  animation.applyKeyframes();
  return { ok: true };
};

const getAudioStateFromCommand = () => {
  const animation = useAnimationStore.getState();
  return {
    ok: true,
    audioData: animation.audioData,
    audioName: animation.audioName,
    audioVolume: animation.audioVolume,
    audioOffsetFrames: animation.audioOffsetFrames,
    hasAudio: Boolean(animation.audioData),
  };
};

const setAudioFromPathCommand = async (payload: McpEditorCommand) => {
  const path = payload.path;
  if (!path) throw new Error('Missing path for set_audio_track');
  const audio = await loadAudioFileFromPath(path);
  useAnimationStore.getState().setAudioTrack(audio.dataUrl, audio.name);
  return { ok: true, audioName: audio.name, path };
};

const setAudioPropertiesFromCommand = (payload: McpEditorCommand) => {
  const animation = useAnimationStore.getState();
  if (payload.commandType === 'clear_audio_track') {
    animation.clearAudioTrack();
    return { ok: true };
  }
  if (typeof payload.volume === 'number') {
    animation.setAudioVolume(Math.max(0, Math.min(1, payload.volume)));
  }
  if (typeof payload.offsetFrames === 'number') {
    animation.setAudioOffsetFrames(payload.offsetFrames);
  }
  return getAudioStateFromCommand();
};

const setCameraFromCommand = (payload: McpEditorCommand) => {
  const camera = useCameraStore.getState();
  if (payload.commandType === 'pan_camera') {
    camera.pan(payload.x ?? 0, payload.y ?? 0);
    return { ok: true, x: useCameraStore.getState().x, y: useCameraStore.getState().y, zoom: useCameraStore.getState().zoom };
  }
  if (payload.commandType === 'zoom_camera') {
    camera.zoomBy(payload.factor ?? 1);
    return { ok: true, x: useCameraStore.getState().x, y: useCameraStore.getState().y, zoom: useCameraStore.getState().zoom };
  }
  if (payload.commandType === 'reset_camera') {
    useCameraStore.setState((state) => ({ x: 0, y: 0, zoom: 1, canvasWidth: state.canvasWidth, canvasHeight: state.canvasHeight }));
    return { ok: true, x: 0, y: 0, zoom: 1 };
  }
  useCameraStore.setState((state) => ({
    x: typeof payload.x === 'number' ? payload.x : state.x,
    y: typeof payload.y === 'number' ? payload.y : state.y,
    zoom: typeof payload.zoom === 'number' ? Math.max(0.1, Math.min(10, payload.zoom)) : state.zoom,
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
  }));
  return { ok: true, x: useCameraStore.getState().x, y: useCameraStore.getState().y, zoom: useCameraStore.getState().zoom };
};

const setViewFlagsFromCommand = (payload: McpEditorCommand) => {
  const editor = useEditorStore.getState();
  if (payload.commandType === 'set_onion_skin') {
    editor.setOnionSkinEnabled(Boolean(payload.value));
  }
  if (payload.commandType === 'set_bone_indicators') {
    editor.setShowBoneIndicators(Boolean(payload.value));
  }
  if (payload.commandType === 'toggle_attachment_drag') {
    editor.setAttachmentDragEnabled(Boolean(payload.value));
  }
  return {
    ok: true,
    onionSkinEnabled: useEditorStore.getState().onionSkinEnabled,
    showBoneIndicators: useEditorStore.getState().showBoneIndicators,
    attachmentDragEnabled: useEditorStore.getState().attachmentDragEnabled,
  };
};

const setBackgroundFromCommand = async (payload: McpEditorCommand) => {
  if (payload.commandType === 'clear_background') {
    useEditorStore.getState().setBackgroundImage(null);
    return { ok: true, backgroundImage: null };
  }
  if (!payload.path) throw new Error('Missing path for set_background');
  const image = await loadImageFileFromPath(payload.path);
  useEditorStore.getState().setBackgroundImage(image.dataUrl);
  return { ok: true, path: payload.path, name: image.name };
};

const newOrProjectBrowserFromCommand = (payload: McpEditorCommand) => {
  if (payload.commandType === 'new_project') {
    createNewProject();
    return { ok: true };
  }
  if (payload.commandType === 'set_help_dialog') {
    useEditorStore.getState().setShowHelpDialog(Boolean(payload.value ?? true));
    return { ok: true, showHelpDialog: useEditorStore.getState().showHelpDialog };
  }
  useEditorStore.getState().setShowProjectBrowser(Boolean(payload.value ?? true));
  return { ok: true, showProjectBrowser: useEditorStore.getState().showProjectBrowser };
};

const saveOpenProjectFromCommand = async (payload: McpEditorCommand) => {
  if (payload.commandType === 'open_project') {
    if (!payload.path) throw new Error('Missing path for open_project');
    const path = await loadProjectFromPath(payload.path);
    return { ok: true, path };
  }
  if (payload.commandType === 'save_project') {
    const path = await saveProject(Boolean(payload.forceDialog));
    return { ok: true, path };
  }
  if (payload.commandType === 'save_project_as') {
    const path = await saveProject(true);
    return { ok: true, path };
  }
  const editor = useEditorStore.getState();
  return {
    ok: true,
    currentProjectPath: editor.currentProjectPath,
    suggestedProjectFileName: getSuggestedProjectFileName(),
  };
};

const listRecentProjectsFromCommand = () => ({
  ok: true,
  recentProjects: getRecentProjects(),
});

const mutateRecentProjectsFromCommand = (payload: McpEditorCommand) => {
  if (payload.commandType === 'clear_recent_projects') {
    clearRecentProjects();
    return { ok: true };
  }
  if (!payload.path) throw new Error('Missing path for remove_recent_project');
  removeRecentProject(payload.path);
  return { ok: true, path: payload.path };
};

const exportFromCommand = async (payload: McpEditorCommand) => {
  if (!payload.outputPath) throw new Error('Missing outputPath for export');
  const skeletonState = useSkeletonStore.getState();
  const animationState = useAnimationStore.getState();
  const slotState = useSlotStore.getState();
  const cameraState = useCameraStore.getState();
  const editorState = useEditorStore.getState();
  const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));
  if (payload.commandType === 'export_video') {
    const blob = await exportVideo(
      bonesCopy,
      slotState.slots,
      slotState.attachments,
      animationState.keyframes,
      animationState.meshDeformKeyframes,
      animationState.attachmentOpacityKeyframes,
      animationState.duration,
      animationState.fps,
      cameraState.x,
      cameraState.y,
      cameraState.zoom,
      editorState.backgroundImage,
    );
    await saveBlobToPath(payload.outputPath, blob);
    return { ok: true, outputPath: payload.outputPath };
  }
  if (payload.commandType === 'export_sprite_sheet') {
    const blob = await exportSpriteSheet({
      bones: bonesCopy,
      slots: slotState.slots,
      attachments: slotState.attachments,
      keyframes: animationState.keyframes,
      meshDeformKeyframes: animationState.meshDeformKeyframes,
      attachmentOpacityKeyframes: animationState.attachmentOpacityKeyframes,
      duration: animationState.duration,
      fps: animationState.fps,
      camX: cameraState.x,
      camY: cameraState.y,
      camZoom: cameraState.zoom,
      frameWidth: clampInt(payload.x ?? 1024, 64, 4096),
      frameHeight: clampInt(payload.y ?? 1024, 64, 4096),
    });
    await saveBlobToPath(payload.outputPath, blob);
    return { ok: true, outputPath: payload.outputPath };
  }
  const blob = await exportPngSequence({
    bones: bonesCopy,
    slots: slotState.slots,
    attachments: slotState.attachments,
    keyframes: animationState.keyframes,
    meshDeformKeyframes: animationState.meshDeformKeyframes,
    attachmentOpacityKeyframes: animationState.attachmentOpacityKeyframes,
    duration: animationState.duration,
    fps: animationState.fps,
    camX: cameraState.x,
    camY: cameraState.y,
    camZoom: cameraState.zoom,
    frameWidth: clampInt(payload.x ?? 1024, 64, 4096),
    frameHeight: clampInt(payload.y ?? 1024, 64, 4096),
    backgroundImage: editorState.backgroundImage,
    includeBackground: Boolean(payload.value),
  });
  await saveBlobToPath(payload.outputPath, blob);
  return { ok: true, outputPath: payload.outputPath };
};

const undoRedoFromCommand = (commandType: string) => {
  const history = useHistoryStore.getState();
  if (commandType === 'undo') {
    history.undo();
  } else {
    history.redo();
  }
  return {
    ok: true,
    pastCount: useHistoryStore.getState().past.length,
    futureCount: useHistoryStore.getState().future.length,
  };
};

const timelineUiCommand = (commandType: string) => {
  if (commandType === 'prev_keyframe') {
    window.dispatchEvent(new CustomEvent('spine:timeline-prev-key'));
  } else if (commandType === 'next_keyframe') {
    window.dispatchEvent(new CustomEvent('spine:timeline-next-key'));
  } else {
    window.dispatchEvent(new CustomEvent('spine:timeline-select-frame-keys'));
  }
  return { ok: true, commandType };
};

const buildMcpSnapshot = () => {
  const skeleton = useSkeletonStore.getState();
  const animation = useAnimationStore.getState();
  const editor = useEditorStore.getState();
  const slotState = useSlotStore.getState();
  const camera = useCameraStore.getState();

  return {
    ready: true,
    projectPath: editor.currentProjectPath,
    mode: editor.mode,
    tool: editor.tool,
    selectedBoneId: editor.selectedBoneId,
    selectedBoneIds: editor.selectedBoneIds,
    playbackRangeStart: editor.playbackRangeStart,
    playbackRangeEnd: editor.playbackRangeEnd,
    showBoneIndicators: editor.showBoneIndicators,
    onionSkinEnabled: editor.onionSkinEnabled,
    attachmentDragEnabled: editor.attachmentDragEnabled,
    backgroundImage: editor.backgroundImage,
    camera: {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      canvasWidth: camera.canvasWidth,
      canvasHeight: camera.canvasHeight,
    },
    bones: skeleton.bones.map((bone) => ({
      id: bone.id,
      name: bone.name,
      parentId: bone.parentId,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
      worldX: bone._wx,
      worldY: bone._wy,
      worldRotation: bone._wrot,
    })),
    boneGroups: skeleton.boneGroups,
    skins: skeleton.skins,
    activeSkinId: skeleton.activeSkinId,
    ikChainRootIds: skeleton.ikChainRootIds,
    boneCount: skeleton.bones.length,
    slotCount: slotState.slots.length,
    attachmentCount: slotState.attachments.length,
    keyframeBoneCount: Object.keys(animation.keyframes).length,
    slots: slotState.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      boneId: slot.boneId,
      drawOrder: slot.drawOrder,
      attachmentName: slot.attachmentName,
    })),
    attachments: slotState.attachments.map((attachment) => ({
      name: attachment.name,
      slotId: attachment.slotId,
      type: attachment.type,
      width: attachment.width,
      height: attachment.height,
      x: attachment.x,
      y: attachment.y,
      rotation: attachment.rotation,
      scaleX: attachment.scaleX,
      scaleY: attachment.scaleY,
    })),
    frame: animation.frame,
    duration: animation.duration,
    fps: animation.fps,
    playing: animation.playing,
    audioData: animation.audioData,
    audioName: animation.audioName,
    audioVolume: animation.audioVolume,
    audioOffsetFrames: animation.audioOffsetFrames,
    keyframes: animation.keyframes,
  };
};

function App() {
  useKeyboardShortcuts();
  const { currentProjectPath, setShowHelpDialog, setShowProjectBrowser } = useEditorStore();
  const didOpenProjectBrowserRef = useRef(false);

  useEffect(() => {
    void ensureDesktopMenu({
      onNewProject: () => {
        createNewProject();
      },
      onSave: async () => {
        void (await saveProject());
      },
      onSaveAs: async () => {
        void (await saveProject(true));
      },
      onOpen: async () => {
        void (await loadProject());
      },
      onOpenProjectBrowser: () => {
        setShowProjectBrowser(true);
      },
      onExportVideo: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-video'));
      },
      onExportSpriteSheet: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-spritesheet'));
      },
      onExportPngSequence: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-png-sequence'));
      },
      onExportAnimationJson: () => {
        window.dispatchEvent(new CustomEvent('spine:file-export-animation-json'));
      },
      onToggleBoneIndicators: () => {
        const editor = useEditorStore.getState();
        editor.setShowBoneIndicators(!editor.showBoneIndicators);
      },
      onOpenHelp: () => {
        setShowHelpDialog(true);
      },
    });
  }, [setShowHelpDialog, setShowProjectBrowser]);

  useEffect(() => {
    if (!isDesktopApp() || didOpenProjectBrowserRef.current) return;
    didOpenProjectBrowserRef.current = true;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let launchEventHandled = false;

    const handleLaunchPath = async (path: string) => {
      launchEventHandled = true;
      try {
        await loadProjectFromPath(path);
        setShowProjectBrowser(false);
      } catch (error) {
        console.error('Failed to open launch project:', error);
      }
    };

    void listen<string>('spine:launch-project-path', async (event) => {
      await handleLaunchPath(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    const initLaunchProject = async () => {
      const launchPath = await getLaunchProjectPath();
      if (cancelled) return;

      if (launchPath) {
        await handleLaunchPath(launchPath);
        return;
      }

      window.setTimeout(() => {
        if (cancelled || launchEventHandled) return;
        if (!useEditorStore.getState().currentProjectPath) {
          setShowProjectBrowser(true);
        }
      }, 700);
    };

    void initLaunchProject();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [setShowProjectBrowser]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let timeoutId: number | null = null;

    const pushSnapshot = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void updateMcpEditorState(buildMcpSnapshot()).catch((error) => {
          console.error('Failed to sync MCP editor state:', error);
        });
      }, 120);
    };

    pushSnapshot();

    const unsubscribeSkeleton = useSkeletonStore.subscribe(pushSnapshot);
    const unsubscribeAnimation = useAnimationStore.subscribe(pushSnapshot);
    const unsubscribeEditor = useEditorStore.subscribe(pushSnapshot);
    const unsubscribeSlots = useSlotStore.subscribe(pushSnapshot);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      unsubscribeSkeleton();
      unsubscribeAnimation();
      unsubscribeEditor();
      unsubscribeSlots();
    };
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let unlisten: (() => void) | null = null;

    void getMcpBridgeInfo().then((info) => {
      if (info) {
        console.info(`SpineBones MCP bridge ready at ${info.url}`);
      }
    });

    void listen<McpEditorCommand>('spine:mcp-command', async (event) => {
      const payload = event.payload;
      if (payload.commandType === 'set_mode') {
        const mode = payload.mode === 'animate' ? 'animate' : 'setup';
        useEditorStore.getState().setMode(mode);
        if (mode === 'animate') {
          useAnimationStore.getState().applyKeyframes();
        }
        console.info('MCP set_mode:', mode);
        return;
      }

      if (payload.commandType === 'set_frame') {
        const animation = useAnimationStore.getState();
        const nextFrame =
          typeof payload.frame === 'number'
            ? Math.max(0, Math.min(animation.duration, Math.round(payload.frame)))
            : animation.frame;
        animation.setFrame(nextFrame);
        animation.applyKeyframes();
        console.info('MCP set_frame:', nextFrame);
        return;
      }

      if (payload.commandType === 'select_bone') {
        const boneId = resolveTargetBoneId(payload.boneId, payload.boneName);
        useEditorStore.getState().selectBone(boneId);
        console.info('MCP select_bone:', boneId);
        return;
      }

      if (payload.commandType === 'select_multiple_bones') {
        const result = setMultipleBoneSelectionFromCommand(payload);
        console.info('MCP select_multiple_bones:', result);
        return;
      }

      if (payload.commandType === 'clear_selection') {
        const result = clearSelectionFromCommand();
        console.info('MCP clear_selection:', result);
        return;
      }

      if (payload.commandType === 'set_tool') {
        const result = setToolFromCommand(payload);
        console.info('MCP set_tool:', result);
        return;
      }

      if (payload.commandType === 'add_bone') {
        const result = addBoneFromCommand(payload);
        console.info('MCP add_bone:', result);
        return;
      }

      if (payload.commandType === 'rename_bone') {
        const result = renameBoneFromCommand(payload);
        console.info('MCP rename_bone:', result);
        return;
      }

      if (payload.commandType === 'delete_bone') {
        const result = deleteBoneFromCommand(payload);
        console.info('MCP delete_bone:', result);
        return;
      }

      if (payload.commandType === 'reorder_bone') {
        const result = reorderBoneFromCommand(payload);
        console.info('MCP reorder_bone:', result);
        return;
      }

      if (payload.commandType === 'mirror_horizontal' || payload.commandType === 'mirror_vertical') {
        const result = mirrorBonesFromCommand(
          payload,
          payload.commandType === 'mirror_horizontal' ? 'horizontal' : 'vertical',
        );
        console.info('MCP mirror:', result);
        return;
      }

      if (payload.commandType === 'save_setup_pose') {
        const result = saveSetupPoseFromCommand();
        console.info('MCP save_setup_pose:', result);
        return;
      }

      if (
        payload.commandType === 'create_bone_group' ||
        payload.commandType === 'rename_bone_group' ||
        payload.commandType === 'delete_bone_group' ||
        payload.commandType === 'assign_bone_to_group' ||
        payload.commandType === 'unassign_bone_from_group'
      ) {
        const result = upsertBoneGroupByPayload(payload);
        console.info('MCP bone_group:', result);
        return;
      }

      if (payload.commandType === 'toggle_ik_chain') {
        const result = toggleIkChainFromCommand(payload);
        console.info('MCP toggle_ik_chain:', result);
        return;
      }

      if (payload.commandType === 'set_ik_target') {
        const result = setIkTargetFromCommand(payload);
        console.info('MCP set_ik_target:', result);
        return;
      }

      if (payload.commandType === 'set_playback_range') {
        const animation = useAnimationStore.getState();
        const startFrame = Math.max(0, Math.round(payload.startFrame ?? 0));
        const endFrame =
          typeof payload.endFrame === 'number'
            ? Math.max(startFrame, Math.min(animation.duration, Math.round(payload.endFrame)))
            : null;
        useEditorStore.getState().setPlaybackRange(startFrame, endFrame);
        console.info('MCP set_playback_range:', { startFrame, endFrame });
        return;
      }

      if (payload.commandType === 'set_bone_parent' || payload.commandType === 'clear_bone_parent') {
        const result = setBoneParentFromCommand({
          ...payload,
          parentBoneId: payload.commandType === 'clear_bone_parent' ? null : payload.parentBoneId,
          parentBoneName: payload.commandType === 'clear_bone_parent' ? null : payload.parentBoneName,
        } as McpEditorCommand);
        console.info('MCP set_bone_parent:', result);
        return;
      }

      if (
        payload.commandType === 'add_slot' ||
        payload.commandType === 'rename_slot' ||
        payload.commandType === 'update_slot' ||
        payload.commandType === 'delete_slot'
      ) {
        const result =
          payload.commandType === 'add_slot'
            ? addSlotFromCommand(payload)
            : payload.commandType === 'delete_slot'
              ? deleteSlotFromCommand(payload)
              : updateSlotFromCommand(payload);
        console.info('MCP slot mutation:', result);
        return;
      }

      if (payload.commandType === 'set_slot_attachment' || payload.commandType === 'clear_slot_attachment') {
        const result = setSlotAttachmentFromCommand(
          payload,
          payload.commandType === 'clear_slot_attachment' ? null : payload.attachmentName ?? null,
        );
        console.info('MCP slot attachment:', result);
        return;
      }

      if (payload.commandType === 'create_attachment') {
        const result = await createAttachmentFromCommand(payload);
        console.info('MCP create_attachment:', result);
        return;
      }

      if (payload.commandType === 'update_attachment') {
        const result = updateAttachmentFromCommand(payload);
        console.info('MCP update_attachment:', result);
        return;
      }

      if (payload.commandType === 'delete_attachment') {
        const result = deleteAttachmentFromCommand(payload);
        console.info('MCP delete_attachment:', result);
        return;
      }

      if (payload.commandType === 'reorder_slots') {
        const result = reorderSlotsFromCommand(payload);
        console.info('MCP reorder_slots:', result);
        return;
      }

      if (payload.commandType === 'set_bone_transform') {
        const result = setBoneTransformFromCommand(payload);
        console.info('MCP set_bone_transform:', result);
        return;
      }

      if (payload.commandType === 'set_multiple_bone_transforms') {
        const result = setMultipleBoneTransformsFromCommand(payload);
        console.info('MCP set_multiple_bone_transforms:', result);
        return;
      }

      if (payload.commandType === 'set_keyframe' || payload.commandType === 'add_keyframe_for_specific_bone') {
        const result = setBoneKeyframeFromCommand(payload);
        console.info('MCP set_keyframe:', result);
        return;
      }

      if (payload.commandType === 'set_multiple_keyframes') {
        const result = setMultipleKeyframesFromCommand(payload);
        console.info('MCP set_multiple_keyframes:', result);
        return;
      }

      if (payload.commandType === 'remove_keyframe') {
        const result = removeBoneKeyframeFromCommand(payload);
        console.info('MCP remove_keyframe:', result);
        return;
      }

      if (payload.commandType === 'clear_animation_range') {
        const result = clearAnimationRangeFromCommand(payload);
        console.info('MCP clear_animation_range:', result);
        return;
      }

      if (payload.commandType === 'set_duration') {
        const result = setDurationFromCommand(payload);
        console.info('MCP set_duration:', result);
        return;
      }

      if (payload.commandType === 'set_fps') {
        const result = setFpsFromCommand(payload);
        console.info('MCP set_fps:', result);
        return;
      }

      if (
        payload.commandType === 'play_animation' ||
        payload.commandType === 'pause_animation' ||
        payload.commandType === 'stop_animation'
      ) {
        const result = setPlaybackFromCommand(payload.commandType);
        console.info('MCP playback:', result);
        return;
      }

      if (payload.commandType === 'move_keyframe') {
        const result = moveKeyframeFromCommand(payload);
        console.info('MCP move_keyframe:', result);
        return;
      }

      if (payload.commandType === 'update_keyframe_easing') {
        const result = updateKeyframeEasingFromCommand(payload);
        console.info('MCP update_keyframe_easing:', result);
        return;
      }

      if (payload.commandType === 'clear_bone_keyframes') {
        const result = clearBoneKeyframesFromCommand(payload);
        console.info('MCP clear_bone_keyframes:', result);
        return;
      }

      if (payload.commandType === 'copy_first_keyframe') {
        const result = copyFirstKeyframeFromCommand(payload);
        console.info('MCP copy_first_keyframe:', result);
        return;
      }

      if (payload.commandType === 'loop_keyframes') {
        const result = loopKeyframesFromCommand();
        console.info('MCP loop_keyframes:', result);
        return;
      }

      if (payload.commandType === 'duplicate_keyframe') {
        const result = duplicateKeyframeFromCommand(payload);
        console.info('MCP duplicate_keyframe:', result);
        return;
      }

      if (
        payload.commandType === 'create_skin' ||
        payload.commandType === 'rename_skin' ||
        payload.commandType === 'delete_skin' ||
        payload.commandType === 'set_active_skin'
      ) {
        const result = mutateSkinFromCommand(payload);
        console.info('MCP skin mutation:', result);
        return;
      }

      if (
        payload.commandType === 'set_audio_track' ||
        payload.commandType === 'clear_audio_track' ||
        payload.commandType === 'set_audio_volume' ||
        payload.commandType === 'set_audio_offset_frames'
      ) {
        const result =
          payload.commandType === 'set_audio_track'
            ? await setAudioFromPathCommand(payload)
            : setAudioPropertiesFromCommand(payload);
        console.info('MCP audio:', result);
        return;
      }

      if (
        payload.commandType === 'set_camera' ||
        payload.commandType === 'pan_camera' ||
        payload.commandType === 'zoom_camera' ||
        payload.commandType === 'reset_camera'
      ) {
        const result = setCameraFromCommand(payload);
        console.info('MCP camera:', result);
        return;
      }

      if (
        payload.commandType === 'set_onion_skin' ||
        payload.commandType === 'set_bone_indicators' ||
        payload.commandType === 'toggle_attachment_drag'
      ) {
        const result = setViewFlagsFromCommand(payload);
        console.info('MCP view flags:', result);
        return;
      }

      if (payload.commandType === 'set_background' || payload.commandType === 'clear_background') {
        const result = await setBackgroundFromCommand(payload);
        console.info('MCP background:', result);
        return;
      }

      if (
        payload.commandType === 'new_project' ||
        payload.commandType === 'set_project_browser' ||
        payload.commandType === 'set_help_dialog'
      ) {
        const result = newOrProjectBrowserFromCommand(payload);
        console.info('MCP project state:', result);
        return;
      }

      if (
        payload.commandType === 'open_project' ||
        payload.commandType === 'save_project' ||
        payload.commandType === 'save_project_as' ||
        payload.commandType === 'get_project_info'
      ) {
        const result = await saveOpenProjectFromCommand(payload);
        console.info('MCP project IO:', result);
        return;
      }

      if (payload.commandType === 'list_recent_projects') {
        const result = listRecentProjectsFromCommand();
        console.info('MCP recent projects:', result);
        return;
      }

      if (payload.commandType === 'remove_recent_project' || payload.commandType === 'clear_recent_projects') {
        const result = mutateRecentProjectsFromCommand(payload);
        console.info('MCP mutate recent projects:', result);
        return;
      }

      if (
        payload.commandType === 'export_video' ||
        payload.commandType === 'export_sprite_sheet' ||
        payload.commandType === 'export_png_sequence'
      ) {
        const result = await exportFromCommand(payload);
        console.info('MCP export:', result);
        return;
      }

      if (payload.commandType === 'undo' || payload.commandType === 'redo') {
        const result = undoRedoFromCommand(payload.commandType);
        console.info('MCP history:', result);
        return;
      }

      if (
        payload.commandType === 'prev_keyframe' ||
        payload.commandType === 'next_keyframe' ||
        payload.commandType === 'select_frame_keyframes'
      ) {
        const result = timelineUiCommand(payload.commandType);
        console.info('MCP timeline UI:', result);
        return;
      }

      if (payload.commandType === 'apply_rag_animation') {
        if (!payload.prompt) throw new Error('apply_rag_animation requires a prompt');
        const result = runRagPipeline(payload.prompt);
        applyRagAnimation(result);
        console.info('MCP apply_rag_animation:', {
          item: result.item.id,
          score: result.score,
          mappedBones: Object.keys(result.mappedBones).length,
          keyframeCount: result.keyframeCount,
        });
        return;
      }

      console.warn('Unknown MCP command received:', payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    document.title = currentProjectPath
      ? `${getFileNameFromPath(currentProjectPath)} - SpineBones`
      : 'SpineBones';
  }, [currentProjectPath]);

  return <EditorLayout />;
}

export default App;

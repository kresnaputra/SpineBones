import { useAnimationStore } from '../stores/animationStore';
import { useEditorStore } from '../stores/editorStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useSlotStore } from '../stores/slotStore';
import { getFileNameFromPath, saveTextFile, stripExtension } from './nativeIO';

const JSON_FILTERS = [
  {
    name: 'JSON',
    extensions: ['json'],
  },
];

const sortNumericFrames = <T>(frames: Record<number, T>) =>
  Object.entries(frames)
    .map(([frame, value]) => [Number(frame), value] as const)
    .sort((a, b) => a[0] - b[0]);

const tokenizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .split(/[\s_]+/)
    .filter(Boolean);

const toTitleCase = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const guessSemanticBone = (boneName: string) => {
  const tokens = tokenizeName(boneName);
  const has = (...values: string[]) => values.some((value) => tokens.includes(value));

  if (has('cape', 'cloak', 'scarf')) return 'cape';
  if (has('head')) return 'head';
  if (has('torso', 'body', 'spine')) return has('down', 'lower', 'waist', 'hip', 'pelvis') ? 'torsoDown' : 'torso';
  if (has('shoulder')) return has('left', 'l') ? 'leftShoulder' : has('right', 'r') ? 'rightShoulder' : null;
  if (has('arm', 'forearm')) return has('left', 'l') ? 'leftArm' : has('right', 'r') ? 'rightArm' : null;
  if (has('hand')) return has('left', 'l') ? 'leftHand' : has('right', 'r') ? 'rightHand' : null;
  if (has('foot')) return has('left', 'l') ? 'leftFoot' : has('right', 'r') ? 'rightFoot' : null;
  if (has('leg', 'thigh', 'tigh')) {
    if (has('lower', 'shin', 'calf')) {
      return has('left', 'l') ? 'leftLowerLeg' : has('right', 'r') ? 'rightLowerLeg' : null;
    }
    return has('left', 'l') ? 'leftUpperLeg' : has('right', 'r') ? 'rightUpperLeg' : null;
  }

  return null;
};

const inferCategory = (projectName: string, keyedBoneNames: string[]) => {
  const normalized = `${projectName} ${keyedBoneNames.join(' ')}`.toLowerCase();
  if (normalized.includes('walk') || normalized.includes('jalan')) return 'walk';
  if (normalized.includes('run') || normalized.includes('lari')) return 'run';
  if (normalized.includes('attack') || normalized.includes('hit') || normalized.includes('slash')) return 'attack';
  if (normalized.includes('idle') || normalized.includes('diam') || normalized.includes('breath')) return 'idle';
  return 'unknown';
};

const buildReadableName = (projectBaseName: string, category: string) => {
  const normalizedName = toTitleCase(projectBaseName);
  if (category === 'unknown') return normalizedName;

  const categoryLabel = toTitleCase(category);
  if (normalizedName.toLowerCase().includes(category.toLowerCase())) {
    return normalizedName;
  }

  return `${normalizedName} ${categoryLabel}`.trim();
};

const buildDescription = (category: string, tags: string[], semanticBones: string[]) => {
  const subject = tags.includes('humanoid') ? 'humanoid' : '2D skeletal';
  const weaponText = tags.includes('weapon') ? ' carrying a weapon' : '';
  const capeText = semanticBones.includes('cape') ? ' with cape motion' : '';

  if (category === 'unknown') {
    return `Keyframed animation exported from SpineBones for a ${subject} rig${weaponText}${capeText}.`;
  }

  return `${toTitleCase(category)} cycle for a ${subject} character${weaponText}${capeText}.`;
};

const inferStyleTags = (category: string, tags: string[]) => {
  const styles = new Set<string>();

  if (tags.includes('weapon')) styles.add('combat');
  if (tags.includes('cape')) styles.add('cloth');
  if (category === 'walk' || category === 'run') styles.add('locomotion');
  if (category === 'idle') styles.add('neutral');
  if (category === 'attack') styles.add('aggressive');

  return Array.from(styles).sort((a, b) => a.localeCompare(b));
};

const inferMotionFeatures = (category: string, tags: string[]) => {
  const hasWeapon = tags.includes('weapon');

  if (category === 'walk') {
    return {
      speed: 'medium',
      energy: hasWeapon ? 'medium' : 'low',
      mood: hasWeapon ? 'focused' : 'neutral',
      cycle: true,
    };
  }

  if (category === 'run') {
    return {
      speed: 'fast',
      energy: 'high',
      mood: 'urgent',
      cycle: true,
    };
  }

  if (category === 'attack') {
    return {
      speed: 'medium',
      energy: 'high',
      mood: 'aggressive',
      cycle: false,
    };
  }

  if (category === 'idle') {
    return {
      speed: 'slow',
      energy: 'low',
      mood: 'neutral',
      cycle: true,
    };
  }

  return {
    speed: 'unknown',
    energy: 'unknown',
    mood: 'unknown',
    cycle: true,
  };
};

const getRequiredBonesForCategory = (category: string) => {
  if (category === 'walk' || category === 'run') {
    return ['torso', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
  }

  if (category === 'attack') {
    return ['torso', 'leftArm', 'rightArm'];
  }

  if (category === 'idle') {
    return ['torso', 'head'];
  }

  return ['torso'];
};

const buildUsage = (
  category: string,
  tags: string[],
  requiredBones: string[],
  motionFeatures: { speed: string; energy: string; mood: string; cycle: boolean },
) => {
  const subject = tags.includes('humanoid') ? 'humanoid characters' : 'compatible 2D skeletal characters';
  const weaponText = tags.includes('weapon') ? ' Works well for rigs with a weapon attachment.' : '';
  const cycleText = motionFeatures.cycle ? ' Designed as a looping motion.' : ' Intended for one-shot playback.';

  return `Suitable for ${subject} that include ${requiredBones.join(', ')}.${weaponText} ${cycleText}`.trim();
};

export const createAnimationExportData = () => {
  const animationState = useAnimationStore.getState();
  const skeletonState = useSkeletonStore.getState();
  const slotState = useSlotStore.getState();

  return {
    format: 'spinebones-animation-keyframes',
    version: '1.0',
    duration: animationState.duration,
    fps: animationState.fps,
    bones: skeletonState.bones
      .map((bone) => ({
        id: bone.id,
        name: bone.name,
        parentId: bone.parentId,
      }))
      .sort((a, b) => a.id - b.id),
    slots: slotState.slots
      .map((slot) => ({
        id: slot.id,
        name: slot.name,
        boneId: slot.boneId,
        attachmentName: slot.attachmentName,
      }))
      .sort((a, b) => a.id - b.id),
    attachmentKeys: Object.keys({
      ...animationState.meshDeformKeyframes,
      ...animationState.attachmentOpacityKeyframes,
    })
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const [slotIdText, ...attachmentNameParts] = key.split(':');
        const slotId = Number(slotIdText);
        const attachmentName = attachmentNameParts.join(':');
        const slot = slotState.slots.find((item) => item.id === slotId) ?? null;

        return {
          key,
          slotId,
          slotName: slot?.name ?? null,
          boneId: slot?.boneId ?? null,
          attachmentName,
        };
      }),
    keyframes: Object.entries(animationState.keyframes)
      .map(([boneIdText, frames]) => {
        const boneId = Number(boneIdText);
        const bone = skeletonState.bones.find((item) => item.id === boneId) ?? null;

        return {
          boneId,
          boneName: bone?.name ?? null,
          frames: sortNumericFrames(frames).map(([frame, value]) => ({
            frame,
            ...value,
          })),
        };
      })
      .sort((a, b) => a.boneId - b.boneId),
    meshDeformKeyframes: Object.entries(animationState.meshDeformKeyframes)
      .map(([attachmentKey, frames]) => ({
        attachmentKey,
        frames: sortNumericFrames(frames).map(([frame, value]) => ({
          frame,
          easing: value.easing ?? 'linear',
          vertices: value.vertices.map((vertex) => ({
            x: vertex.x,
            y: vertex.y,
          })),
        })),
      }))
      .sort((a, b) => a.attachmentKey.localeCompare(b.attachmentKey)),
    attachmentOpacityKeyframes: Object.entries(animationState.attachmentOpacityKeyframes)
      .map(([attachmentKey, frames]) => ({
        attachmentKey,
        frames: sortNumericFrames(frames).map(([frame, value]) => ({
          frame,
          opacity: value.opacity,
          easing: value.easing ?? 'linear',
        })),
      }))
      .sort((a, b) => a.attachmentKey.localeCompare(b.attachmentKey)),
  };
};

export const exportAnimationJson = async () => {
  const payload = createAnimationRagDatasetExportData();

  await saveTextFile(
    `${payload.id}.json`,
    `${JSON.stringify(payload, null, 2)}\n`,
    JSON_FILTERS,
  );
};

export const createAnimationRagDatasetExportData = () => {
  const animationState = useAnimationStore.getState();
  const skeletonState = useSkeletonStore.getState();
  const slotState = useSlotStore.getState();
  const editorState = useEditorStore.getState();
  const baseExport = createAnimationExportData();

  const projectPath = editorState.currentProjectPath;
  const projectFileName = projectPath ? getFileNameFromPath(projectPath) : 'untitled-project.sbn';
  const projectBaseName = stripExtension(projectFileName);
  const keyedBones = baseExport.keyframes
    .map((entry) => entry.boneName)
    .filter((boneName): boneName is string => Boolean(boneName));
  const category = inferCategory(projectBaseName, keyedBones);

  const semanticBoneEntries = skeletonState.bones
    .map((bone) => ({
      semantic: guessSemanticBone(bone.name),
      boneName: bone.name,
    }))
    .filter((entry): entry is { semantic: string; boneName: string } => Boolean(entry.semantic));

  const semanticBones = Array.from(new Set(semanticBoneEntries.map((entry) => entry.semantic))).sort((a, b) =>
    a.localeCompare(b),
  );

  const boneMapping = Object.fromEntries(
    semanticBoneEntries.map((entry) => [entry.semantic, entry.boneName]),
  );

  const tags = Array.from(
    new Set([
      category,
      ...semanticBones,
      ...(semanticBones.includes('cape') ? ['cape'] : []),
      ...(skeletonState.bones.some((bone) => bone.name.toLowerCase().includes('sword')) ? ['weapon'] : []),
      ...(semanticBones.includes('leftUpperLeg') && semanticBones.includes('rightUpperLeg')
        ? ['humanoid']
        : []),
      ...(animationState.duration > 0 ? ['keyframed'] : []),
      'spinebones',
    ]),
  ).filter((tag) => tag !== 'unknown');
  const style = inferStyleTags(category, tags);
  const motionFeatures = inferMotionFeatures(category, tags);
  const requiredBones = getRequiredBonesForCategory(category).filter((bone) =>
    semanticBones.includes(bone),
  );
  const usage = buildUsage(category, tags, requiredBones, motionFeatures);

  return {
    datasetFormat: 'spinebones-rag-animation',
    version: '1.0',
    id: projectBaseName,
    name: buildReadableName(projectBaseName, category),
    description: buildDescription(category, tags, semanticBones),
    category,
    loop: true,
    style,
    motionFeatures,
    requiredBones,
    usage,
    tags,
    source: {
      type: 'spinebones-export',
      projectPath,
      exportedAt: new Date().toISOString(),
    },
    rigProfile: {
      type: tags.includes('humanoid') ? 'humanoid' : 'custom',
      semanticBones,
      boneCount: skeletonState.bones.length,
      slotCount: slotState.slots.length,
    },
    boneMapping,
    animation: baseExport,
  };
};

export const exportAnimationRagDatasetJson = async () => {
  await exportAnimationJson();
};

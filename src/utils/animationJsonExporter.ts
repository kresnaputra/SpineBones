import { useAnimationStore } from '../stores/animationStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useSlotStore } from '../stores/slotStore';
import { saveTextFile } from './nativeIO';

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
  const payload = createAnimationExportData();

  await saveTextFile(
    'output.json',
    `${JSON.stringify(payload, null, 2)}\n`,
    JSON_FILTERS,
  );
};

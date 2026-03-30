import type { Bone, Slot, Attachment, Keyframes } from '../types';

interface SpineSkeletonData {
  skeleton: {
    hash: string;
    spine: string;
    width: number;
    height: number;
  };
  bones: SpineBone[];
  slots: SpineSlot[];
  skins: SpineSkin[];
  animations: Record<string, SpineAnimation>;
}

interface SpineBone {
  name: string;
  parent?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

interface SpineSlot {
  name: string;
  bone: string;
  attachment?: string;
}

interface SpineSkin {
  name: string;
  attachments: Record<string, Record<string, SpineAttachment>>;
}

interface SpineAttachment {
  type?: string;
  name?: string;
  x?: number;
  y?: number;
  rotation?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
}

interface SpineAnimation {
  bones?: Record<string, SpineBoneTimeline>;
}

interface SpineBoneTimeline {
  translate?: SpineKeyframe[];
  rotate?: SpineKeyframe[];
  scale?: SpineKeyframe[];
}

interface SpineKeyframe {
  time: number;
  x?: number;
  y?: number;
  angle?: number;
  curve?: string;
}

export const exportSpineJSON = (
  bones: Bone[],
  slots: Slot[],
  attachments: Attachment[],
  keyframes: Keyframes,
  fps: number
  // duration: number  // Reserved for future use
): string => {
  const spineBones: SpineBone[] = bones.map((bone) => {
    const spineBone: SpineBone = {
      name: bone.name,
    };

    if (bone.parentId !== null) {
      const parent = bones.find((b) => b.id === bone.parentId);
      if (parent) spineBone.parent = parent.name;
    }

    if (bone.x !== 0) spineBone.x = Math.round(bone.x * 100) / 100;
    if (bone.y !== 0) spineBone.y = Math.round(bone.y * 100) / 100;
    if (bone.rotation !== 0) spineBone.rotation = Math.round(bone.rotation * 100) / 100;
    if (bone.scaleX !== 1) spineBone.scaleX = Math.round(bone.scaleX * 100) / 100;
    if (bone.scaleY !== 1) spineBone.scaleY = Math.round(bone.scaleY * 100) / 100;

    return spineBone;
  });

  const spineSlots: SpineSlot[] = slots.map((slot) => {
    const bone = bones.find((b) => b.id === slot.boneId);
    return {
      name: slot.name,
      bone: bone?.name || 'root',
      attachment: slot.attachmentName || undefined,
    };
  });

  const skinAttachments: Record<string, Record<string, SpineAttachment>> = {};
  
  slots.forEach((slot) => {
    const slotAttachments = attachments.filter((a) => a.slotId === slot.id);
    if (slotAttachments.length > 0) {
      skinAttachments[slot.name] = {};
      slotAttachments.forEach((att) => {
        skinAttachments[slot.name][att.name] = {
          type: 'region',
          name: att.name,
          x: Math.round(att.x * 100) / 100,
          y: Math.round(att.y * 100) / 100,
          rotation: Math.round(att.rotation * 100) / 100,
          width: Math.round(att.width * 100) / 100,
          height: Math.round(att.height * 100) / 100,
          scaleX: Math.round(att.scaleX * 100) / 100,
          scaleY: Math.round(att.scaleY * 100) / 100,
        };
      });
    }
  });

  const spineAnimations: Record<string, SpineAnimation> = {
    animation: {
      bones: {},
    },
  };

  bones.forEach((bone) => {
    const boneKeyframes = keyframes[bone.id];
    if (!boneKeyframes) return;

    const frames = Object.keys(boneKeyframes)
      .map(Number)
      .sort((a, b) => a - b);

    if (frames.length === 0) return;

    const boneTimeline: SpineBoneTimeline = {};

    const translateFrames: SpineKeyframe[] = [];
    const rotateFrames: SpineKeyframe[] = [];
    const scaleFrames: SpineKeyframe[] = [];

    frames.forEach((frame) => {
      const kf = boneKeyframes[frame];
      const time = Math.round((frame / fps) * 100) / 100;

      if (kf.x !== undefined || kf.y !== undefined) {
        translateFrames.push({
          time,
          x: Math.round((kf.x || 0) * 100) / 100,
          y: Math.round((kf.y || 0) * 100) / 100,
          curve: 'linear',
        });
      }

      if (kf.rotation !== undefined) {
        rotateFrames.push({
          time,
          angle: Math.round(kf.rotation * 100) / 100,
          curve: 'linear',
        });
      }

      if (kf.scaleX !== undefined || kf.scaleY !== undefined) {
        scaleFrames.push({
          time,
          x: Math.round((kf.scaleX || 1) * 100) / 100,
          y: Math.round((kf.scaleY || 1) * 100) / 100,
          curve: 'linear',
        });
      }
    });

    if (translateFrames.length > 0) boneTimeline.translate = translateFrames;
    if (rotateFrames.length > 0) boneTimeline.rotate = rotateFrames;
    if (scaleFrames.length > 0) boneTimeline.scale = scaleFrames;

    if (Object.keys(boneTimeline).length > 0) {
      spineAnimations.animation.bones![bone.name] = boneTimeline;
    }
  });

  const spineData: SpineSkeletonData = {
    skeleton: {
      hash: 'SpineBones',
      spine: '4.1.0',
      width: 512,
      height: 512,
    },
    bones: spineBones,
    slots: spineSlots,
    skins: [
      {
        name: 'default',
        attachments: skinAttachments,
      },
    ],
    animations: spineAnimations,
  };

  return JSON.stringify(spineData, null, 2);
};

export const createTextureAtlas = (attachments: Attachment[]): { atlas: string; images: Map<string, string> } => {
  const images = new Map<string, string>();
  let atlasContent = '\n';

  attachments.forEach((att) => {
    if (att.imageData) {
      images.set(att.name, att.imageData);
      
      atlasContent += `${att.name}\n`;
      atlasContent += `  rotate: false\n`;
      atlasContent += `  xy: 0, 0\n`;
      atlasContent += `  size: ${Math.round(att.width)}, ${Math.round(att.height)}\n`;
      atlasContent += `  orig: ${Math.round(att.width)}, ${Math.round(att.height)}\n`;
      atlasContent += `  offset: 0, 0\n`;
      atlasContent += `  index: -1\n`;
    }
  });

  return { atlas: atlasContent, images };
};

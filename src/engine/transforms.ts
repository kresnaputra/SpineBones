import type { Bone, Point } from '../types';

export const computeAllWorldTransforms = (bones: Bone[]): void => {
  bones.forEach((bone) => {
    if (!bone.parentId) {
      bone._wx = bone.x;
      bone._wy = bone.y;
      bone._wrot = bone.rotation;
    }
  });

  for (let pass = 0; pass < 5; pass++) {
    bones.forEach((bone) => {
      if (bone.parentId !== null) {
        const parent = bones.find((b) => b.id === bone.parentId);
        if (!parent) return;
        
        const cos = Math.cos((parent._wrot * Math.PI) / 180);
        const sin = Math.sin((parent._wrot * Math.PI) / 180);
        const localX = bone.x * parent.scaleX;
        const localY = bone.y * parent.scaleY;
        
        bone._wx = parent._wx + localX * cos - localY * sin;
        bone._wy = parent._wy + localX * sin + localY * cos;
        bone._wrot = parent._wrot + bone.rotation;
      }
    });
  }
};

export const getBoneTip = (bone: Bone): Point => {
  const r = (bone._wrot * Math.PI) / 180;
  return {
    x: bone._wx + Math.cos(r) * bone.length * bone.scaleX,
    y: bone._wy + Math.sin(r) * bone.length * bone.scaleY,
  };
};

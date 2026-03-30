import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';

export const createDemoSkeleton = () => {
  const { addBone, activeSkinId } = useSkeletonStore.getState();
  const { insertKeyframe } = useAnimationStore.getState();

  const hip = addBone({
    name: 'hip',
    x: 0,
    y: 80,
    length: 50,
    rotation: -90,
    scaleX: 1,
    scaleY: 1,
    parentId: null,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 80,
    _wrot: -90,
  });

  const spine = addBone({
    name: 'spine',
    x: 0,
    y: 0,
    length: 60,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    parentId: hip.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  addBone({
    name: 'head',
    x: 0,
    y: 0,
    length: 35,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    parentId: spine.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  const armL = addBone({
    name: 'arm_L',
    x: 0,
    y: 0,
    length: 45,
    rotation: -130,
    scaleX: 1,
    scaleY: 1,
    parentId: spine.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  addBone({
    name: 'forearm_L',
    x: 0,
    y: 0,
    length: 40,
    rotation: -30,
    scaleX: 1,
    scaleY: 1,
    parentId: armL.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  const armR = addBone({
    name: 'arm_R',
    x: 0,
    y: 0,
    length: 45,
    rotation: -50,
    scaleX: 1,
    scaleY: 1,
    parentId: spine.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  addBone({
    name: 'forearm_R',
    x: 0,
    y: 0,
    length: 40,
    rotation: 30,
    scaleX: 1,
    scaleY: 1,
    parentId: armR.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  const legL = addBone({
    name: 'leg_L',
    x: 0,
    y: 0,
    length: 60,
    rotation: 70,
    scaleX: 1,
    scaleY: 1,
    parentId: hip.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  addBone({
    name: 'shin_L',
    x: 0,
    y: 0,
    length: 55,
    rotation: 20,
    scaleX: 1,
    scaleY: 1,
    parentId: legL.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  const legR = addBone({
    name: 'leg_R',
    x: 0,
    y: 0,
    length: 60,
    rotation: 110,
    scaleX: 1,
    scaleY: 1,
    parentId: hip.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  addBone({
    name: 'shin_R',
    x: 0,
    y: 0,
    length: 55,
    rotation: -20,
    scaleX: 1,
    scaleY: 1,
    parentId: legR.id,
    skinId: activeSkinId,
    _wx: 0,
    _wy: 0,
    _wrot: 0,
  });

  const walkKeys = [
    { f: 0, legL_rot: 70, legR_rot: 110 },
    { f: 12, legL_rot: 50, legR_rot: 130 },
    { f: 24, legL_rot: 70, legR_rot: 110 },
    { f: 36, legL_rot: 90, legR_rot: 90 },
    { f: 48, legL_rot: 110, legR_rot: 70 },
    { f: 60, legL_rot: 70, legR_rot: 110 },
  ];

  walkKeys.forEach(({ f, legL_rot, legR_rot }) => {
    const currentFrame = useAnimationStore.getState().frame;
    useAnimationStore.getState().setFrame(f);
    
    insertKeyframe(legL.id, { x: 0, y: 0, rotation: legL_rot, scaleX: 1, scaleY: 1 });
    insertKeyframe(legR.id, { x: 0, y: 0, rotation: legR_rot, scaleX: 1, scaleY: 1 });
    
    useAnimationStore.getState().setFrame(currentFrame);
  });
};

import { create } from 'zustand';
import type { Bone, BoneGroup, Skin, SetupPose } from '../types';

interface SkeletonState {
  bones: Bone[];
  boneGroups: BoneGroup[];
  setupPose: SetupPose;
  skins: Skin[];
  activeSkinId: number;
  ikChainRootIds: number[];
  boneIdCounter: number;
  boneGroupIdCounter: number;
  skinIdCounter: number;
  addBone: (bone: Omit<Bone, 'id'>) => Bone;
  updateBone: (id: number, updates: Partial<Bone>) => void;
  deleteBone: (id: number) => void;
  reorderBones: (fromIndex: number, toIndex: number) => void;
  addBoneGroup: (name: string) => BoneGroup;
  renameBoneGroup: (id: number, name: string) => void;
  deleteBoneGroup: (id: number) => void;
  assignBoneToGroup: (boneId: number, groupId: number | null) => void;
  addSkin: (name: string, color: string) => void;
  setActiveSkin: (id: number) => void;
  toggleIkChain: (rootId: number) => void;
  getBoneById: (id: number) => Bone | undefined;
  updateSetupPoseBone: (id: number, updates: Partial<SetupPose[number]>) => void;
  saveSetupPose: () => void;
  restoreSetupPose: () => void;
}

export const useSkeletonStore = create<SkeletonState>((set, get) => ({
  bones: [],
  boneGroups: [],
  setupPose: {},
  skins: [{ id: 0, name: 'default', color: '#7c3aed' }],
  activeSkinId: 0,
  ikChainRootIds: [],
  boneIdCounter: 0,
  boneGroupIdCounter: 0,
  skinIdCounter: 1,

  addBone: (boneData) => {
    const id = get().boneIdCounter;
    const bone: Bone = {
      ...boneData,
      id,
      _wx: boneData.x,
      _wy: boneData.y,
      _wrot: boneData.rotation,
    };
    set((state) => ({
      bones: [...state.bones, bone],
      boneIdCounter: state.boneIdCounter + 1,
    }));
    return bone;
  },

  updateBone: (id, updates) => {
    set((state) => ({
      bones: state.bones.map((bone) =>
        bone.id === id ? { ...bone, ...updates } : bone
      ),
    }));
  },

  deleteBone: (id) => {
    set((state) => ({
      bones: state.bones.filter((bone) => bone.id !== id && bone.parentId !== id),
      boneGroups: state.boneGroups
        .map((group) => ({
          ...group,
          boneIds: group.boneIds.filter((boneId) => boneId !== id),
        }))
        .filter((group) => group.boneIds.length > 0 || group.name.length > 0),
      ikChainRootIds: state.ikChainRootIds.filter((rootId) => rootId !== id),
    }));
  },

  reorderBones: (fromIndex, toIndex) => {
    set((state) => {
      const newBones = [...state.bones];
      const [movedBone] = newBones.splice(fromIndex, 1);
      newBones.splice(toIndex, 0, movedBone);
      return { bones: newBones };
    });
  },

  addBoneGroup: (name) => {
    const id = get().boneGroupIdCounter;
    const group: BoneGroup = {
      id,
      name,
      boneIds: [],
    };

    set((state) => ({
      boneGroups: [...state.boneGroups, group],
      boneGroupIdCounter: state.boneGroupIdCounter + 1,
    }));

    return group;
  },

  deleteBoneGroup: (id) =>
    set((state) => ({
      boneGroups: state.boneGroups.filter((group) => group.id !== id),
    })),

  renameBoneGroup: (id, name) =>
    set((state) => ({
      boneGroups: state.boneGroups.map((group) =>
        group.id === id ? { ...group, name } : group
      ),
    })),

  assignBoneToGroup: (boneId, groupId) =>
    set((state) => ({
      boneGroups: state.boneGroups.map((group) => {
        const nextBoneIds = group.boneIds.filter((id) => id !== boneId);
        if (group.id !== groupId) {
          return {
            ...group,
            boneIds: nextBoneIds,
          };
        }

        return {
          ...group,
          boneIds: nextBoneIds.includes(boneId) ? nextBoneIds : [...nextBoneIds, boneId],
        };
      }),
    })),

  addSkin: (name, color) => {
    set((state) => ({
      skins: [...state.skins, { id: state.skinIdCounter, name, color }],
      skinIdCounter: state.skinIdCounter + 1,
    }));
  },

  setActiveSkin: (id) => set({ activeSkinId: id }),

  toggleIkChain: (rootId) =>
    set((state) => ({
      ikChainRootIds: state.ikChainRootIds.includes(rootId)
        ? state.ikChainRootIds.filter((id) => id !== rootId)
        : [...state.ikChainRootIds, rootId],
    })),

  getBoneById: (id) => get().bones.find((bone) => bone.id === id),

  updateSetupPoseBone: (id, updates) =>
    set((state) => ({
      setupPose: {
        ...state.setupPose,
        [id]: {
          x: state.setupPose[id]?.x ?? state.bones.find((bone) => bone.id === id)?.x ?? 0,
          y: state.setupPose[id]?.y ?? state.bones.find((bone) => bone.id === id)?.y ?? 0,
          rotation:
            state.setupPose[id]?.rotation ??
            state.bones.find((bone) => bone.id === id)?.rotation ??
            0,
          scaleX:
            state.setupPose[id]?.scaleX ??
            state.bones.find((bone) => bone.id === id)?.scaleX ??
            1,
          scaleY:
            state.setupPose[id]?.scaleY ??
            state.bones.find((bone) => bone.id === id)?.scaleY ??
            1,
          ...updates,
        },
      },
    })),

  saveSetupPose: () => {
    const { bones } = get();
    const setupPose: SetupPose = {};
    bones.forEach((bone) => {
      setupPose[bone.id] = {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY,
      };
    });
    set({ setupPose });
  },

  restoreSetupPose: () => {
    const { bones, setupPose } = get();
    set({
      bones: bones.map((bone) => {
        const pose = setupPose[bone.id];
        if (pose) {
          return { ...bone, ...pose };
        }
        return bone;
      }),
    });
  },
}));

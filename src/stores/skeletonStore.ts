import { create } from 'zustand';
import type { Bone, Skin, SetupPose } from '../types';

interface SkeletonState {
  bones: Bone[];
  setupPose: SetupPose;
  skins: Skin[];
  activeSkinId: number;
  ikChainRootIds: number[];
  boneIdCounter: number;
  skinIdCounter: number;
  addBone: (bone: Omit<Bone, 'id'>) => Bone;
  updateBone: (id: number, updates: Partial<Bone>) => void;
  deleteBone: (id: number) => void;
  reorderBones: (fromIndex: number, toIndex: number) => void;
  addSkin: (name: string, color: string) => void;
  setActiveSkin: (id: number) => void;
  toggleIkChain: (rootId: number) => void;
  getBoneById: (id: number) => Bone | undefined;
  saveSetupPose: () => void;
  restoreSetupPose: () => void;
}

export const useSkeletonStore = create<SkeletonState>((set, get) => ({
  bones: [],
  setupPose: {},
  skins: [{ id: 0, name: 'default', color: '#7c3aed' }],
  activeSkinId: 0,
  ikChainRootIds: [],
  boneIdCounter: 0,
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

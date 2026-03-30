import { create } from 'zustand';
import type { Bone, Skin } from '../types';

interface SkeletonState {
  bones: Bone[];
  skins: Skin[];
  activeSkinId: number;
  boneIdCounter: number;
  skinIdCounter: number;
  addBone: (bone: Omit<Bone, 'id'>) => Bone;
  updateBone: (id: number, updates: Partial<Bone>) => void;
  deleteBone: (id: number) => void;
  reorderBones: (fromIndex: number, toIndex: number) => void;
  addSkin: (name: string, color: string) => void;
  setActiveSkin: (id: number) => void;
  getBoneById: (id: number) => Bone | undefined;
}

export const useSkeletonStore = create<SkeletonState>((set, get) => ({
  bones: [],
  skins: [{ id: 0, name: 'default', color: '#7c3aed' }],
  activeSkinId: 0,
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

  getBoneById: (id) => get().bones.find((bone) => bone.id === id),
}));

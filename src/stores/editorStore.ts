import { create } from 'zustand';
import type { Tool, Mode } from '../types';

interface EditorState {
  tool: Tool;
  mode: Mode;
  selectedBoneId: number | null;
  backgroundImage: string | null;
  currentProjectPath: string | null;
  setTool: (tool: Tool) => void;
  setMode: (mode: Mode) => void;
  selectBone: (id: number | null) => void;
  setBackgroundImage: (imageData: string | null) => void;
  setCurrentProjectPath: (path: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'pose',
  mode: 'setup',
  selectedBoneId: null,
  backgroundImage: null,
  currentProjectPath: null,
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  selectBone: (id) => set({ selectedBoneId: id }),
  setBackgroundImage: (imageData) => set({ backgroundImage: imageData }),
  setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),
}));

import { create } from 'zustand';
import type { Tool, Mode } from '../types';

interface EditorState {
  tool: Tool;
  mode: Mode;
  selectedBoneId: number | null;
  showBoneIndicators: boolean;
  backgroundImage: string | null;
  currentProjectPath: string | null;
  setTool: (tool: Tool) => void;
  setMode: (mode: Mode) => void;
  selectBone: (id: number | null) => void;
  setShowBoneIndicators: (show: boolean) => void;
  setBackgroundImage: (imageData: string | null) => void;
  setCurrentProjectPath: (path: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'pose',
  mode: 'setup',
  selectedBoneId: null,
  showBoneIndicators: true,
  backgroundImage: null,
  currentProjectPath: null,
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  selectBone: (id) => set({ selectedBoneId: id }),
  setShowBoneIndicators: (showBoneIndicators) => set({ showBoneIndicators }),
  setBackgroundImage: (imageData) => set({ backgroundImage: imageData }),
  setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),
}));

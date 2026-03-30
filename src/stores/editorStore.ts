import { create } from 'zustand';
import type { Tool, Mode } from '../types';

interface EditorState {
  tool: Tool;
  mode: Mode;
  selectedBoneId: number | null;
  setTool: (tool: Tool) => void;
  setMode: (mode: Mode) => void;
  selectBone: (id: number | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'pose',
  mode: 'setup',
  selectedBoneId: null,
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  selectBone: (id) => set({ selectedBoneId: id }),
}));

import { create } from 'zustand';
import type { Tool, Mode } from '../types';

interface EditorState {
  tool: Tool;
  mode: Mode;
  selectedBoneId: number | null;
  selectedBoneIds: number[];
  showHelpDialog: boolean;
  showBoneIndicators: boolean;
  attachmentDragEnabled: boolean;
  backgroundImage: string | null;
  currentProjectPath: string | null;
  setTool: (tool: Tool) => void;
  setMode: (mode: Mode) => void;
  selectBone: (id: number | null) => void;
  toggleBoneSelection: (id: number) => void;
  setShowHelpDialog: (show: boolean) => void;
  setShowBoneIndicators: (show: boolean) => void;
  setAttachmentDragEnabled: (enabled: boolean) => void;
  setBackgroundImage: (imageData: string | null) => void;
  setCurrentProjectPath: (path: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'pose',
  mode: 'setup',
  selectedBoneId: null,
  selectedBoneIds: [],
  showHelpDialog: false,
  showBoneIndicators: true,
  attachmentDragEnabled: false,
  backgroundImage: null,
  currentProjectPath: null,
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  selectBone: (id) => set({ selectedBoneId: id, selectedBoneIds: id === null ? [] : [id] }),
  toggleBoneSelection: (id) =>
    set((state) => {
      const isSelected = state.selectedBoneIds.includes(id);
      if (isSelected) {
        const nextSelectedBoneIds = state.selectedBoneIds.filter((boneId) => boneId !== id);
        return {
          selectedBoneIds: nextSelectedBoneIds,
          selectedBoneId:
            state.selectedBoneId === id
              ? (nextSelectedBoneIds[nextSelectedBoneIds.length - 1] ?? null)
              : state.selectedBoneId,
        };
      }

      return {
        selectedBoneId: id,
        selectedBoneIds: [...state.selectedBoneIds, id],
      };
    }),
  setShowHelpDialog: (showHelpDialog) => set({ showHelpDialog }),
  setShowBoneIndicators: (showBoneIndicators) => set({ showBoneIndicators }),
  setAttachmentDragEnabled: (attachmentDragEnabled) => set({ attachmentDragEnabled }),
  setBackgroundImage: (imageData) => set({ backgroundImage: imageData }),
  setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),
}));

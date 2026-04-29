import { create } from 'zustand';
import type { Tool, Mode } from '../types';

interface EditorState {
  tool: Tool;
  mode: Mode;
  selectedBoneId: number | null;
  selectedBoneIds: number[];
  selectedSlotId: number | null;
  playbackRangeStart: number;
  playbackRangeEnd: number | null;
  showHelpDialog: boolean;
  showProjectBrowser: boolean;
  showBoneIndicators: boolean;
  showViewport: boolean;
  onionSkinEnabled: boolean;
  attachmentDragEnabled: boolean;
  backgroundImage: string | null;
  currentProjectPath: string | null;
  setTool: (tool: Tool) => void;
  setMode: (mode: Mode) => void;
  selectBone: (id: number | null) => void;
  selectSlot: (id: number | null) => void;
  toggleBoneSelection: (id: number) => void;
  setPlaybackRange: (start: number, end: number | null) => void;
  setShowHelpDialog: (show: boolean) => void;
  setShowProjectBrowser: (show: boolean) => void;
  setShowBoneIndicators: (show: boolean) => void;
  setShowViewport: (show: boolean) => void;
  toggleViewport: () => void;
  setOnionSkinEnabled: (enabled: boolean) => void;
  toggleOnionSkin: () => void;
  setAttachmentDragEnabled: (enabled: boolean) => void;
  setBackgroundImage: (imageData: string | null) => void;
  setCurrentProjectPath: (path: string | null) => void;
  selectedMeshVertexIndices: number[];
  setSelectedMeshVertexIndices: (indices: number[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'pose',
  mode: 'setup',
  selectedBoneId: null,
  selectedBoneIds: [],
  selectedSlotId: null,
  playbackRangeStart: 0,
  playbackRangeEnd: null,
  showHelpDialog: false,
  showProjectBrowser: false,
  showBoneIndicators: true,
  showViewport: false,
  onionSkinEnabled: false,
  attachmentDragEnabled: false,
  backgroundImage: null,
  currentProjectPath: null,
  selectedMeshVertexIndices: [],
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
  selectBone: (id) =>
    set({
      selectedBoneId: id,
      selectedBoneIds: id === null ? [] : [id],
      selectedSlotId: null,
    }),
  selectSlot: (id) => set({ selectedSlotId: id }),
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
  setPlaybackRange: (start, end) =>
    set({
      playbackRangeStart: Math.max(0, Math.round(start)),
      playbackRangeEnd: end === null ? null : Math.max(0, Math.round(end)),
    }),
  setShowHelpDialog: (showHelpDialog) => set({ showHelpDialog }),
  setShowProjectBrowser: (showProjectBrowser) => set({ showProjectBrowser }),
  setShowBoneIndicators: (showBoneIndicators) => set({ showBoneIndicators }),
  setShowViewport: (showViewport) => set({ showViewport }),
  toggleViewport: () => set((state) => ({ showViewport: !state.showViewport })),
  setOnionSkinEnabled: (onionSkinEnabled) => set({ onionSkinEnabled }),
  toggleOnionSkin: () => set((state) => ({ onionSkinEnabled: !state.onionSkinEnabled })),
  setAttachmentDragEnabled: (attachmentDragEnabled) => set({ attachmentDragEnabled }),
  setBackgroundImage: (imageData) => set({ backgroundImage: imageData }),
  setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),
  setSelectedMeshVertexIndices: (selectedMeshVertexIndices) => set({ selectedMeshVertexIndices }),
}));

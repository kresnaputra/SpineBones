import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useHistoryStore } from '../stores/historyStore';
import { useSlotStore } from '../stores/slotStore';
import { getIkRootForBone } from '../utils/ik';
import { createNewProject, loadProject, saveProject } from '../utils/projectPersistence';

export const useKeyboardShortcuts = () => {
  const {
    tool,
    setTool,
    mode,
    setMode,
    selectedBoneId,
    selectedBoneIds,
    selectBone,
    attachmentDragEnabled,
    setAttachmentDragEnabled,
    toggleOnionSkin,
    showBoneIndicators,
    setShowBoneIndicators,
  } = useEditorStore();
  const { undo, redo, captureSnapshot } = useHistoryStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const key = e.key.toLowerCase();
      const isModifierPressed = e.metaKey || e.ctrlKey;

      if (isModifierPressed && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (isModifierPressed && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (isModifierPressed && key === 's') {
        e.preventDefault();
        void saveProject(e.shiftKey);
        return;
      }

      if (isModifierPressed && key === 'o') {
        e.preventDefault();
        void loadProject();
        return;
      }

      if (isModifierPressed && key === 'n') {
        e.preventDefault();
        createNewProject();
        return;
      }

      if (isModifierPressed && key === 'b') {
        e.preventDefault();
        setShowBoneIndicators(!showBoneIndicators);
        return;
      }

      const toolMap: Record<string, typeof tool> = {
        q: 'pose',
        b: 'bone',
        m: 'move',
        r: 'rotate',
        s: 'scale',
        h: 'mesh',
      };

      if (toolMap[key]) {
        setTool(toolMap[key]);
        return;
      }

      if (key === 'w') {
        if (e.repeat) return;
        if (mode === 'setup') return;
        useSkeletonStore.getState().restoreSetupPose();
        setMode('setup');
        return;
      }

      if (key === 'e') {
        if (e.repeat) return;
        if (mode === 'animate') return;
        const { bones: currentBones, setupPose: oldSetupPose } = useSkeletonStore.getState();
        const deltas: Record<number, { dx: number; dy: number; dRot: number; dScaleX: number; dScaleY: number }> = {};
        let hasDeltas = false;

        if (Object.keys(oldSetupPose).length > 0) {
          currentBones.forEach((bone) => {
            const old = oldSetupPose[bone.id];
            if (!old) return;

            const dx = bone.x - old.x;
            const dy = bone.y - old.y;
            const dRot = bone.rotation - old.rotation;
            const dScaleX = bone.scaleX - old.scaleX;
            const dScaleY = bone.scaleY - old.scaleY;

            if (dx !== 0 || dy !== 0 || dRot !== 0 || dScaleX !== 0 || dScaleY !== 0) {
              deltas[bone.id] = { dx, dy, dRot, dScaleX, dScaleY };
              hasDeltas = true;
            }
          });
        }

        if (hasDeltas) {
          useAnimationStore.getState().shiftKeyframes(deltas);
        }

        useSkeletonStore.getState().saveSetupPose();
        setMode('animate');
        return;
      }

      if (key === 'k') {
        if (selectedBoneIds.length === 0) return;
        const { bones } = useSkeletonStore.getState();
        const { insertKeyframe } = useAnimationStore.getState();
        captureSnapshot();
        selectedBoneIds.forEach((boneId) => {
          const bone = bones.find((b) => b.id === boneId);
          if (!bone) return;

          insertKeyframe(bone.id, {
            x: bone.x,
            y: bone.y,
            rotation: bone.rotation,
            scaleX: bone.scaleX,
            scaleY: bone.scaleY,
          });
        });
        return;
      }

      if (key === 'f') {
        window.dispatchEvent(new CustomEvent('spine:timeline-copy-first-key'));
        return;
      }

      if (key === 'd') {
        if (selectedBoneId === null) return;
        const { slots } = useSlotStore.getState();
        const hasActiveAttachment = slots.some(
          (slot) => slot.boneId === selectedBoneId && slot.attachmentName !== null
        );
        if (!hasActiveAttachment) return;
        setAttachmentDragEnabled(!attachmentDragEnabled);
        return;
      }

      if (key === 'o' && mode === 'animate') {
        toggleOnionSkin();
        return;
      }

      if (!isModifierPressed && key === 'c') {
        if (selectedBoneId === null) return;
        const { bones, toggleIkChain } = useSkeletonStore.getState();
        const ikRoot = getIkRootForBone(selectedBoneId, bones);
        if (!ikRoot) return;
        captureSnapshot();
        toggleIkChain(ikRoot.id);
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        if (selectedBoneIds.length > 0) {
          const { deleteBone } = useSkeletonStore.getState();
          captureSnapshot();
          selectedBoneIds.forEach((boneId) => deleteBone(boneId));
          selectBone(null);
        }
        return;
      }

      if (key === ' ') {
        e.preventDefault();
        const { playing, play, stop } = useAnimationStore.getState();
        if (playing) {
          stop();
        } else {
          play();
        }
        return;
      }

      if (key === 'escape') {
        selectBone(null);
        return;
      }

      if (key === 'arrowright') {
        const { duration, frame, setFrame, applyKeyframes } = useAnimationStore.getState();
        const newFrame = Math.min(duration, frame + 1);
        setFrame(newFrame);
        if (mode === 'animate') applyKeyframes();
        return;
      }

      if (key === 'arrowleft') {
        const { frame, setFrame, applyKeyframes } = useAnimationStore.getState();
        const newFrame = Math.max(0, frame - 1);
        setFrame(newFrame);
        if (mode === 'animate') applyKeyframes();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    tool,
    setTool,
    mode,
    setMode,
    selectedBoneId,
    selectedBoneIds,
    selectBone,
    attachmentDragEnabled,
    setAttachmentDragEnabled,
    toggleOnionSkin,
    captureSnapshot,
    undo,
    redo,
    showBoneIndicators,
    setShowBoneIndicators,
  ]);
};

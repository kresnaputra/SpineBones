import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useHistoryStore } from '../stores/historyStore';
import { loadProject, saveProject } from '../utils/projectPersistence';

export const useKeyboardShortcuts = () => {
  const { tool, setTool, mode, setMode, selectedBoneId, selectBone } = useEditorStore();
  const { bones, deleteBone, saveSetupPose, restoreSetupPose } = useSkeletonStore();
  const { insertKeyframe, playing, play, stop, frame, setFrame, duration, applyKeyframes, shiftKeyframes } = useAnimationStore();
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

      const toolMap: Record<string, typeof tool> = {
        q: 'pose',
        b: 'bone',
        m: 'move',
        r: 'rotate',
        s: 'scale',
      };

      if (toolMap[key]) {
        setTool(toolMap[key]);
        return;
      }

      if (key === 'w') {
        restoreSetupPose();
        setMode('setup');
        return;
      }

      if (key === 'e') {
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
          shiftKeyframes(deltas);
        }

        saveSetupPose();
        setMode('animate');
        return;
      }

      if (key === 'k') {
        if (selectedBoneId === null) return;
        const bone = bones.find((b) => b.id === selectedBoneId);
        if (!bone) return;
        captureSnapshot();
        insertKeyframe(bone.id, {
          x: bone.x,
          y: bone.y,
          rotation: bone.rotation,
          scaleX: bone.scaleX,
          scaleY: bone.scaleY,
        });
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        if (selectedBoneId !== null) {
          captureSnapshot();
          deleteBone(selectedBoneId);
          selectBone(null);
        }
        return;
      }

      if (key === ' ') {
        e.preventDefault();
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
        const newFrame = Math.min(duration, frame + 1);
        setFrame(newFrame);
        if (mode === 'animate') applyKeyframes();
        return;
      }

      if (key === 'arrowleft') {
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
    selectBone,
    bones,
    deleteBone,
    saveSetupPose,
    restoreSetupPose,
    insertKeyframe,
    shiftKeyframes,
    captureSnapshot,
    playing,
    play,
    stop,
    frame,
    setFrame,
    duration,
    applyKeyframes,
    undo,
    redo,
  ]);
};

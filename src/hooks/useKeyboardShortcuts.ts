import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useHistoryStore } from '../stores/historyStore';

export const useKeyboardShortcuts = () => {
  const { tool, setTool, mode, selectedBoneId, selectBone } = useEditorStore();
  const { bones, deleteBone } = useSkeletonStore();
  const { insertKeyframe, playing, play, stop, frame, setFrame, duration, applyKeyframes } = useAnimationStore();
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

      const toolMap: Record<string, typeof tool> = {
        q: 'pose',
        b: 'bone',
        g: 'move',
        r: 'rotate',
        s: 'scale',
      };

      if (toolMap[key]) {
        setTool(toolMap[key]);
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
    selectedBoneId,
    selectBone,
    bones,
    deleteBone,
    insertKeyframe,
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

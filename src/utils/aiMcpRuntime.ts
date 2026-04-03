import { useAnimationStore } from '../stores/animationStore';
import { useEditorStore } from '../stores/editorStore';
import { useHistoryStore } from '../stores/historyStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import {
  applyAnimationPromptToKeyframes,
  applyIdlePresetToKeyframes,
  applyIdlePromptToKeyframes,
  type IdlePresetId,
} from './aiMcpPresets';

export const applyIdlePresetToEditor = (presetId: IdlePresetId) => {
  const { bones } = useSkeletonStore.getState();
  const { keyframes, fps } = useAnimationStore.getState();

  if (bones.length === 0) {
    return {
      ok: false,
      summary: 'Tidak ada bone aktif untuk diproses.',
    };
  }

  useHistoryStore.getState().captureSnapshot();
  const result = applyIdlePresetToKeyframes(bones, keyframes, presetId);

  useAnimationStore.setState({
    keyframes: result.keyframes,
    duration: result.duration,
    fps: fps || 60,
    frame: 0,
    playing: false,
  });

  useEditorStore.getState().setMode('animate');

  return {
    ok: true,
    summary: `Preset applied: ${presetId}`,
  };
};

export const applyIdlePromptToEditor = (prompt: string) => {
  const { bones } = useSkeletonStore.getState();
  const { keyframes, fps } = useAnimationStore.getState();

  if (bones.length === 0) {
    return {
      ok: false,
      summary: 'Tidak ada bone aktif untuk diproses.',
    };
  }

  useHistoryStore.getState().captureSnapshot();
  const result = applyIdlePromptToKeyframes(bones, keyframes, prompt);

  useAnimationStore.setState({
    keyframes: result.keyframes,
    duration: result.duration,
    fps: fps || 60,
    frame: 0,
    playing: false,
  });

  useEditorStore.getState().setMode('animate');

  return {
    ok: true,
    summary: result.summary,
  };
};

export const applyAnimationPromptToEditor = (prompt: string) => {
  const { bones } = useSkeletonStore.getState();
  const { keyframes, fps } = useAnimationStore.getState();

  if (bones.length === 0) {
    return {
      ok: false,
      summary: 'Tidak ada bone aktif untuk diproses.',
    };
  }

  useHistoryStore.getState().captureSnapshot();
  const result = applyAnimationPromptToKeyframes(bones, keyframes, prompt);

  useAnimationStore.setState({
    keyframes: result.keyframes,
    duration: result.duration,
    fps: fps || 60,
    frame: 0,
    playing: false,
  });

  useEditorStore.getState().setMode('animate');

  return {
    ok: true,
    summary: result.summary,
  };
};

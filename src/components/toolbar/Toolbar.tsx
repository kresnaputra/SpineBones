import { MousePointer, Bone, Move, RotateCw, Maximize2, Diamond, X, Plus, Undo2, Redo2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';
import type { Tool } from '../../types';

const TOOL_ICONS = {
  pose: MousePointer,
  bone: Bone,
  move: Move,
  rotate: RotateCw,
  scale: Maximize2,
};

const TOOL_LABELS = {
  pose: 'Pose',
  bone: 'Bone',
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
};

const TOOL_SHORTCUTS = {
  pose: 'Q',
  bone: 'B',
  move: 'G',
  rotate: 'R',
  scale: 'S',
};

export const Toolbar = () => {
  const { tool, mode, setTool, setMode, selectedBoneId } = useEditorStore();
  const { addSkin } = useSkeletonStore();
  const { insertKeyframe, clearKeyframes } = useAnimationStore();
  const { bones } = useSkeletonStore();
  const { captureSnapshot, undo, redo, past, future } = useHistoryStore();

  const handleInsertKeyframe = () => {
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
  };

  const handleClearKeyframes = () => {
    if (selectedBoneId === null) return;
    captureSnapshot();
    clearKeyframes(selectedBoneId);
  };

  const handleAddSkin = () => {
    const colors = ['#7c3aed', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#f97316'];
    const skinCount = useSkeletonStore.getState().skins.length;
    const color = colors[skinCount % colors.length];
    const name = prompt('Skin name:', `skin_${skinCount}`);
    if (name) {
      captureSnapshot();
      addSkin(name, color);
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-panel border-b border-border h-12 flex-shrink-0">
      <div className="font-sans font-extrabold text-base text-accent tracking-tight mr-4">
        Spine<span className="text-accent2">Web</span>
      </div>

      <div className="w-px h-6 bg-border mx-1" />

      {(Object.keys(TOOL_ICONS) as Tool[]).map((t) => {
        const Icon = TOOL_ICONS[t];
        return (
          <button
            key={t}
            onClick={() => setTool(t)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] ${
              tool === t
                ? 'bg-accent text-white border-accent'
                : 'bg-transparent text-text-dim border-transparent hover:bg-panel2 hover:text-text hover:border-border'
            }`}
            title={`${TOOL_LABELS[t]} (${TOOL_SHORTCUTS[t]})`}
          >
            <Icon size={14} />
            {TOOL_LABELS[t]}
          </button>
        );
      })}

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={undo}
        disabled={past.length === 0}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent disabled:hover:text-text-dim"
        title="Undo (Ctrl/Cmd+Z)"
      >
        <Undo2 size={14} />
        Undo
      </button>

      <button
        onClick={redo}
        disabled={future.length === 0}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent disabled:hover:text-text-dim"
        title="Redo (Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y)"
      >
        <Redo2 size={14} />
        Redo
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={handleInsertKeyframe}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Insert Keyframe (K)"
      >
        <Diamond size={14} fill="currentColor" />
        Key
      </button>

      <button
        onClick={handleClearKeyframes}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Clear Keyframes"
      >
        <X size={14} />
        Clear
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={handleAddSkin}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
      >
        <Plus size={14} />
        Add Skin
      </button>

      <div className="flex bg-panel2 border border-border rounded-md overflow-hidden ml-auto">
        <button
          onClick={() => setMode('setup')}
          className={`px-4 py-1.5 text-[11px] transition-all ${
            mode === 'setup' ? 'bg-accent text-white' : 'text-text-dim'
          }`}
        >
          SETUP
        </button>
        <button
          onClick={() => setMode('animate')}
          className={`px-4 py-1.5 text-[11px] transition-all ${
            mode === 'animate' ? 'bg-accent text-white' : 'text-text-dim'
          }`}
        >
          ANIMATE
        </button>
      </div>
    </div>
  );
};

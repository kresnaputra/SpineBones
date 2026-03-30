import { MousePointer, Bone, Move, RotateCw, Maximize2, Diamond, X, Plus, Undo2, Redo2, Save, Upload, Download, Video } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useCameraStore } from '../../stores/cameraStore';
import { exportSpineJSON, createTextureAtlas } from '../../utils/spineExporter';
import { exportVideo } from '../../utils/videoExporter';
import JSZip from 'jszip';
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

  const handleSave = () => {
    const skeletonState = useSkeletonStore.getState();
    const animationState = useAnimationStore.getState();
    const slotState = useSlotStore.getState();
    
    const projectData = {
      version: '1.0',
      bones: skeletonState.bones,
      skins: skeletonState.skins,
      slots: slotState.slots,
      attachments: slotState.attachments,
      keyframes: animationState.keyframes,
      duration: animationState.duration,
      fps: animationState.fps,
    };

    const json = JSON.stringify(projectData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spine-project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const projectData = JSON.parse(text);

      useSkeletonStore.setState({
        bones: projectData.bones || [],
        skins: projectData.skins || [],
        boneIdCounter: Math.max(...(projectData.bones || []).map((b: any) => b.id), 0) + 1,
        skinIdCounter: Math.max(...(projectData.skins || []).map((s: any) => s.id), 0) + 1,
      });

      useSlotStore.setState({
        slots: projectData.slots || [],
        attachments: projectData.attachments || [],
        nextSlotId: Math.max(...(projectData.slots || []).map((s: any) => s.id), 0) + 1,
      });

      useAnimationStore.setState({
        keyframes: projectData.keyframes || {},
        duration: projectData.duration || 60,
        fps: projectData.fps || 24,
        frame: 0,
        playing: false,
      });
    };
    
    input.click();
  };

  const handleExportSpine = async () => {
    const skeletonState = useSkeletonStore.getState();
    const animationState = useAnimationStore.getState();
    const slotState = useSlotStore.getState();

    const skeletonJSON = exportSpineJSON(
      skeletonState.bones,
      slotState.slots,
      slotState.attachments,
      animationState.keyframes,
      animationState.fps,
      animationState.duration
    );

    const { atlas, images } = createTextureAtlas(slotState.attachments);

    const zip = new JSZip();
    zip.file('skeleton.json', skeletonJSON);
    zip.file('atlas.atlas', atlas);

    images.forEach((imageData, name) => {
      const base64Data = imageData.split(',')[1];
      zip.file(`${name}.png`, base64Data, { base64: true });
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spine-export.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportVideo = async () => {
    try {
      console.log('Starting video export...');
      const skeletonState = useSkeletonStore.getState();
      const animationState = useAnimationStore.getState();
      const slotState = useSlotStore.getState();
      const cameraState = useCameraStore.getState();

      const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));

      await exportVideo(
        bonesCopy,
        slotState.slots,
        slotState.attachments,
        skeletonState.skins,
        animationState.keyframes,
        animationState.duration,
        animationState.fps,
        cameraState.x,
        cameraState.y,
        cameraState.zoom
      );
      console.log('Video export completed!');
    } catch (error) {
      console.error('Video export failed:', error);
      alert('Video export failed. Check console for details.');
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

      <button
        onClick={() => {
          if (selectedBoneId === null) return;
          const animState = useAnimationStore.getState();
          const boneKeyframes = animState.keyframes[selectedBoneId];
          if (boneKeyframes) {
            const frames = Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
            if (frames.length > 0) {
              const firstFrame = frames[0];
              const firstKey = boneKeyframes[firstFrame];
              if (firstKey) {
                captureSnapshot();
                insertKeyframe(selectedBoneId, firstKey);
              }
            }
          }
        }}
        disabled={selectedBoneId === null}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px] disabled:opacity-40"
        title="Copy first keyframe to current frame for smooth looping"
      >
        <Diamond size={14} />
        Loop
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={handleAddSkin}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
      >
        <Plus size={14} />
        Add Skin
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Save Project"
      >
        <Save size={14} />
        Save
      </button>

      <button
        onClick={handleLoad}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Load Project"
      >
        <Upload size={14} />
        Load
      </button>

      <button
        onClick={handleExportSpine}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Export for PixiJS (@pixi/spine)"
      >
        <Download size={14} />
        Export Spine
      </button>

      <button
        onClick={handleExportVideo}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Export animation as video (WebM)"
      >
        <Video size={14} />
        Export Video
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

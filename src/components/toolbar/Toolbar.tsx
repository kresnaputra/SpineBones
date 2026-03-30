import { useEffect, useEffectEvent } from 'react';
import { MousePointer, Bone, Move, RotateCw, Maximize2, Diamond, X, Undo2, Redo2, Save, Upload, Download, Video, Image, XCircle } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useCameraStore } from '../../stores/cameraStore';
import { saveProject, loadProject, getSuggestedProjectFileName } from '../../utils/projectPersistence';
import { getFileNameFromPath, isDesktopApp, openImageFile, saveBlobFile, stripExtension } from '../../utils/nativeIO';
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

const IMAGE_FILTERS = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
];

export const Toolbar = () => {
  const { tool, mode, setTool, setMode, selectedBoneId, setBackgroundImage } = useEditorStore();
  const { saveSetupPose, restoreSetupPose } = useSkeletonStore();
  const { insertKeyframe, clearKeyframes } = useAnimationStore();
  const { bones } = useSkeletonStore();
  const { captureSnapshot, undo, redo, past, future } = useHistoryStore();
  const showToolbarFileActions = !isDesktopApp();

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

  const handleSave = async () => {
    try {
      await saveProject();
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('Failed to save project. Check console for details.');
    }
  };

  const handleLoad = async () => {
    try {
      await loadProject();
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('Failed to load project. Check console for details.');
    }
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
      animationState.fps
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
    const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-export.zip`;
    await saveBlobFile(suggestedName, blob, [
      {
        name: 'ZIP Archive',
        extensions: ['zip'],
      },
    ]);
  };

  const handleExportVideo = async () => {
    try {
      console.log('Starting video export...');
      const skeletonState = useSkeletonStore.getState();
      const animationState = useAnimationStore.getState();
      const slotState = useSlotStore.getState();
      const cameraState = useCameraStore.getState();
      const editorState = useEditorStore.getState();

      const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));

      const blob = await exportVideo(
        bonesCopy,
        slotState.slots,
        slotState.attachments,
        animationState.keyframes,
        animationState.duration,
        animationState.fps,
        cameraState.x,
        cameraState.y,
        cameraState.zoom,
        editorState.backgroundImage
      );
      const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-animation.webm`;
      await saveBlobFile(suggestedName, blob, [
        {
          name: 'WebM Video',
          extensions: ['webm'],
        },
      ]);
      console.log('Video export completed!');
    } catch (error) {
      console.error('Video export failed:', error);
      alert('Video export failed. Check console for details.');
    }
  };

  const handleExportSpineMenuEvent = useEffectEvent(() => {
    void handleExportSpine();
  });

  const handleExportVideoMenuEvent = useEffectEvent(() => {
    void handleExportVideo();
  });

  useEffect(() => {
    window.addEventListener('spine:file-export-spine', handleExportSpineMenuEvent);
    window.addEventListener('spine:file-export-video', handleExportVideoMenuEvent);

    return () => {
      window.removeEventListener('spine:file-export-spine', handleExportSpineMenuEvent);
      window.removeEventListener('spine:file-export-video', handleExportVideoMenuEvent);
    };
  }, []);

  const handleBackgroundUpload = async () => {
    try {
      const image = await openImageFile({ filters: IMAGE_FILTERS });
      if (!image) return;
      console.log('Background image loaded:', getFileNameFromPath(image.path ?? image.name));
      setBackgroundImage(image.dataUrl);
    } catch (error) {
      console.error('Failed to load background image:', error);
      alert('Failed to load background image. Check console for details.');
    }
  };

  const handleRemoveBackground = () => {
    console.log('Remove background clicked');
    setBackgroundImage(null);
    console.log('Background set to null');
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-panel border-b border-border h-12 flex-shrink-0 panel-padding-left">
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

      {showToolbarFileActions ? (
        <>
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

          <div className="w-px h-6 bg-border mx-1" />
        </>
      ) : null}

      <button
        onClick={handleBackgroundUpload}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Upload background image"
      >
        <Image size={14} />
        Background
      </button>

      <button
        onClick={handleRemoveBackground}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
        title="Remove background image"
      >
        <XCircle size={14} />
        Remove BG
      </button>

      <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-panel2 p-1">
        <button
          onClick={() => {
            restoreSetupPose();
            setMode('setup');
          }}
          className={`min-w-[84px] rounded-md px-5 py-2 text-[11px] font-semibold tracking-wide transition-all ${
            mode === 'setup'
              ? 'bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]'
              : 'text-text-dim hover:bg-panel hover:text-text'
          }`}
        >
          SETUP
        </button>
        <button
          onClick={() => {
            const { bones: currentBones, setupPose: oldSetupPose } = useSkeletonStore.getState();
            const { shiftKeyframes } = useAnimationStore.getState();

            // Calculate deltas between old setup pose and current bone positions
            const deltas: Record<number, { dx: number; dy: number; dRot: number; dScaleX: number; dScaleY: number }> = {};
            let hasDeltas = false;
            if (Object.keys(oldSetupPose).length > 0) {
              currentBones.forEach((bone) => {
                const old = oldSetupPose[bone.id];
                if (old) {
                  const dx = bone.x - old.x;
                  const dy = bone.y - old.y;
                  const dRot = bone.rotation - old.rotation;
                  const dScaleX = bone.scaleX - old.scaleX;
                  const dScaleY = bone.scaleY - old.scaleY;
                  if (dx !== 0 || dy !== 0 || dRot !== 0 || dScaleX !== 0 || dScaleY !== 0) {
                    deltas[bone.id] = { dx, dy, dRot, dScaleX, dScaleY };
                    hasDeltas = true;
                  }
                }
              });
            }

            // Shift existing keyframes by deltas so they match the new setup pose
            if (hasDeltas) {
              shiftKeyframes(deltas);
            }

            saveSetupPose();
            setMode('animate');
          }}
          className={`min-w-[84px] rounded-md px-5 py-2 text-[11px] font-semibold tracking-wide transition-all ${
            mode === 'animate'
              ? 'bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]'
              : 'text-text-dim hover:bg-panel hover:text-text'
          }`}
        >
          ANIMATE
        </button>
      </div>
    </div>
  );
};

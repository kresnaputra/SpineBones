import { useEffect, useEffectEvent, useState } from 'react';
import { MousePointer, Bone, Move, RotateCw, Maximize2, Undo2, Redo2, Save, Upload, Video, Image, XCircle, ArrowLeftRight, ArrowUpDown, Grid2x2, Eye, Images, FolderOpen, Scan, Monitor } from 'lucide-react';
import { SpriteSheetExportDialog } from '../export/SpriteSheetExportDialog';
import { PngSequenceExportDialog } from '../export/PngSequenceExportDialog';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useCameraStore } from '../../stores/cameraStore';
import { saveProject, loadProject, getSuggestedProjectFileName } from '../../utils/projectPersistence';
import { getFileNameFromPath, isDesktopApp, openImageFile, saveBlobFile, stripExtension } from '../../utils/nativeIO';
import { exportVideo } from '../../utils/videoExporter';
import { exportSpriteSheet } from '../../utils/spriteSheetExporter';
import { exportPngSequence } from '../../utils/pngSequenceExporter';
import { ensureMeshAttachmentAsync } from '../../utils/meshAttachment';
import type { Tool } from '../../types';

const TOOL_ICONS = {
  pose: MousePointer,
  bone: Bone,
  move: Move,
  rotate: RotateCw,
  scale: Maximize2,
  mesh: Scan,
};

const TOOL_LABELS = {
  pose: 'Pose',
  bone: 'Bone',
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
  mesh: 'Mesh',
};

const TOOL_SHORTCUTS = {
  pose: 'Q',
  bone: 'B',
  move: 'G',
  rotate: 'R',
  scale: 'S',
  mesh: 'M',
};

const IMAGE_FILTERS = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
];

export const Toolbar = () => {
  const [showSpriteSheetDialog, setShowSpriteSheetDialog] = useState(false);
  const [showPngSequenceDialog, setShowPngSequenceDialog] = useState(false);
  const {
    tool,
    mode,
    setTool,
    setMode,
    selectedBoneId,
    selectedBoneIds,
    selectedSlotId,
    onionSkinEnabled,
    toggleOnionSkin,
    showViewport,
    toggleViewport,
    setBackgroundImage,
    setShowProjectBrowser,
  } = useEditorStore();
  const { saveSetupPose, restoreSetupPose, updateBone } = useSkeletonStore();
  const { insertKeyframe } = useAnimationStore();
  const { bones } = useSkeletonStore();
  const { slots, attachments, updateAttachment } = useSlotStore();
  const { captureSnapshot, undo, redo, past, future } = useHistoryStore();
  const showToolbarFileActions = !isDesktopApp();
  const showProjectBrowserButton = isDesktopApp();

  const activeSlot =
    selectedBoneId === null
      ? null
      : ((selectedSlotId !== null
          ? slots.find(
              (slot) =>
                slot.id === selectedSlotId &&
                slot.boneId === selectedBoneId &&
                slot.attachmentName,
            ) ?? null
          : null) ??
        slots.find((slot) => slot.boneId === selectedBoneId && slot.attachmentName) ??
        null);
  const activeAttachment =
    activeSlot && activeSlot.attachmentName
      ? attachments.find(
          (attachment) =>
            attachment.slotId === activeSlot.id && attachment.name === activeSlot.attachmentName,
        ) ?? null
      : null;


  const handleMirror = (axis: 'horizontal' | 'vertical') => {
    if (selectedBoneIds.length === 0) return;

    captureSnapshot();
    selectedBoneIds.forEach((boneId) => {
      const bone = bones.find((item) => item.id === boneId);
      if (!bone) return;

      const nextScaleX = axis === 'horizontal' ? bone.scaleX * -1 : bone.scaleX;
      const nextScaleY = axis === 'vertical' ? bone.scaleY * -1 : bone.scaleY;

      updateBone(boneId, {
        scaleX: nextScaleX,
        scaleY: nextScaleY,
      });

      if (mode === 'animate') {
        insertKeyframe(boneId, {
          x: bone.x,
          y: bone.y,
          rotation: bone.rotation,
          scaleX: nextScaleX,
          scaleY: nextScaleY,
        });
      }
    });
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
        animationState.meshDeformKeyframes,
        animationState.attachmentOpacityKeyframes,
        animationState.slotAttachmentKeyframes,
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

  const handleExportSpriteSheet = async (settings: { resolution: number; maxFramesPerSheet: number }) => {
    try {
      setShowSpriteSheetDialog(false);
      const skeletonState = useSkeletonStore.getState();
      const animationState = useAnimationStore.getState();
      const slotState = useSlotStore.getState();
      const cameraState = useCameraStore.getState();

      const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));

      const blob = await exportSpriteSheet({
        bones: bonesCopy,
        slots: slotState.slots,
        attachments: slotState.attachments,
        keyframes: animationState.keyframes,
        meshDeformKeyframes: animationState.meshDeformKeyframes,
        attachmentOpacityKeyframes: animationState.attachmentOpacityKeyframes,
        slotAttachmentKeyframes: animationState.slotAttachmentKeyframes,
        duration: animationState.duration,
        fps: animationState.fps,
        camX: cameraState.x,
        camY: cameraState.y,
        camZoom: cameraState.zoom,
        frameWidth: settings.resolution,
        frameHeight: settings.resolution,
        maxFramesPerSheet: settings.maxFramesPerSheet,
      });

      const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-spritesheet.zip`;
      await saveBlobFile(suggestedName, blob, [
        {
          name: 'ZIP Archive',
          extensions: ['zip'],
        },
      ]);
    } catch (error) {
      console.error('Sprite sheet export failed:', error);
      alert('Sprite sheet export failed. Check console for details.');
    }
  };

  const handleExportPngSequence = async (settings: { resolution: number }) => {
    try {
      setShowPngSequenceDialog(false);
      const clamped = Math.min(4096, settings.resolution);
      const frameSize = { width: clamped, height: clamped };

      const skeletonState = useSkeletonStore.getState();
      const animationState = useAnimationStore.getState();
      const slotState = useSlotStore.getState();
      const cameraState = useCameraStore.getState();
      const editorState = useEditorStore.getState();

      const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));

      const blob = await exportPngSequence({
        bones: bonesCopy,
        slots: slotState.slots,
        attachments: slotState.attachments,
        keyframes: animationState.keyframes,
        meshDeformKeyframes: animationState.meshDeformKeyframes,
        attachmentOpacityKeyframes: animationState.attachmentOpacityKeyframes,
        slotAttachmentKeyframes: animationState.slotAttachmentKeyframes,
        duration: animationState.duration,
        fps: animationState.fps,
        camX: cameraState.x,
        camY: cameraState.y,
        camZoom: cameraState.zoom,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
        backgroundImage: editorState.backgroundImage,
        includeBackground: false,
        crop: true,
      });

      const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-png-sequence.zip`;
      await saveBlobFile(suggestedName, blob, [
        {
          name: 'ZIP Archive',
          extensions: ['zip'],
        },
      ]);
    } catch (error) {
      console.error('PNG sequence export failed:', error);
      alert('PNG sequence export failed. Check console for details.');
    }
  };

  const handleExportVideoMenuEvent = useEffectEvent(() => {
    void handleExportVideo();
  });

  const handleExportSpriteSheetMenuEvent = useEffectEvent(() => {
    setShowSpriteSheetDialog(true);
  });

  const handleExportPngSequenceMenuEvent = useEffectEvent(() => {
    setShowPngSequenceDialog(true);
  });

  useEffect(() => {
    window.addEventListener('spine:file-export-video', handleExportVideoMenuEvent);
    window.addEventListener('spine:file-export-spritesheet', handleExportSpriteSheetMenuEvent);
    window.addEventListener('spine:file-export-png-sequence', handleExportPngSequenceMenuEvent);

    return () => {
      window.removeEventListener('spine:file-export-video', handleExportVideoMenuEvent);
      window.removeEventListener('spine:file-export-spritesheet', handleExportSpriteSheetMenuEvent);
      window.removeEventListener('spine:file-export-png-sequence', handleExportPngSequenceMenuEvent);
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
            onClick={async () => {
              if (t === 'mesh') {
                if (!activeSlot || !activeAttachment) return;
                if (activeAttachment.type !== 'mesh') {
                  captureSnapshot();
                  updateAttachment(
                    activeSlot.id,
                    activeAttachment.name,
                    await ensureMeshAttachmentAsync(activeAttachment),
                  );
                }
              }
              setTool(t);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] ${
              tool === t
                ? 'bg-accent text-white border-accent'
                : 'bg-transparent text-text-dim border-transparent hover:bg-panel2 hover:text-text hover:border-border'
            }`}
            title={`${TOOL_LABELS[t]} (${TOOL_SHORTCUTS[t]})`}
            disabled={t === 'mesh' && !activeAttachment}
          >
            <Icon size={14} />
            {TOOL_LABELS[t]}
          </button>
        );
      })}

      <button
        onClick={() => handleMirror('horizontal')}
        disabled={selectedBoneIds.length === 0}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-dim disabled:hover:border-transparent"
        title="Mirror selected bones horizontally"
      >
        <ArrowLeftRight size={14} />
        Mirror H
      </button>

      <button
        onClick={() => handleMirror('vertical')}
        disabled={selectedBoneIds.length === 0}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-dim disabled:hover:border-transparent"
        title="Mirror selected bones vertically"
      >
        <ArrowUpDown size={14} />
        Mirror V
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      {showProjectBrowserButton ? (
        <button
          onClick={() => setShowProjectBrowser(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
          title="Open project browser"
        >
          <FolderOpen size={14} />
          Browser
        </button>
      ) : null}

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

      {showToolbarFileActions ? (
        <>
          <div className="w-px h-6 bg-border mx-1" />

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
            title="Save project package (.sbn)"
          >
            <Save size={14} />
            Save Package
          </button>

          <button
            onClick={handleLoad}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
            title="Import or open project package (.sbn) or legacy JSON"
          >
            <Upload size={14} />
            Import Project
          </button>

          <button
            onClick={handleExportVideo}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
            title="Export animation as video (WebM)"
          >
            <Video size={14} />
            Export Video
          </button>

          <button
            onClick={() => setShowSpriteSheetDialog(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
            title="Export animation as sprite sheet PNG + JSON"
          >
            <Grid2x2 size={14} />
            Sprite Sheet
          </button>

          <button
            onClick={() => setShowPngSequenceDialog(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border transition-all text-[11px]"
            title="Export animation as PNG sequence ZIP"
          >
            <Images size={14} />
            PNG Sequence
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

      <button
        onClick={toggleOnionSkin}
        disabled={mode !== 'animate'}
        className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-dim disabled:hover:border-transparent ${
          onionSkinEnabled
            ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/50 hover:bg-cyan-600/25'
            : 'border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border'
        }`}
        title="Toggle onion skin preview (O)"
      >
        <Eye size={14} />
        Onion
      </button>

      <button
        onClick={toggleViewport}
        className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] ${
          showViewport
            ? 'bg-violet-600/20 text-violet-300 border-violet-500/50 hover:bg-violet-600/25'
            : 'border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border'
        }`}
        title="Toggle 16:9 video viewport overlay"
      >
        <Monitor size={14} />
        Viewport
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

      {showSpriteSheetDialog && (
        <SpriteSheetExportDialog
          onExport={handleExportSpriteSheet}
          onClose={() => setShowSpriteSheetDialog(false)}
        />
      )}

      {showPngSequenceDialog && (
        <PngSequenceExportDialog
          onExport={handleExportPngSequence}
          onClose={() => setShowPngSequenceDialog(false)}
        />
      )}
    </div>
  );
};

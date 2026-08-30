import { useEffect, useEffectEvent, useState } from 'react';
import { MousePointer, Bone, Move, RotateCw, Maximize2, Undo2, Redo2, Save, Upload, Video, Image, XCircle, ArrowLeftRight, ArrowUpDown, Grid2x2, Eye, Images, FolderOpen, Monitor, ScanLine, Paintbrush } from 'lucide-react';
import { SpriteSheetExportDialog } from '../export/SpriteSheetExportDialog';
import { PngSequenceExportDialog } from '../export/PngSequenceExportDialog';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useCameraStore } from '../../stores/cameraStore';
import { useDeformerStore } from '../../stores/deformerStore';
import { saveProject, loadProject, getSuggestedProjectFileName } from '../../utils/projectPersistence';
import { getFileNameFromPath, isDesktopApp, openImageFile, pickSaveFilePath, saveBlobFile, saveBlobToPath, stripExtension } from '../../utils/nativeIO';
import { exportVideo } from '../../utils/videoExporter';
import { exportAudioMix } from '../../utils/audioExporter';
import { exportSpriteSheet } from '../../utils/spriteSheetExporter';
import { exportPngSequence } from '../../utils/pngSequenceExporter';

/**
 * Both archive exports name their contents after the file the user saves to, so
 * they prompt for the destination up front and share these filters.
 */
const ZIP_FILTERS = [{ name: 'ZIP Archive', extensions: ['zip'] }];

const TOOL_ICONS = {
  pose: MousePointer,
  bone: Bone,
  move: Move,
  rotate: RotateCw,
  scale: Maximize2,
  mesh: ScanLine,
  warp: Grid2x2,
  weights: Paintbrush,
};

const TOOL_LABELS = {
  pose: 'Pose',
  bone: 'Bone',
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
  mesh: 'Mesh',
  warp: 'Warp',
  weights: 'Weights',
};

const TOOL_SHORTCUTS: Partial<Record<keyof typeof TOOL_LABELS, string>> = {
  pose: 'Q',
  bone: 'B',
  move: 'M',
  rotate: 'R',
  scale: 'S',
  mesh: 'H',
  warp: 'G',
  weights: 'P',
};

const IMAGE_FILTERS = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
];

const getSiblingPath = (path: string, fileName: string) => {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${path.slice(0, separatorIndex + 1)}${fileName}` : fileName;
};

export const Toolbar = () => {
  const [showSpriteSheetDialog, setShowSpriteSheetDialog] = useState(false);
  const [showPngSequenceDialog, setShowPngSequenceDialog] = useState(false);
  const {
    tool,
    mode,
    setTool,
    setMode,
    selectedBoneIds,
    onionSkinEnabled,
    toggleOnionSkin,
    showViewport,
    toggleViewport,
    pixelArtEnabled,
    pixelArtSize,
    lineBoilEnabled,
    inBetweenEnabled,
    setPixelArtEnabled,
    setPixelArtSize,
    setLineBoilEnabled,
    setInBetweenEnabled,
    setBackgroundImage,
    setShowProjectBrowser,
  } = useEditorStore();
  const saveSetupPose = useSkeletonStore((state) => state.saveSetupPose);
  const restoreSetupPose = useSkeletonStore((state) => state.restoreSetupPose);
  const updateBone = useSkeletonStore((state) => state.updateBone);
  const insertKeyframe = useAnimationStore((state) => state.insertKeyframe);
  const { captureSnapshot, undo, redo, past, future } = useHistoryStore();
  const showToolbarFileActions = !isDesktopApp();
  const showProjectBrowserButton = isDesktopApp();

  const handlePixelArtToggle = () => {
    const enabled = !pixelArtEnabled;
    captureSnapshot();
    setPixelArtEnabled(enabled);
    useSlotStore.setState((state) => ({
      attachments: state.attachments.map((attachment) => ({
        ...attachment,
        pixelated: enabled,
        pixelSize: pixelArtSize,
      })),
    }));
  };

  const handleLineBoilToggle = () => {
    const enabled = !lineBoilEnabled;
    captureSnapshot();
    setLineBoilEnabled(enabled);
    useSlotStore.setState((state) => ({
      attachments: state.attachments.map((attachment) => ({
        ...attachment,
        lineBoil: enabled,
      })),
    }));
  };

  const handlePixelArtSizeChange = (size: number) => {
    const nextSize = Math.max(1, Math.min(32, Math.round(size)));
    captureSnapshot();
    setPixelArtSize(nextSize);
    useSlotStore.setState((state) => ({
      attachments: state.attachments.map((attachment) => ({
        ...attachment,
        pixelSize: nextSize,
      })),
    }));
  };

  const handleInBetweenToggle = () => {
    captureSnapshot();
    setInBetweenEnabled(!inBetweenEnabled);
    if (mode === 'animate') {
      useAnimationStore.getState().applyKeyframes();
    }
  };

  const handleMirror = (axis: 'horizontal' | 'vertical') => {
    if (selectedBoneIds.length === 0) return;

    const { bones } = useSkeletonStore.getState();
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

      const deformerState = useDeformerStore.getState();

      const { blob, extension } = await exportVideo(
        bonesCopy,
        slotState.slots,
        slotState.attachments,
        animationState.keyframes,
        animationState.attachmentOpacityKeyframes,
        animationState.slotAttachmentKeyframes,
        animationState.duration,
        animationState.fps,
        cameraState.x,
        cameraState.y,
        cameraState.zoom,
        editorState.backgroundImage,
        undefined,
        undefined,
        animationState.meshDeformKeyframes,
        deformerState.deformerKeyframes,
        deformerState.deformers,
        editorState.inBetweenEnabled,
      );
      const exportBaseName = `${stripExtension(getSuggestedProjectFileName())}-animation`;
      const suggestedName = `${exportBaseName}.${extension}`;
      const savedPath = await saveBlobFile(suggestedName, blob, [
        {
          name: extension === 'mp4' ? 'MP4 Video' : 'WebM Video',
          extensions: [extension],
        },
      ]);
      if (isDesktopApp() && !savedPath) return;

      const audioBlob = await exportAudioMix({
        audioTracks: animationState.audioTracks,
        keyframes: animationState.keyframes,
        attachmentOpacityKeyframes: animationState.attachmentOpacityKeyframes,
        slotAttachmentKeyframes: animationState.slotAttachmentKeyframes,
        duration: animationState.duration,
        fps: animationState.fps,
      });

      if (audioBlob) {
        const audioName = `${exportBaseName}-audio.wav`;
        if (savedPath && isDesktopApp()) {
          await saveBlobToPath(getSiblingPath(savedPath, audioName), audioBlob);
        } else {
          await saveBlobFile(audioName, audioBlob, [
            {
              name: 'WAV Audio',
              extensions: ['wav'],
            },
          ]);
        }
      }
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
      const editorState = useEditorStore.getState();

      const bonesCopy = JSON.parse(JSON.stringify(skeletonState.bones));

      const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-spritesheet.zip`;
      const targetPath = await pickSaveFilePath(suggestedName, ZIP_FILTERS);
      if (isDesktopApp() && !targetPath) return;

      const archiveName = targetPath ? getFileNameFromPath(targetPath) : suggestedName;

      const blob = await exportSpriteSheet({
        bones: bonesCopy,
        slots: slotState.slots,
        attachments: slotState.attachments,
        keyframes: animationState.keyframes,
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
        inBetweenEnabled: editorState.inBetweenEnabled,
        baseName: stripExtension(archiveName),
      });

      if (targetPath) {
        await saveBlobToPath(targetPath, blob);
      } else {
        await saveBlobFile(suggestedName, blob, ZIP_FILTERS);
      }
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

      const suggestedName = `${stripExtension(getSuggestedProjectFileName())}-png-sequence.zip`;
      const targetPath = await pickSaveFilePath(suggestedName, ZIP_FILTERS);
      if (isDesktopApp() && !targetPath) return;

      const archiveName = targetPath ? getFileNameFromPath(targetPath) : suggestedName;
      const blob = await exportPngSequence({
        bones: bonesCopy,
        slots: slotState.slots,
        attachments: slotState.attachments,
        keyframes: animationState.keyframes,
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
        inBetweenEnabled: editorState.inBetweenEnabled,
        baseName: stripExtension(archiveName),
      });

      if (targetPath) {
        await saveBlobToPath(targetPath, blob);
      } else {
        await saveBlobFile(suggestedName, blob, ZIP_FILTERS);
      }
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
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-panel px-4 py-2 panel-padding-left">
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-thin">
        <div className="flex w-max min-w-full items-center gap-2 pr-2">
      {(Object.keys(TOOL_ICONS) as Array<keyof typeof TOOL_ICONS>).map((t) => {
        const Icon = TOOL_ICONS[t];
        return (
          <button
            key={t}
            onClick={() => {
              setTool(t);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] ${
              tool === t
                ? 'bg-accent text-white border-accent'
                : 'bg-transparent text-text-dim border-transparent hover:bg-panel2 hover:text-text hover:border-border'
            }`}
            title={TOOL_SHORTCUTS[t] ? `${TOOL_LABELS[t]} (${TOOL_SHORTCUTS[t]})` : TOOL_LABELS[t]}
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
            title="Open project package (.sbn)"
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
        onClick={handleInBetweenToggle}
        className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-[11px] ${
          inBetweenEnabled
            ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/25'
            : 'border-transparent bg-transparent text-text-dim hover:bg-panel2 hover:text-text hover:border-border'
        }`}
        title="Toggle automatic in-between interpolation"
      >
        <ArrowLeftRight size={14} />
        In-between
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

      <div className="flex items-center gap-1 rounded border border-border bg-panel2 p-1">
        <button
          onClick={handlePixelArtToggle}
          className={`flex items-center gap-2 rounded border px-2 py-1 text-[11px] transition-all ${
            pixelArtEnabled
              ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
              : 'border-transparent bg-transparent text-text-dim hover:border-border hover:text-text'
          }`}
          title="Toggle pixel-art rendering for all sprites"
        >
          <Grid2x2 size={14} />
          Pixel Art
        </button>
        <button
          onClick={handleLineBoilToggle}
          disabled={!pixelArtEnabled}
          className={`rounded border px-2 py-1 text-[11px] transition-all disabled:opacity-40 ${
            lineBoilEnabled && pixelArtEnabled
              ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
              : 'border-transparent bg-transparent text-text-dim hover:border-border hover:text-text'
          }`}
          title="Redraw pixel edges with a deterministic variation on every frame"
        >
          Line Boil
        </button>
        <label className="flex items-center gap-1 text-[10px] text-text-dim" title="Pixel block size">
          Size
          <input
            type="number"
            min="1"
            max="32"
            value={pixelArtSize}
            onChange={(event) => handlePixelArtSizeChange(Number(event.target.value) || 1)}
            className="w-11 rounded border border-border bg-panel px-1 py-1 text-center text-[11px] text-text focus:border-accent focus:outline-none"
          />
        </label>
      </div>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-panel2 p-1"
        style={{ marginRight: 16 }}
      >
        <button
          onClick={() => {
            restoreSetupPose();
            setMode('setup');
          }}
          className={`min-w-21 rounded-md px-5 py-2 text-[11px] font-semibold tracking-wide transition-all ${
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
            const deltas: Record<number, { dx: number; dy: number; dRot: number; dScaleX: number; dScaleY: number; dOrder: number }> = {};
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
                  const dOrder = bone.order - (old.order ?? bone.order);
                  if (dx !== 0 || dy !== 0 || dRot !== 0 || dScaleX !== 0 || dScaleY !== 0 || dOrder !== 0) {
                    deltas[bone.id] = { dx, dy, dRot, dScaleX, dScaleY, dOrder };
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
          className={`min-w-21 rounded-md px-5 py-2 text-[11px] font-semibold tracking-wide transition-all ${
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

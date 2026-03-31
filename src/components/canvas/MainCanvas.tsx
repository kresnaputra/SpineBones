import { useRef, useEffect, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useCameraStore } from '../../stores/cameraStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useSlotStore } from '../../stores/slotStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { drawGrid, drawOriginCross, drawBone } from '../../engine/renderer';
import { drawAttachmentOutline, drawSlots, hitTestAttachment } from '../../engine/imageRenderer';
import { hitTestBone } from '../../engine/hitTest';

export const MainCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const [backgroundLoaded, setBackgroundLoaded] = useState(0);
  const [imageLoadTrigger, setImageLoadTrigger] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);
  
  const { tool, mode, selectedBoneId, selectedBoneIds, selectBone, showBoneIndicators, attachmentDragEnabled, backgroundImage } = useEditorStore();
  const { bones, skins, activeSkinId, addBone, updateBone } = useSkeletonStore();
  const { keyframes, frame, insertKeyframe } = useAnimationStore();
  const { x: camX, y: camY, zoom: camZoom, setCanvasSize, pan, zoomBy, worldToScreen, screenToWorld } = useCameraStore();
  const { slots, attachments } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();

  const getTransformTargetIds = () => {
    const selectedSet = new Set(selectedBoneIds);
    if (selectedSet.size === 0) {
      return selectedBoneId === null ? [] : [selectedBoneId];
    }

    return selectedBoneIds.filter((boneId) => {
      const bone = bones.find((item) => item.id === boneId);
      return !selectedSet.has(bone?.parentId ?? -1);
    });
  };

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{
    startWorldX: number;
    startWorldY: number;
    sx: number;
    sy: number;
    anchorBoneId: number;
    bones: Record<number, {
      x: number;
      y: number;
      rotation: number;
      scaleX: number;
      scaleY: number;
      wx: number;
      wy: number;
      parentId: number | null;
    }>;
  } | null>(null);
  const [attachmentDragStart, setAttachmentDragStart] = useState<{
    slotId: number;
    attachmentName: string;
    initialX: number;
    initialY: number;
    startSx: number;
    startSy: number;
    totalRotation: number;
  } | null>(null);

  useEffect(() => {
    if (!backgroundImage) {
      console.log('Background is null, clearing ref');
      if (backgroundImageRef.current) {
        console.log('Clearing background ref and triggering re-render');
        backgroundImageRef.current = null;
      }
      return;
    }
    
    const img = new Image();
    img.onload = () => {
      backgroundImageRef.current = img;
      setBackgroundLoaded(prev => prev + 1);
    };
    img.onerror = () => {
      console.error('Failed to load background image');
      backgroundImageRef.current = null;
    };
    img.src = backgroundImage;
  }, [backgroundImage]);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth, clientHeight } = wrapRef.current;
      canvasRef.current.width = clientWidth;
      canvasRef.current.height = clientHeight;
      setCanvasSize(clientWidth, clientHeight);
      setResizeTick((tick) => tick + 1);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setCanvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (backgroundImageRef.current) {
      const scale = Math.max(canvas.width / backgroundImageRef.current.width, canvas.height / backgroundImageRef.current.height);
      const w = backgroundImageRef.current.width * scale;
      const h = backgroundImageRef.current.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
      ctx.globalAlpha = 0.3;
      ctx.drawImage(backgroundImageRef.current, x, y, w, h);
      ctx.globalAlpha = 1.0;
    }
    
    drawGrid(ctx, camX, camY, camZoom, canvas.width, canvas.height);
    drawOriginCross(ctx, worldToScreen);

    computeAllWorldTransforms(bones);

    const handleImageLoad = () => {
      setImageLoadTrigger(prev => prev + 1);
    };

    drawSlots(ctx, slots, attachments, bones, worldToScreen, camZoom, handleImageLoad);

    if (attachmentDragEnabled && selectedBoneId !== null) {
      const activeSlot = slots.find((slot) => slot.boneId === selectedBoneId && slot.attachmentName);
      const selectedBone = bones.find((bone) => bone.id === selectedBoneId);
      const activeAttachment = activeSlot
        ? attachments.find((attachment) => attachment.slotId === activeSlot.id && attachment.name === activeSlot.attachmentName)
        : null;

      if (activeSlot && selectedBone && activeAttachment) {
        drawAttachmentOutline(ctx, activeAttachment, selectedBone, worldToScreen, camZoom);
      }
    }

    if (showBoneIndicators) {
      bones.forEach((bone) => {
        const skin = skins.find((s) => s.id === bone.skinId);
        const isSelected = selectedBoneIds.includes(bone.id);
        const isHovered = hoveredBoneId === bone.id;
        const hasKeyframe = mode === 'animate' && keyframes[bone.id]?.[frame] !== undefined;

        drawBone(ctx, bone, skin, isSelected, isHovered, tool, mode, hasKeyframe, worldToScreen);
      });
    }

  }, [bones, skins, selectedBoneId, selectedBoneIds, hoveredBoneId, camX, camY, camZoom, tool, mode, keyframes, frame, worldToScreen, slots, attachments, showBoneIndicators, attachmentDragEnabled, backgroundImage, backgroundLoaded, imageLoadTrigger, resizeTick]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning && panStart) {
      pan(sx - panStart.x, sy - panStart.y);
      setPanStart({ x: sx, y: sy });
      return;
    }

    if (attachmentDragStart) {
      const dx = sx - attachmentDragStart.startSx;
      const dy = sy - attachmentDragStart.startSy;
      const cos = Math.cos(-attachmentDragStart.totalRotation);
      const sin = Math.sin(-attachmentDragStart.totalRotation);
      const localDx = (dx * cos - dy * sin) / camZoom;
      const localDy = (dx * sin + dy * cos) / camZoom;

      useSlotStore.getState().updateAttachment(attachmentDragStart.slotId, attachmentDragStart.attachmentName, {
        x: attachmentDragStart.initialX + localDx,
        y: attachmentDragStart.initialY + localDy,
      });
      return;
    }

    if (isDragging && dragStart) {
      const world = screenToWorld(sx, sy);
      const transformTargetIds = getTransformTargetIds();
      const anchorBone = bones.find((b) => b.id === dragStart.anchorBoneId);
      if (!anchorBone || transformTargetIds.length === 0) return;

      if (tool === 'move' || tool === 'pose') {
        const deltaX = world.x - dragStart.startWorldX;
        const deltaY = world.y - dragStart.startWorldY;

        computeAllWorldTransforms(bones);

        transformTargetIds.forEach((boneId) => {
          const initialState = dragStart.bones[boneId];
          if (!initialState) return;

          let nextX = initialState.wx + deltaX;
          let nextY = initialState.wy + deltaY;

          if (initialState.parentId !== null) {
            const parent = bones.find((b) => b.id === initialState.parentId);
            if (parent) {
              const cos = Math.cos((-parent._wrot * Math.PI) / 180);
              const sin = Math.sin((-parent._wrot * Math.PI) / 180);
              const localDx = nextX - parent._wx;
              const localDy = nextY - parent._wy;
              nextX = (localDx * cos - localDy * sin) / parent.scaleX;
              nextY = (localDx * sin + localDy * cos) / parent.scaleY;
            }
          }

          updateBone(boneId, {
            x: nextX,
            y: nextY,
          });
        });
      } else if (tool === 'rotate') {
        computeAllWorldTransforms(bones);
        const bs = worldToScreen(anchorBone._wx, anchorBone._wy);
        const angle = (Math.atan2(sy - bs.y, sx - bs.x) * 180) / Math.PI;
        const initAngle = (Math.atan2(dragStart.sy - bs.y, dragStart.sx - bs.x) * 180) / Math.PI;
        const rotationDelta = angle - initAngle;

        transformTargetIds.forEach((boneId) => {
          const initialState = dragStart.bones[boneId];
          if (!initialState) return;

          updateBone(boneId, {
            rotation: initialState.rotation + rotationDelta,
          });
        });
      } else if (tool === 'scale') {
        computeAllWorldTransforms(bones);
        const bs = worldToScreen(anchorBone._wx, anchorBone._wy);
        const dist = Math.hypot(sx - bs.x, sy - bs.y);
        const initDist = Math.hypot(dragStart.sx - bs.x, dragStart.sy - bs.y);
        if (initDist > 0) {
          const factor = dist / initDist;
          transformTargetIds.forEach((boneId) => {
            const initialState = dragStart.bones[boneId];
            if (!initialState) return;

            updateBone(boneId, {
              scaleX: initialState.scaleX * factor,
              scaleY: initialState.scaleY * factor,
            });
          });
        }
      }
      return;
    }

    const hit = hitTestBone({ x: sx, y: sy }, bones, worldToScreen);
    setHoveredBoneId(hit?.id || null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 2) {
      setIsPanning(true);
      setPanStart({ x: sx, y: sy });
      return;
    }

    const world = screenToWorld(sx, sy);
    const hit = hitTestBone({ x: sx, y: sy }, bones, worldToScreen);

    if (attachmentDragEnabled && selectedBoneId !== null) {
      computeAllWorldTransforms(bones);
      const activeSlot = slots.find((slot) => slot.boneId === selectedBoneId && slot.attachmentName);
      const selectedBone = bones.find((bone) => bone.id === selectedBoneId);
      const activeAttachment = activeSlot
        ? attachments.find((attachment) => attachment.slotId === activeSlot.id && attachment.name === activeSlot.attachmentName)
        : null;

      if (
        activeSlot &&
        selectedBone &&
        activeAttachment &&
        hitTestAttachment(sx, sy, activeAttachment, selectedBone, worldToScreen, camZoom)
      ) {
        captureSnapshot();
        setAttachmentDragStart({
          slotId: activeSlot.id,
          attachmentName: activeAttachment.name,
          initialX: activeAttachment.x,
          initialY: activeAttachment.y,
          startSx: sx,
          startSy: sy,
          totalRotation: ((selectedBone._wrot + activeAttachment.rotation) * Math.PI) / 180,
        });
        return;
      }
    }

    if (tool === 'bone') {
      captureSnapshot();
      computeAllWorldTransforms(bones);
      
      let x = world.x;
      let y = world.y;
      let rotation = 0;
      const parentId = hit ? hit.id : null;

      if (parentId !== null) {
        const parent = bones.find((p) => p.id === parentId);
        if (parent) {
          rotation -= parent._wrot;
          x = 0;
          y = 0;
        }
      }

      const newBone = addBone({
        name: `bone_${bones.length}`,
        x,
        y,
        length: 50,
        rotation,
        scaleX: 1,
        scaleY: 1,
        parentId,
        skinId: activeSkinId,
        _wx: x,
        _wy: y,
        _wrot: rotation,
      });
      selectBone(newBone.id);
      return;
    }

    const target = hit || (tool !== 'pose' ? bones.find((b) => b.id === selectedBoneId) : null);
    const transformTargetIds = getTransformTargetIds();

    if (target) {
      captureSnapshot();
      if (hit && hit.id !== selectedBoneId) selectBone(hit.id);
      
      computeAllWorldTransforms(bones);
      const dragBones = Object.fromEntries(
        transformTargetIds
          .map((boneId) => {
            const bone = bones.find((item) => item.id === boneId);
            if (!bone) return null;

            return [
              boneId,
              {
                x: bone.x,
                y: bone.y,
                rotation: bone.rotation,
                scaleX: bone.scaleX,
                scaleY: bone.scaleY,
                wx: bone._wx,
                wy: bone._wy,
                parentId: bone.parentId,
              },
            ];
          })
          .filter((entry): entry is [number, {
            x: number;
            y: number;
            rotation: number;
            scaleX: number;
            scaleY: number;
            wx: number;
            wy: number;
            parentId: number | null;
          }] => entry !== null),
      );
      
      setIsDragging(true);
      setDragStart({
        startWorldX: world.x,
        startWorldY: world.y,
        sx,
        sy,
        anchorBoneId: target.id,
        bones: dragBones,
      });
    } else {
      selectBone(null);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setPanStart(null);

    if (isDragging && selectedBoneIds.length > 0 && mode === 'animate') {
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
    }

    setAttachmentDragStart(null);
    setIsDragging(false);
    setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomBy(factor);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  };

  return (
    <div
      ref={wrapRef}
      className="flex-1 relative overflow-hidden"
      style={{
        background: '#080810',
        backgroundImage: `
          radial-gradient(circle at 50% 50%, rgba(124,58,237,0.04) 0%, transparent 70%),
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 40px 40px, 40px 40px',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className="absolute top-0 left-0 cursor-crosshair"
      />
      
      <div className="absolute bottom-3 left-3 text-[10px] text-text-dim bg-bg/80 px-2.5 py-1.5 rounded-md border border-border leading-relaxed pointer-events-none">
        <div>Tool: <span className="text-text">{tool.charAt(0).toUpperCase() + tool.slice(1)}</span></div>
        <div>Mode: <span className="text-text">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span></div>
        <div>Bones: <span className="text-text">{bones.length}</span></div>
        <div>Frame: <span className="text-text">{frame}</span></div>
        <div>Attachment Drag: <span className="text-text">{attachmentDragEnabled ? 'On' : 'Off'}</span></div>
      </div>
    </div>
  );
};

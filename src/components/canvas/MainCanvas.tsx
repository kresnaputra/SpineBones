import { useRef, useEffect, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useCameraStore } from '../../stores/cameraStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useSlotStore } from '../../stores/slotStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { drawGrid, drawOriginCross, drawBone } from '../../engine/renderer';
import { drawSlots } from '../../engine/imageRenderer';
import { hitTestBone } from '../../engine/hitTest';

export const MainCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  
  const { tool, mode, selectedBoneId, selectBone, backgroundImage } = useEditorStore();
  const { bones, skins, activeSkinId, addBone, updateBone } = useSkeletonStore();
  const { keyframes, frame, insertKeyframe } = useAnimationStore();
  const { x: camX, y: camY, zoom: camZoom, setCanvasSize, pan, zoomBy, worldToScreen, screenToWorld } = useCameraStore();
  const { slots, attachments } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{
    dx: number;
    dy: number;
    sx: number;
    sy: number;
    initSX: number;
    initSY: number;
    initRot: number;
  } | null>(null);

  useEffect(() => {
    if (!backgroundImage) {
      backgroundImageRef.current = null;
      return;
    }
    
    const img = new Image();
    img.onload = () => {
      backgroundImageRef.current = img;
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
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
      const scale = Math.min(canvas.width / backgroundImageRef.current.width, canvas.height / backgroundImageRef.current.height);
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

    drawSlots(ctx, slots, attachments, bones, worldToScreen, camZoom);

    bones.forEach((bone) => {
      const skin = skins.find((s) => s.id === bone.skinId);
      const isSelected = selectedBoneId === bone.id;
      const isHovered = hoveredBoneId === bone.id;
      const hasKeyframe = mode === 'animate' && keyframes[bone.id]?.[frame] !== undefined;

      drawBone(ctx, bone, skin, isSelected, isHovered, tool, mode, hasKeyframe, worldToScreen, camZoom);
    });

  }, [bones, skins, selectedBoneId, hoveredBoneId, camX, camY, camZoom, tool, mode, keyframes, frame, worldToScreen, slots, attachments, backgroundImage]);

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

    if (isDragging && dragStart) {
      const world = screenToWorld(sx, sy);
      const selectedBone = bones.find((b) => b.id === selectedBoneId);
      if (!selectedBone) return;

      if (tool === 'move' || tool === 'pose') {
        let newX = world.x - dragStart.dx;
        let newY = world.y - dragStart.dy;
        
        if (selectedBone.parentId !== null) {
          computeAllWorldTransforms(bones);
          const parent = bones.find((b) => b.id === selectedBone.parentId);
          if (parent) {
            const cos = Math.cos((-parent._wrot * Math.PI) / 180);
            const sin = Math.sin((-parent._wrot * Math.PI) / 180);
            const dx = newX - parent._wx;
            const dy = newY - parent._wy;
            newX = dx * cos - dy * sin;
            newY = dx * sin + dy * cos;
            newX /= parent.scaleX;
            newY /= parent.scaleY;
          }
        }
        
        updateBone(selectedBone.id, {
          x: newX,
          y: newY,
        });
      } else if (tool === 'rotate') {
        computeAllWorldTransforms(bones);
        const bs = worldToScreen(selectedBone._wx, selectedBone._wy);
        const angle = (Math.atan2(sy - bs.y, sx - bs.x) * 180) / Math.PI;
        const initAngle = (Math.atan2(dragStart.sy - bs.y, dragStart.sx - bs.x) * 180) / Math.PI;
        updateBone(selectedBone.id, {
          rotation: dragStart.initRot + (angle - initAngle),
        });
      } else if (tool === 'scale') {
        computeAllWorldTransforms(bones);
        const bs = worldToScreen(selectedBone._wx, selectedBone._wy);
        const dist = Math.hypot(sx - bs.x, sy - bs.y);
        const initDist = Math.hypot(dragStart.sx - bs.x, dragStart.sy - bs.y);
        if (initDist > 0) {
          const factor = dist / initDist;
          updateBone(selectedBone.id, {
            scaleX: dragStart.initSX * factor,
            scaleY: dragStart.initSY * factor,
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

    if (target) {
      captureSnapshot();
      if (hit && hit.id !== selectedBoneId) selectBone(hit.id);
      setIsDragging(true);
      setDragStart({
        dx: world.x - target.x,
        dy: world.y - target.y,
        sx,
        sy,
        initSX: target.scaleX,
        initSY: target.scaleY,
        initRot: target.rotation,
      });
    } else {
      selectBone(null);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setPanStart(null);

    if (isDragging && selectedBoneId !== null && mode === 'animate') {
      const bone = bones.find((b) => b.id === selectedBoneId);
      if (bone) {
        insertKeyframe(bone.id, {
          x: bone.x,
          y: bone.y,
          rotation: bone.rotation,
          scaleX: bone.scaleX,
          scaleY: bone.scaleY,
        });
      }
    }

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
      </div>
    </div>
  );
};

import { useRef, useEffect, useState, useEffectEvent } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useCameraStore } from '../../stores/cameraStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useSlotStore } from '../../stores/slotStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { drawGrid, drawOriginCross, drawBone, drawBoneRelation, drawGhostBone } from '../../engine/renderer';
import { drawAttachmentOutline, drawSlotOutlines, drawSlots, hitTestAttachment,getAttachmentMeshScreenVertices } from '../../engine/imageRenderer';
import {
  getViewportRect,
  getViewportScale,
  getViewportEffectiveZoom,
  createViewportWorldToScreen,
  createViewportScreenToWorld,
} from '../../engine/viewport';
import { hitTestBone } from '../../engine/hitTest';
import { getIkChain, getIkRootForBone, solveTwoBoneIk } from '../../utils/ik';
import { getAdjacentKeyframes, sampleBonesAtFrame } from '../../utils/animationPose';
import {
  ensureMeshAttachmentAsync,
  getMeshAttachmentKey,
  resolveAttachmentAtFrame,
  insertMeshVertex,
  removeMeshVertices,
} from '../../utils/meshAttachment';
import { normalizeKeyframeEasing } from '../../utils/easing';
import { resolveSlotsAtFrame } from '../../utils/slotAnimation';

export const MainCanvas = () => {
  const IK_HANDLE_RADIUS = 10;
  const GHOST_MOVEMENT_EPSILON = 0.01;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const [backgroundLoaded, setBackgroundLoaded] = useState(0);
  const [imageLoadTrigger, setImageLoadTrigger] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);
  
  const {
    tool,
    mode,
    selectedBoneId,
    selectedBoneIds,
    selectedSlotId,
    selectBone,
    showBoneIndicators,
    showViewport,
    onionSkinEnabled,
    attachmentDragEnabled,
    backgroundImage,
    selectedMeshVertexIndices,
    setSelectedMeshVertexIndices,
  } = useEditorStore();
  const { bones, skins, activeSkinId, addBone, updateBone, ikChainRootIds, setupPose, updateSetupPoseBone } = useSkeletonStore();
  const {
    keyframes,
    slotAttachmentKeyframes,
    meshDeformKeyframes,
    attachmentOpacityKeyframes,
    frame,
    duration,
    insertKeyframe,
    setMeshDeformKeyframe,
    setMeshDeformKeyframeAtFrame,
    updateMeshDeformKeyframeEasing,
    remapBoneKeyframesForParentChange,
    replaceMeshDeformKeyframesForAttachment,
    clearMeshDeformKeyframesForAttachment,
  } = useAnimationStore();
  const { x: camX, y: camY, zoom: camZoom, canvasWidth, canvasHeight, setCanvasSize, pan, zoomBy } = useCameraStore();
  const { slots, attachments, updateAttachment } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();

  // Derive the shared viewport transform helpers for the current frame.
  // These are recomputed from camX/camY/camZoom/canvasSize on every render,
  // ensuring the editor preview and the video export use the same math.
  const viewportRect = getViewportRect(canvasWidth, canvasHeight);
  const vpScale = getViewportScale(viewportRect);
  const effectiveZoom = getViewportEffectiveZoom(viewportRect, camZoom);
  const previewWorldToScreen = createViewportWorldToScreen(viewportRect, camX, camY, camZoom);
  const previewScreenToWorld = createViewportScreenToWorld(viewportRect, camX, camY, camZoom);

  const isDescendantOfBone = (boneId: number, ancestorId: number) => {
    let current = bones.find((bone) => bone.id === boneId) ?? null;
    while (current) {
      const parentId = current.parentId;
      if (parentId === null) return false;
      if (parentId === ancestorId) return true;
      current = bones.find((bone) => bone.id === parentId) ?? null;
    }
    return false;
  };

  const setBoneParent = (childId: number, newParentId: number | null) => {
    const child = bones.find((bone) => bone.id === childId);
    if (!child) return false;

    const newParent =
      newParentId === null
        ? null
        : bones.find((bone) => bone.id === newParentId) ?? null;
    if (newParentId !== null && !newParent) return false;
    if (newParent && child.id === newParent.id) return false;
    if (newParent && isDescendantOfBone(newParent.id, child.id)) return false;
    if (child.parentId === newParentId) return false;

    captureSnapshot();
    computeAllWorldTransforms(bones);
    remapBoneKeyframesForParentChange(child.id, newParentId);

    const worldX = child._wx;
    const worldY = child._wy;
    const worldRot = child._wrot;
    let nextX = worldX;
    let nextY = worldY;
    let nextRotation = worldRot;

    if (newParent) {
      const cos = Math.cos((-newParent._wrot * Math.PI) / 180);
      const sin = Math.sin((-newParent._wrot * Math.PI) / 180);
      const dx = worldX - newParent._wx;
      const dy = worldY - newParent._wy;

      nextX = (dx * cos - dy * sin) / newParent.scaleX;
      nextY = (dx * sin + dy * cos) / newParent.scaleY;
      nextRotation = worldRot - newParent._wrot;
    }

    updateBone(child.id, {
      parentId: newParent?.id ?? null,
      x: nextX,
      y: nextY,
      rotation: nextRotation,
    });
    updateSetupPoseBone(child.id, {
      x: nextX,
      y: nextY,
      rotation: nextRotation,
      scaleX: child.scaleX,
      scaleY: child.scaleY,
    });
    return true;
  };

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

  const getDescendantBoneIds = (rootId: number) => {
    const descendantIds: number[] = [];
    const queue = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (currentId === undefined) break;

      bones.forEach((bone) => {
        if (bone.parentId !== currentId) return;
        descendantIds.push(bone.id);
        queue.push(bone.id);
      });
    }

    return descendantIds;
  };

  const getAnimatedKeyframeBoneIds = () => {
    const keyframeIds = new Set<number>();

    getTransformTargetIds().forEach((boneId) => {
      keyframeIds.add(boneId);
      getDescendantBoneIds(boneId).forEach((descendantId) => {
        keyframeIds.add(descendantId);
      });
    });

    return Array.from(keyframeIds);
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
    flipX: number;
    flipY: number;
  } | null>(null);
  const [ikDragStart, setIkDragStart] = useState<{ rootId: number; childId: number } | null>(null);
  const [hoveredMeshVertexIndex, setHoveredMeshVertexIndex] = useState<number | null>(null);
  const [meshDragStart, setMeshDragStart] = useState<{
    slotId: number;
    attachmentName: string;
    selectedIndices: number[];
    startScreenX: number;
    startScreenY: number;
    initialVertices: NonNullable<typeof attachments[number]['meshVertices']>;
  } | null>(null);
  const [meshMarquee, setMeshMarquee] = useState<{
    sx: number;
    sy: number;
    currentSx: number;
    currentSy: number;
    additive: boolean;
  } | null>(null);

  const resolvedSlots = resolveSlotsAtFrame(slots, frame, slotAttachmentKeyframes);
  const activeSlot = selectedBoneId === null
    ? null
    : ((selectedSlotId !== null
        ? resolvedSlots.find(
            (slot) =>
              slot.id === selectedSlotId &&
              slot.boneId === selectedBoneId &&
              slot.attachmentName,
          ) ?? null
        : null) ??
      resolvedSlots.find((slot) => slot.boneId === selectedBoneId && slot.attachmentName) ??
      null);
  const activeBone = selectedBoneId === null
    ? null
    : bones.find((bone) => bone.id === selectedBoneId) ?? null;
  const activeAttachment = activeSlot && activeSlot.attachmentName
    ? attachments.find((attachment) => attachment.slotId === activeSlot.id && attachment.name === activeSlot.attachmentName) ?? null
    : null;
  const resolvedActiveAttachment =
    activeAttachment
      ? resolveAttachmentAtFrame(
          activeAttachment,
          frame,
          meshDeformKeyframes,
          attachmentOpacityKeyframes,
        )
      : activeAttachment;
  const meshAttachment = resolvedActiveAttachment?.type === 'mesh' ? resolvedActiveAttachment : null;

  useEffect(() => {
    if (tool !== 'mesh' || !activeSlot || !activeAttachment || activeAttachment.type === 'mesh') {
      return;
    }

    let cancelled = false;

    const convertToMesh = async () => {
      captureSnapshot();
      const nextAttachment = await ensureMeshAttachmentAsync(activeAttachment);
      if (cancelled) return;
      updateAttachment(activeSlot.id, activeAttachment.name, nextAttachment);
    };

    void convertToMesh();

    return () => {
      cancelled = true;
    };
  }, [tool, activeSlot, activeAttachment, updateAttachment, captureSnapshot]);

  // Clear vertex selection when the mesh tool is exited or the active attachment changes.
  useEffect(() => {
    setSelectedMeshVertexIndices([]);
  }, [tool, activeSlot?.id, activeAttachment?.name, setSelectedMeshVertexIndices]);

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
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && wrapRef.current
        ? new ResizeObserver(() => handleResize())
        : null;

    if (wrapRef.current && resizeObserver) {
      resizeObserver.observe(wrapRef.current);
    }

    window.addEventListener('resize', handleResize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [setCanvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const viewportRect = getViewportRect(canvas.width, canvas.height);

    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showViewport) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.52)';
      ctx.fill('evenodd');
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(15, 23, 42, 0.32)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 10;
      ctx.fillRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
      ctx.restore();

      if (backgroundImageRef.current) {
        const scale = Math.max(
          viewportRect.width / backgroundImageRef.current.width,
          viewportRect.height / backgroundImageRef.current.height,
        );
        const w = backgroundImageRef.current.width * scale;
        const h = backgroundImageRef.current.height * scale;
        const x = viewportRect.x + (viewportRect.width - w) / 2;
        const y = viewportRect.y + (viewportRect.height - h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
        ctx.clip();
        ctx.globalAlpha = 0.3;
        ctx.drawImage(backgroundImageRef.current, x, y, w, h);
        ctx.globalAlpha = 1.0;
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        viewportRect.x + 0.5,
        viewportRect.y + 0.5,
        viewportRect.width - 1,
        viewportRect.height - 1,
      );
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
      ctx.strokeRect(
        viewportRect.x + 0.5,
        viewportRect.y + 0.5,
        viewportRect.width - 1,
        viewportRect.height - 1,
      );
      ctx.font = '11px JetBrains Mono';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillText('VIDEO VIEWPORT 16:9', viewportRect.x + 12, viewportRect.y + 20);
      ctx.restore();
    }
    
    drawGrid(ctx, camX, camY, effectiveZoom, canvas.width, canvas.height);
    drawOriginCross(ctx, previewWorldToScreen);

    computeAllWorldTransforms(bones);

    const handleImageLoad = () => {
      setImageLoadTrigger(prev => prev + 1);
    };

    const getMovedGhostBones = (ghostBones: typeof bones) =>
      ghostBones.filter((ghostBone) => {
        const currentBone = bones.find((bone) => bone.id === ghostBone.id);
        if (!currentBone) return false;

        return (
          Math.abs(currentBone._wx - ghostBone._wx) > GHOST_MOVEMENT_EPSILON ||
          Math.abs(currentBone._wy - ghostBone._wy) > GHOST_MOVEMENT_EPSILON ||
          Math.abs(currentBone._wrot - ghostBone._wrot) > GHOST_MOVEMENT_EPSILON ||
          Math.abs(currentBone.scaleX - ghostBone.scaleX) > GHOST_MOVEMENT_EPSILON ||
          Math.abs(currentBone.scaleY - ghostBone.scaleY) > GHOST_MOVEMENT_EPSILON
        );
      });

    const { previous, next } =
      mode === 'animate' && onionSkinEnabled
        ? getAdjacentKeyframes(keyframes, frame)
        : { previous: null, next: null };
    const previousFrame = previous !== null ? sampleBonesAtFrame(bones, keyframes, setupPose, previous) : null;
    const nextFrame = next !== null ? sampleBonesAtFrame(bones, keyframes, setupPose, next) : null;
    const previousMovedBones = previousFrame ? getMovedGhostBones(previousFrame) : [];
    const nextMovedBones = nextFrame ? getMovedGhostBones(nextFrame) : [];

    ctx.save();
    if (showViewport) {
      ctx.beginPath();
      ctx.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
      ctx.clip();
    }
    const resolvedAttachments = attachments.map((attachment) =>
      resolveAttachmentAtFrame(
        attachment,
        frame,
        meshDeformKeyframes,
        attachmentOpacityKeyframes,
      ),
    );
    drawSlots(ctx, resolvedSlots, resolvedAttachments, bones, previewWorldToScreen, effectiveZoom, 1, handleImageLoad, bones);

    if (activeSlot && activeBone && activeAttachment && (attachmentDragEnabled || tool === 'mesh')) {
      const outlineAttachment = resolvedActiveAttachment ?? activeAttachment;
      const pinnedVertexIndices = outlineAttachment.meshPinnedVertices
        ?.map((p, i) => (p ? i : -1))
        .filter((i) => i >= 0);
      drawAttachmentOutline(
        ctx,
        outlineAttachment,
        activeBone,
        previewWorldToScreen,
        effectiveZoom,
        tool === 'mesh'
          ? {
              showInternalEdges: true,
              selectedVertexIndices: selectedMeshVertexIndices,
              pinnedVertexIndices,
            }
          : undefined,
      );
    }

    // Marquee selection rectangle.
    if (tool === 'mesh' && meshMarquee) {
      const mx = Math.min(meshMarquee.sx, meshMarquee.currentSx);
      const my = Math.min(meshMarquee.sy, meshMarquee.currentSy);
      const mw = Math.abs(meshMarquee.currentSx - meshMarquee.sx);
      const mh = Math.abs(meshMarquee.currentSy - meshMarquee.sy);
      ctx.save();
      ctx.fillStyle = 'rgba(251,191,36,0.08)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(251,191,36,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.restore();
    }

    if (showBoneIndicators) {
      bones.forEach((bone) => {
        if (bone.parentId === null) return;

        const parent = bones.find((item) => item.id === bone.parentId);
        if (!parent) return;

        const isHighlighted =
          selectedBoneIds.includes(bone.id) ||
          selectedBoneIds.includes(parent.id) ||
          hoveredBoneId === bone.id ||
          hoveredBoneId === parent.id;

        drawBoneRelation(ctx, parent, bone, isHighlighted, previewWorldToScreen);
      });

      bones.forEach((bone) => {
        const skin = skins.find((s) => s.id === bone.skinId);
        const isSelected = selectedBoneIds.includes(bone.id);
        const isHovered = hoveredBoneId === bone.id;
        const hasKeyframe = mode === 'animate' && keyframes[bone.id]?.[frame] !== undefined;

        drawBone(ctx, bone, skin, isSelected, isHovered, tool, mode, hasKeyframe, previewWorldToScreen);
      });
    }

    const activeIkRootId = selectedBoneId !== null ? getIkRootForBone(selectedBoneId, bones)?.id ?? null : null;

    if (activeIkRootId !== null && ikChainRootIds.includes(activeIkRootId)) {
      const ikChain = getIkChain(activeIkRootId, bones);
      if (ikChain) {
        const handle = previewWorldToScreen(ikChain.target.x, ikChain.target.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, IK_HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
        ctx.fill();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(handle.x - 6, handle.y);
        ctx.lineTo(handle.x + 6, handle.y);
        ctx.moveTo(handle.x, handle.y - 6);
        ctx.lineTo(handle.x, handle.y + 6);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (previousMovedBones.length > 0) {
      drawSlots(ctx, resolvedSlots, resolvedAttachments, previousMovedBones, previewWorldToScreen, effectiveZoom, 0.2, handleImageLoad);
      drawSlotOutlines(ctx, slots, resolvedAttachments, previousMovedBones, previewWorldToScreen, effectiveZoom, {
        strokeStyle: 'rgba(8,145,178,0.9)',
        lineWidth: 2,
        dash: [6, 4],
      });
      previousMovedBones.forEach((bone) => {
        drawGhostBone(ctx, bone, '#0891b2', 0.4, previewWorldToScreen);
      });
    }

    if (nextMovedBones.length > 0) {
      drawSlots(ctx, resolvedSlots, resolvedAttachments, nextMovedBones, previewWorldToScreen, effectiveZoom, 0.2, handleImageLoad);
      drawSlotOutlines(ctx, slots, resolvedAttachments, nextMovedBones, previewWorldToScreen, effectiveZoom, {
        strokeStyle: 'rgba(219,39,119,0.9)',
        lineWidth: 2,
        dash: [6, 4],
      });
      nextMovedBones.forEach((bone) => {
        drawGhostBone(ctx, bone, '#db2777', 0.4, previewWorldToScreen);
      });
    }
    ctx.restore();

  }, [bones, skins, selectedBoneId, selectedBoneIds, hoveredBoneId, camX, camY, camZoom, tool, mode, keyframes, meshDeformKeyframes, attachmentOpacityKeyframes, frame, duration, setupPose, slots, attachments, showBoneIndicators, showViewport, onionSkinEnabled, attachmentDragEnabled, backgroundImage, backgroundLoaded, imageLoadTrigger, resizeTick, ikChainRootIds, activeSlot, activeBone, activeAttachment, resolvedActiveAttachment, canvasWidth, canvasHeight, effectiveZoom, previewWorldToScreen, selectedMeshVertexIndices, meshMarquee]);

  const handleDeleteKey = useEffectEvent((e: KeyboardEvent) => {
    if (tool !== 'mesh') return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (selectedMeshVertexIndices.length === 0) return;
    if (!activeAttachment || activeAttachment.type !== 'mesh' || !activeSlot) return;

    e.preventDefault();
    captureSnapshot();
    const attachmentKey = getMeshAttachmentKey({ slotId: activeSlot.id, name: activeAttachment.name });
    const animState = useAnimationStore.getState();
    const result = removeMeshVertices(
      activeAttachment,
      selectedMeshVertexIndices,
      animState.meshDeformKeyframes,
      attachmentKey,
    );
    updateAttachment(activeSlot.id, activeAttachment.name, result.attachment);
    const nextFrames = result.meshDeformKeyframes[attachmentKey];
    if (nextFrames && Object.keys(nextFrames).length > 0) {
      replaceMeshDeformKeyframesForAttachment(attachmentKey, nextFrames);
    } else {
      clearMeshDeformKeyframesForAttachment(attachmentKey);
    }
    setSelectedMeshVertexIndices([]);
  });

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning && panStart) {
      // Divide by vpScale so that the camera store's zoom-division gives
      // world-unit delta = screenDelta / effectiveZoom (= camZoom * vpScale).
      pan((sx - panStart.x) / vpScale, (sy - panStart.y) / vpScale);
      setPanStart({ x: sx, y: sy });
      return;
    }

    if (attachmentDragStart) {
      const dx = sx - attachmentDragStart.startSx;
      const dy = sy - attachmentDragStart.startSy;
      const cos = Math.cos(-attachmentDragStart.totalRotation);
      const sin = Math.sin(-attachmentDragStart.totalRotation);
      const localDx =
        ((dx * cos - dy * sin) / effectiveZoom) * attachmentDragStart.flipX;
      const localDy =
        ((dx * sin + dy * cos) / effectiveZoom) * attachmentDragStart.flipY;

      useSlotStore.getState().updateAttachment(attachmentDragStart.slotId, attachmentDragStart.attachmentName, {
        x: attachmentDragStart.initialX + localDx,
        y: attachmentDragStart.initialY + localDy,
      });
      return;
    }

    if (meshMarquee) {
      setMeshMarquee((prev) => prev ? { ...prev, currentSx: sx, currentSy: sy } : null);
      return;
    }

    if (meshDragStart && activeBone) {
      const dx = (sx - meshDragStart.startScreenX) / camZoom;
      const dy = (sy - meshDragStart.startScreenY) / camZoom;
      const selectedSet = new Set(meshDragStart.selectedIndices);
      const nextVertices = meshDragStart.initialVertices.map((vertex, index) => {
        if (!selectedSet.has(index)) return vertex;
        return { ...vertex, x: vertex.x + dx, y: vertex.y + dy };
      });
      if (mode === 'animate') {
        const attachmentKey = getMeshAttachmentKey({
          slotId: meshDragStart.slotId,
          name: meshDragStart.attachmentName,
        });
        const existingFrames = Object.keys(
          meshDeformKeyframes[attachmentKey] ?? {},
        ).map(Number);
        const currentBoneEasing = normalizeKeyframeEasing(
          keyframes[activeBone.id]?.[frame]?.easing,
        );

        if (
          frame > 0 &&
          activeAttachment?.meshVertices &&
          !existingFrames.some((keyframeFrame) => keyframeFrame < frame)
        ) {
          setMeshDeformKeyframeAtFrame(
            attachmentKey,
            0,
            activeAttachment.meshVertices.map((vertex) => ({
              x: vertex.x,
              y: vertex.y,
            })),
          );
        }

        setMeshDeformKeyframe(
          attachmentKey,
          nextVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        );
        updateMeshDeformKeyframeEasing(attachmentKey, frame, currentBoneEasing);
      } else {
        updateAttachment(meshDragStart.slotId, meshDragStart.attachmentName, {
          meshVertices: nextVertices,
        });
      }
      return;
    }

    if (ikDragStart) {
      const world = previewScreenToWorld(sx, sy);
      const solution = solveTwoBoneIk(ikDragStart.rootId, world, bones);
      if (!solution) return;

      updateBone(ikDragStart.rootId, { rotation: solution.rootRotation });
      updateBone(ikDragStart.childId, {
        rotation: solution.childRotation,
        ...(solution.childX !== undefined ? { x: solution.childX } : {}),
        ...(solution.childY !== undefined ? { y: solution.childY } : {}),
      });
      return;
    }

    if (isDragging && dragStart) {
      const world = previewScreenToWorld(sx, sy);
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
        const bs = previewWorldToScreen(anchorBone._wx, anchorBone._wy);
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
        const bs = previewWorldToScreen(anchorBone._wx, anchorBone._wy);
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

    if (tool === 'mesh' && meshAttachment && activeBone) {
      const screenVertices = getAttachmentMeshScreenVertices(meshAttachment, activeBone, previewWorldToScreen, effectiveZoom);
      const hoveredIndex = screenVertices.findIndex((point) => Math.hypot(point.x - sx, point.y - sy) <= 10);
      setHoveredMeshVertexIndex(hoveredIndex >= 0 ? hoveredIndex : null);
      setHoveredBoneId(null);
      return;
    }

    const hit = hitTestBone({ x: sx, y: sy }, bones, previewWorldToScreen);
    setHoveredBoneId(hit?.id || null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const hit = hitTestBone({ x: sx, y: sy }, bones, previewWorldToScreen);

    if (tool === 'mesh' && activeSlot && activeBone && activeAttachment) {
      if (activeAttachment.type !== 'mesh') {
        return;
      }
      const ensuredAttachment = activeAttachment;
      const displayAttachment =
        mode === 'animate'
          ? resolveAttachmentAtFrame(
              ensuredAttachment,
              frame,
              meshDeformKeyframes,
              attachmentOpacityKeyframes,
            )
          : ensuredAttachment;
      const screenVertices = getAttachmentMeshScreenVertices(
        displayAttachment,
        activeBone,
        previewWorldToScreen,
        effectiveZoom,
      );
      const targetVertexIndex = screenVertices.findIndex(
        (point) => Math.hypot(point.x - sx, point.y - sy) <= 10,
      );

      if (targetVertexIndex >= 0 && displayAttachment.meshVertices) {
        // ── Vertex click: selection + drag ────────────────────────────────
        if (activeBone.id !== selectedBoneId) selectBone(activeBone.id);

        let nextSelected: number[];
        if (e.shiftKey) {
          const alreadyIn = selectedMeshVertexIndices.includes(targetVertexIndex);
          nextSelected = alreadyIn
            ? selectedMeshVertexIndices.filter((i) => i !== targetVertexIndex)
            : [...selectedMeshVertexIndices, targetVertexIndex];
        } else {
          nextSelected = selectedMeshVertexIndices.includes(targetVertexIndex)
            ? selectedMeshVertexIndices
            : [targetVertexIndex];
        }
        setSelectedMeshVertexIndices(nextSelected);

        if (nextSelected.length === 0) return;

        if (meshDragStart === null) captureSnapshot();

        if (mode === 'animate') {
          const attachmentKey = getMeshAttachmentKey({
            slotId: activeSlot.id,
            name: ensuredAttachment.name,
          });
          const existingFrames = Object.keys(
            meshDeformKeyframes[attachmentKey] ?? {},
          ).map(Number);
          const currentBoneEasing = normalizeKeyframeEasing(
            keyframes[activeBone.id]?.[frame]?.easing,
          );

          if (
            frame > 0 &&
            ensuredAttachment.meshVertices &&
            !existingFrames.some((keyframeFrame) => keyframeFrame < frame)
          ) {
            setMeshDeformKeyframeAtFrame(
              attachmentKey,
              0,
              ensuredAttachment.meshVertices.map((vertex) => ({
                x: vertex.x,
                y: vertex.y,
              })),
            );
            updateMeshDeformKeyframeEasing(attachmentKey, 0, currentBoneEasing);
          }

          setMeshDeformKeyframeAtFrame(
            attachmentKey,
            frame,
            displayAttachment.meshVertices.map((vertex) => ({
              x: vertex.x,
              y: vertex.y,
            })),
          );
          updateMeshDeformKeyframeEasing(attachmentKey, frame, currentBoneEasing);
          insertKeyframe(activeBone.id, {
            x: activeBone.x,
            y: activeBone.y,
            rotation: activeBone.rotation,
            scaleX: activeBone.scaleX,
            scaleY: activeBone.scaleY,
          });
        }

        setMeshDragStart({
          slotId: activeSlot.id,
          attachmentName: ensuredAttachment.name,
          selectedIndices: nextSelected,
          startScreenX: sx,
          startScreenY: sy,
          initialVertices: displayAttachment.meshVertices.map((vertex) => ({ ...vertex })),
        });
        return;
      }

      // ── Alt+click: insert vertex by splitting the containing triangle ──
      if (e.altKey && displayAttachment.meshVertices) {
        const attachmentKey = getMeshAttachmentKey({
          slotId: activeSlot.id,
          name: ensuredAttachment.name,
        });
        captureSnapshot();
        const animState = useAnimationStore.getState();
        const result = insertMeshVertex(
          ensuredAttachment,
          sx,
          sy,
          screenVertices,
          animState.meshDeformKeyframes,
          attachmentKey,
        );
        if (result) {
          updateAttachment(activeSlot.id, ensuredAttachment.name, result.attachment);
          const nextFrames = result.meshDeformKeyframes[attachmentKey];
          if (nextFrames && Object.keys(nextFrames).length > 0) {
            replaceMeshDeformKeyframesForAttachment(attachmentKey, nextFrames);
          }
          setSelectedMeshVertexIndices([result.attachment.meshVertices!.length - 1]);
        }
        return;
      }

      // ── Empty click: start marquee selection ──────────────────────────
      setMeshMarquee({ sx, sy, currentSx: sx, currentSy: sy, additive: e.shiftKey });
      return;
    }

    if (e.button === 2) {
      if (mode !== 'setup' && selectedBoneId !== null && hit && hit.id !== selectedBoneId) {
        alert('Parent relationships can only be changed in Setup mode.');
        return;
      }

      if (mode === 'setup' && selectedBoneId !== null && hit && hit.id !== selectedBoneId) {
        const selectedBone = bones.find((bone) => bone.id === selectedBoneId);
        const nextParentId =
          selectedBone?.parentId === hit.id ? null : hit.id;
        const didReparent = setBoneParent(selectedBoneId, nextParentId);
        if (didReparent) return;
      }

      setIsPanning(true);
      setPanStart({ x: sx, y: sy });
      return;
    }

    const world = previewScreenToWorld(sx, sy);

    const activeIkRootId = selectedBoneId !== null ? getIkRootForBone(selectedBoneId, bones)?.id ?? null : null;

    if (activeIkRootId !== null && ikChainRootIds.includes(activeIkRootId)) {
      const ikChain = getIkChain(activeIkRootId, bones);
      if (ikChain) {
        const ikHandle = previewWorldToScreen(ikChain.target.x, ikChain.target.y);
        if (Math.hypot(sx - ikHandle.x, sy - ikHandle.y) <= IK_HANDLE_RADIUS + 2) {
          captureSnapshot();
          setIkDragStart({ rootId: ikChain.root.id, childId: ikChain.child.id });
          return;
        }

        const ikTargetBoneId = ikChain.end?.id ?? ikChain.child.id;
        const canDragIkTarget = tool === 'move' || tool === 'pose';
        if (
          canDragIkTarget &&
          hit?.id === ikTargetBoneId &&
          selectedBoneId === ikTargetBoneId
        ) {
          captureSnapshot();
          setIkDragStart({ rootId: ikChain.root.id, childId: ikChain.child.id });
          return;
        }
      }
    }

    if (attachmentDragEnabled && selectedBoneId !== null) {
      computeAllWorldTransforms(bones);
      const activeSlot =
        (selectedSlotId !== null
        ? resolvedSlots.find(
              (slot) =>
                slot.id === selectedSlotId &&
                slot.boneId === selectedBoneId &&
                slot.attachmentName,
            ) ?? null
          : null) ??
        resolvedSlots.find((slot) => slot.boneId === selectedBoneId && slot.attachmentName) ??
        null;
      const selectedBone = bones.find((bone) => bone.id === selectedBoneId);
      const activeAttachment = activeSlot
        ? attachments.find((attachment) => attachment.slotId === activeSlot.id && attachment.name === activeSlot.attachmentName)
        : null;

      if (
        activeSlot &&
        selectedBone &&
        activeAttachment &&
        hitTestAttachment(sx, sy, activeAttachment, selectedBone, previewWorldToScreen, effectiveZoom)
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
          flipX: selectedBone.scaleX * activeAttachment.scaleX < 0 ? -1 : 1,
          flipY: selectedBone.scaleY * activeAttachment.scaleY < 0 ? -1 : 1,
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
      const hasSelection = selectedBoneId !== null || selectedBoneIds.length > 0;
      if (!hasSelection) {
        setIsPanning(true);
        setPanStart({ x: sx, y: sy });
        return;
      }

      selectBone(null);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setPanStart(null);

    // Finalise marquee: collect vertices inside the drawn rectangle.
    if (meshMarquee && meshAttachment && activeBone) {
      const minX = Math.min(meshMarquee.sx, meshMarquee.currentSx);
      const maxX = Math.max(meshMarquee.sx, meshMarquee.currentSx);
      const minY = Math.min(meshMarquee.sy, meshMarquee.currentSy);
      const maxY = Math.max(meshMarquee.sy, meshMarquee.currentSy);
      const hasDrag = maxX - minX > 4 || maxY - minY > 4;
      if (hasDrag) {
        const screenVertices = getAttachmentMeshScreenVertices(
          meshAttachment,
          activeBone,
          previewWorldToScreen,
          effectiveZoom,
        );
        const inRect = screenVertices
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
          .map(({ i }) => i);
        const nextSelected = meshMarquee.additive
          ? Array.from(new Set([...selectedMeshVertexIndices, ...inRect]))
          : inRect;
        setSelectedMeshVertexIndices(nextSelected);
      } else if (!meshMarquee.additive) {
        // Plain click on empty space clears selection.
        setSelectedMeshVertexIndices([]);
      }
      setMeshMarquee(null);
    }

    if (ikDragStart && mode === 'animate') {
      const affectedBoneIds = [ikDragStart.rootId, ikDragStart.childId];
      affectedBoneIds.forEach((boneId) => {
        const bone = bones.find((item) => item.id === boneId);
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

    if (isDragging && mode === 'animate') {
      getAnimatedKeyframeBoneIds().forEach((boneId) => {
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
    setMeshDragStart(null);
    setMeshMarquee(null);
    setIkDragStart(null);
    setIsDragging(false);
    setDragStart(null);
    setHoveredMeshVertexIndex(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'mesh' || !activeSlot || !activeBone || !activeAttachment) return;
    if (activeAttachment.type !== 'mesh') return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const displayAttachment =
      mode === 'animate'
        ? resolveAttachmentAtFrame(activeAttachment, frame, meshDeformKeyframes, attachmentOpacityKeyframes)
        : activeAttachment;

    const screenVertices = getAttachmentMeshScreenVertices(
      displayAttachment,
      activeBone,
      previewWorldToScreen,
      effectiveZoom,
    );

    // Don't insert if double-click landed on an existing vertex.
    const onVertex = screenVertices.some((p) => Math.hypot(p.x - sx, p.y - sy) <= 10);
    if (onVertex) return;

    const attachmentKey = getMeshAttachmentKey({ slotId: activeSlot.id, name: activeAttachment.name });
    captureSnapshot();
    const animState = useAnimationStore.getState();
    const result = insertMeshVertex(
      activeAttachment,
      sx,
      sy,
      screenVertices,
      animState.meshDeformKeyframes,
      attachmentKey,
    );
    if (result) {
      updateAttachment(activeSlot.id, activeAttachment.name, result.attachment);
      const nextFrames = result.meshDeformKeyframes[attachmentKey];
      if (nextFrames && Object.keys(nextFrames).length > 0) {
        replaceMeshDeformKeyframesForAttachment(attachmentKey, nextFrames);
      }
      setSelectedMeshVertexIndices([result.attachment.meshVertices!.length - 1]);
    }
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
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className="absolute top-0 left-0 cursor-crosshair"
        style={{ cursor: tool === 'mesh' && hoveredMeshVertexIndex !== null ? 'grab' : undefined }}
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

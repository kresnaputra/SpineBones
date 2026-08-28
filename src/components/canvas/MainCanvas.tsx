import { useRef, useEffect, useMemo, useState, useEffectEvent } from 'react';
import type { AttachmentOpacityKeyframes, Bone, MeshDeformKeyframes } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useCameraStore } from '../../stores/cameraStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useDeformerStore } from '../../stores/deformerStore';
import { useSlotStore } from '../../stores/slotStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { computeDrawSequence } from '../../engine/drawOrder';
import { orbitPlaneConditioning } from '../../engine/mat4';
import { drawGrid, drawOriginCross, drawBone, drawBoneRelation, drawGhostBone } from '../../engine/renderer';
import { drawAttachmentOutline, drawSlotOutlines, hitTestAttachment } from '../../engine/imageRenderer';
import { createMeshRenderer, type MeshRenderer } from '../../engine/webgl/meshRenderer';
import { getMeshVertexScreenPositions, resolveDeformerAtFrame, applyWarpToAttachment } from '../../engine/meshSkinning';
import { paintWeightBrush, weightToColor } from '../../utils/weightUtils';
import { usePhysics } from '../../hooks/usePhysics';
import { usePhysicsStore } from '../../stores/physicsStore';
import {
  getAttachmentKey,
  resolveAttachmentAtFrame,
} from '../../utils/attachmentUtils';
import {
  insertMeshVertex,
  removeMeshVertices,
  ensureMeshAttachmentAsync,
} from '../../utils/meshAttachment';
import { normalizeKeyframeEasing } from '../../utils/easing';
import {
  getViewportRect,
  getViewportScale,
  getViewportEffectiveZoom,
  createOrbitWorldToScreen,
  createOrbitScreenToWorld,
  MIN_PLANE_CONDITIONING,
} from '../../engine/viewport';
import { hitTestBone } from '../../engine/hitTest';
import { getIkChain, getIkRootForBone, solveTwoBoneIk } from '../../utils/ik';
import { getAdjacentKeyframes, sampleBonesAtFrame } from '../../utils/animationPose';
import { resolveSlotsAtFrame } from '../../utils/slotAnimation';

/** Stable empty records so setup-mode resolution keeps a constant identity. */
const EMPTY_MESH_DEFORM_KEYFRAMES: MeshDeformKeyframes = {};
const EMPTY_ATTACHMENT_OPACITY_KEYFRAMES: AttachmentOpacityKeyframes = {};

export const MainCanvas = () => {
  const IK_HANDLE_RADIUS = 10;
  const GHOST_MOVEMENT_EPSILON = 0.01;
  const canvasRef = useRef<HTMLCanvasElement>(null); // top overlay (bones/handles, receives input)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null); // bottom: grid/background
  const glCanvasRef = useRef<HTMLCanvasElement>(null); // middle: WebGL sprites/meshes
  const rendererRef = useRef<MeshRenderer | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragPos = useRef<{ sx: number; sy: number } | null>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<number | null>(null);
  const [hoveredMeshVertexIndex, setHoveredMeshVertexIndex] = useState<number | null>(null);
  const [meshDragStart, setMeshDragStart] = useState<{
    slotId: number;
    attachmentName: string;
    selectedIndices: number[];
    startScreenX: number;
    startScreenY: number;
    totalRotation: number;
    totalScaleX: number;
    totalScaleY: number;
    initialVertices: Array<{ x: number; y: number }>;
  } | null>(null);
  const [meshMarquee, setMeshMarquee] = useState<{
    sx: number; sy: number; currentSx: number; currentSy: number;
  } | null>(null);
  const [selectedDeformerCPs, setSelectedDeformerCPs] = useState<number[]>([]);
  const [hoveredDeformerCPIndex, setHoveredDeformerCPIndex] = useState<number | null>(null);
  const [deformerDragState, setDeformerDragState] = useState<{
    deformerId: number;
    selectedCPIndices: number[];
    startScreenX: number;
    startScreenY: number;
    totalRotation: number;
    totalScaleX: number;
    totalScaleY: number;
    initialPoints: { x: number; y: number }[];
  } | null>(null);
  const [deformerMarquee, setDeformerMarquee] = useState<{
    sx: number; sy: number; currentSx: number; currentSy: number;
  } | null>(null);
  const [weightBrushPos, setWeightBrushPos] = useState<{ x: number; y: number } | null>(null);
  const isWeightPaintingRef = useRef(false);
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
    weightBrushBoneId,
    weightBrushRadius,
    weightBrushStrength,
  } = useEditorStore();
  const { bones, skins, activeSkinId, addBone, updateBone, ikChainRootIds, setupPose, updateSetupPoseBone } = useSkeletonStore();
  const {
    keyframes,
    slotAttachmentKeyframes,
    attachmentOpacityKeyframes,
    meshDeformKeyframes,
    frame,
    duration,
    insertKeyframe,
    remapBoneKeyframesForParentChange,
    setMeshDeformKeyframe,
    setMeshDeformKeyframeAtFrame,
    updateMeshDeformKeyframeEasing,
    replaceMeshDeformKeyframesForAttachment,
    clearMeshDeformKeyframesForAttachment,
  } = useAnimationStore();
  const { x: camX, y: camY, zoom: camZoom, yaw, pitch, canvasWidth, canvasHeight, setCanvasSize, pan, zoomBy, orbit } = useCameraStore();
  const { slots, attachments } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();
  const {
    deformers,
    deformerKeyframes,
    setDeformerKeyframe: setDeformerKF,
    updateDeformerKeyframeEasing,
  } = useDeformerStore();
  const physicsOffsets = usePhysicsStore((s) => s.offsets);
  usePhysics();

  // Derive the shared viewport transform helpers for the current frame.
  // These are recomputed from camX/camY/camZoom/canvasSize on every render,
  // ensuring the editor preview and the video export use the same math.
  const viewportRect = getViewportRect(canvasWidth, canvasHeight);
  const vpScale = getViewportScale(viewportRect);
  const effectiveZoom = getViewportEffectiveZoom(viewportRect, camZoom);
  const previewWorldToScreen = createOrbitWorldToScreen(viewportRect, camX, camY, camZoom, yaw, pitch);
  // Bones have no depth of their own yet, so every drag resolves against the
  // z = 0 plane. Returns null only when that plane is edge-on to the camera.
  /**
   * The three rotation rings, in world space around a bone.
   *
   * Each is a circle in one of the coordinate planes, so projecting them through
   * `previewWorldToScreen` — which takes a Z — makes them tilt correctly under
   * camera orbit and under the bone's own out-of-plane rotation. That is what
   * makes the gizmo readable: the ring you grab is the one facing you.
   */
  const GIZMO_RADIUS_PX = 58;
  const GIZMO_SEGMENTS = 48;

  const gizmoRing = (
    bone: Bone,
    axis: 'x' | 'y' | 'z',
    toScreen: (wx: number, wy: number, wz?: number) => { x: number; y: number },
    radiusWorld: number,
  ): Array<{ x: number; y: number }> => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= GIZMO_SEGMENTS; i += 1) {
      const t = (i / GIZMO_SEGMENTS) * Math.PI * 2;
      const c = Math.cos(t) * radiusWorld;
      const s2 = Math.sin(t) * radiusWorld;
      const [dx, dy, dz] =
        axis === 'z' ? [c, s2, 0] : axis === 'y' ? [c, 0, s2] : [0, c, s2];
      pts.push(toScreen(bone._wx + dx, bone._wy + dy, dz));
    }
    return pts;
  };

  /** Which ring, if any, the cursor is over. Nearest wins when rings overlap. */
  const gizmoAxisAt = (
    sx: number,
    sy: number,
    bone: Bone,
    toScreen: (wx: number, wy: number, wz?: number) => { x: number; y: number },
    radiusWorld: number,
  ): 'x' | 'y' | 'z' | null => {
    let best: 'x' | 'y' | 'z' | null = null;
    let bestDist = 9;
    for (const axis of ['z', 'y', 'x'] as const) {
      for (const pt of gizmoRing(bone, axis, toScreen, radiusWorld)) {
        const d = Math.hypot(pt.x - sx, pt.y - sy);
        if (d < bestDist) {
          bestDist = d;
          best = axis;
        }
      }
    }
    return best;
  };

  const previewScreenToWorld = createOrbitScreenToWorld(viewportRect, camX, camY, camZoom, yaw, pitch);
  const canEdit = orbitPlaneConditioning(yaw, pitch) >= MIN_PLANE_CONDITIONING;

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

  const [orbitStart, setOrbitStart] = useState<{ x: number; y: number } | null>(null);
  /**
   * While the camera is turned, the 2D overlay and every hit-test are wrong:
   * they project through `previewWorldToScreen`, which knows nothing about the
   * orbit. Rather than let handles sit in the wrong place and invite edits that
   * land somewhere else, the canvas goes view-only. Lifting this is B6's job.
   */
  const isOrbited = yaw !== 0 || pitch !== 0;

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
      rotationX: number;
      rotationY: number;
      scaleX: number;
      scaleY: number;
      wx: number;
      wy: number;
      parentId: number | null;
    }>;
  } | null>(null);
  /** Which gizmo ring the rotate drag grabbed. 'z' is the original 2D behaviour. */
  const [rotateAxis, setRotateAxis] = useState<'x' | 'y' | 'z'>('z');
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

  // Setup mode shows the rest rig: the timeline only calls applyKeyframes() in
  // animate mode, so bones stay put there and nothing else may animate either.
  // Blanking the keyframe records makes every resolver fall back to rest values.
  const isAnimating = mode === 'animate';
  const activeOpacityKeyframes = isAnimating
    ? attachmentOpacityKeyframes
    : EMPTY_ATTACHMENT_OPACITY_KEYFRAMES;
  const activeMeshDeformKeyframes = isAnimating
    ? meshDeformKeyframes
    : EMPTY_MESH_DEFORM_KEYFRAMES;

  const resolvedAttachments = useMemo(
    () => attachments.map((attachment) =>
      resolveAttachmentAtFrame(
        attachment,
        frame,
        activeOpacityKeyframes,
        activeMeshDeformKeyframes,
      )
    ),
    [attachments, frame, activeOpacityKeyframes, activeMeshDeformKeyframes],
  );

  // Warp-deformed attachments fed to the GL renderer (mesh tool overlay uses un-warped).
  // In setup mode the cage sits at its rest points — dragging it there edits the rest
  // shape, so the warp is still applied, just never sampled from keyframes.
  const warpedResolvedAttachments = useMemo(
    () => resolvedAttachments.map((att) => {
      if (att.deformerId == null) return att;
      const def = deformers.find((d) => d.id === att.deformerId);
      if (!def) return att;
      const pts = isAnimating ? resolveDeformerAtFrame(def, frame, deformerKeyframes) : def.rest;
      return applyWarpToAttachment(att, def, pts);
    }),
    [resolvedAttachments, deformers, deformerKeyframes, frame, isAnimating],
  );

  const resolvedSlots = useMemo(
    () => resolveSlotsAtFrame(slots, frame, slotAttachmentKeyframes),
    [slots, frame, slotAttachmentKeyframes],
  );
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
  // Gated on mode like `resolvedAttachments`, so the mesh overlay's vertex handles
  // stay pinned to the rest geometry the sprite is drawn at in setup mode.
  const resolvedActiveAttachment =
    activeAttachment
      ? resolveAttachmentAtFrame(
          activeAttachment,
          frame,
          activeOpacityKeyframes,
          activeMeshDeformKeyframes,
        )
      : activeAttachment;

  const meshAttachment = resolvedActiveAttachment?.type === 'mesh' ? resolvedActiveAttachment : null;

  /**
   * The layer depth the renderer draws the active attachment at.
   *
   * Mesh and warp handles have to be projected at that same depth: at rest it
   * makes no difference, but once the camera turns, projecting them at z = 0
   * would slide them off the geometry they belong to.
   */
  const activeAttachmentDepth = useMemo(() => {
    if (!activeAttachment) return 0;
    const item = computeDrawSequence(bones, resolvedSlots, warpedResolvedAttachments).find(
      (i) => i.attachment.slotId === activeAttachment.slotId && i.attachment.name === activeAttachment.name,
    );
    return item?.depth ?? 0;
  }, [bones, resolvedSlots, warpedResolvedAttachments, activeAttachment]);

  const activeWorldToScreen = (wx: number, wy: number) =>
    previewWorldToScreen(wx, wy, activeAttachmentDepth);

  const activeDeformer =
    activeAttachment?.deformerId != null
      ? deformers.find((d) => d.id === activeAttachment.deformerId) ?? null
      : null;

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

  // Auto-convert image attachment to mesh when mesh tool is active.
  const { updateAttachment } = useSlotStore();
  useEffect(() => {
    if (tool !== 'mesh' || !activeSlot || !activeAttachment || activeAttachment.type === 'mesh') return;
    const convert = async () => {
      captureSnapshot();
      const next = await ensureMeshAttachmentAsync(activeAttachment);
      clearMeshDeformKeyframesForAttachment(getAttachmentKey(activeAttachment));
      updateAttachment(activeSlot.id, activeAttachment.name, next);
    };
    void convert();
  }, [tool, activeSlot, activeAttachment]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear vertex selection when leaving mesh tool or switching active attachment.
  useEffect(() => {
    setSelectedMeshVertexIndices([]);
  }, [tool, activeSlot?.id, activeAttachment?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Delete key for mesh vertices (dispatched by useKeyboardShortcuts).
  const handleMeshDeleteVertices = useEffectEvent(() => {
    if (tool !== 'mesh') return;
    if (selectedMeshVertexIndices.length === 0) return;
    if (!activeAttachment || activeAttachment.type !== 'mesh' || !activeSlot) return;
    const attachmentKey = getAttachmentKey(activeAttachment);
    captureSnapshot();
    const animState = useAnimationStore.getState();
    const result = removeMeshVertices(activeAttachment, selectedMeshVertexIndices, animState.meshDeformKeyframes, attachmentKey);
    const { updateAttachment: ua } = useSlotStore.getState();
    ua(activeSlot.id, activeAttachment.name, result.attachment);
    const nextFrames = result.meshDeformKeyframes[attachmentKey];
    if (nextFrames && Object.keys(nextFrames).length > 0) {
      replaceMeshDeformKeyframesForAttachment(attachmentKey, nextFrames);
    } else {
      clearMeshDeformKeyframesForAttachment(attachmentKey);
    }
    setSelectedMeshVertexIndices([]);
  });

  useEffect(() => {
    window.addEventListener('spine:mesh-delete-vertices', handleMeshDeleteVertices);
    return () => window.removeEventListener('spine:mesh-delete-vertices', handleMeshDeleteVertices);
  }, []);

  // Create the WebGL renderer once; recreate it on context loss.
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    const init = () => {
      const gl = glCanvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      });
      if (!gl) {
        console.error('WebGL not available; mesh rendering disabled');
        return;
      }
      rendererRef.current = createMeshRenderer(gl);
      setImageLoadTrigger((t) => t + 1); // force a redraw once the renderer exists
    };

    const handleLost = (e: Event) => {
      e.preventDefault();
      rendererRef.current = null;
    };
    const handleRestored = () => init();

    glCanvas.addEventListener('webglcontextlost', handleLost);
    glCanvas.addEventListener('webglcontextrestored', handleRestored);
    init();

    return () => {
      glCanvas.removeEventListener('webglcontextlost', handleLost);
      glCanvas.removeEventListener('webglcontextrestored', handleRestored);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !wrapRef.current) return;
      const { clientWidth, clientHeight } = wrapRef.current;
      for (const c of [canvasRef.current, bgCanvasRef.current, glCanvasRef.current]) {
        if (c) {
          c.width = clientWidth;
          c.height = clientHeight;
        }
      }
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
    // `canvas`/`ctx` = bottom layer (grid + background); `ov` = top overlay
    // (bones, handles, outlines). Sprites/meshes render on the WebGL layer between.
    const canvas = bgCanvasRef.current;
    const overlayCanvas = canvasRef.current;
    if (!canvas || !overlayCanvas) return;
    const ctx = canvas.getContext('2d');
    const ov = overlayCanvas.getContext('2d');
    if (!ctx || !ov) return;

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

    // Apply physics offsets only when not using a tool that needs stable bone
    // positions. Restored from a4e94df, which added this guard to stop bones
    // drifting under the cursor while editing; 79ec81f dropped it by accident.
    if (tool !== 'mesh' && tool !== 'warp' && tool !== 'weights') {
      for (const bone of bones) {
        const offset = physicsOffsets[bone.id];
        if (offset) {
          bone._wx += offset.dx;
          bone._wy += offset.dy;
        }
      }
    }

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

    // ── WebGL sprite/mesh layer (between the bg and overlay) ────────────────
    const renderer = rendererRef.current;
    if (renderer) {
      const passes: { bones: typeof bones; alpha: number }[] = [{ bones, alpha: 1 }];
      if (previousMovedBones.length > 0) passes.push({ bones: previousMovedBones, alpha: 0.2 });
      if (nextMovedBones.length > 0) passes.push({ bones: nextMovedBones, alpha: 0.2 });
      renderer.render({
        slots: resolvedSlots,
        attachments: warpedResolvedAttachments,
        passes,
        camX,
        camY,
        camZoom,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        viewportRect,
        yaw,
        pitch,
        clip: showViewport ? viewportRect : undefined,
        onTextureReady: handleImageLoad,
      });
    }

    // ── Overlay layer: bones, handles, outlines (vector — never seams) ──────
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    ov.save();
    if (showViewport) {
      ov.beginPath();
      ov.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
      ov.clip();
    }

    if (activeSlot && activeBone && activeAttachment && attachmentDragEnabled) {
      const outlineAttachment = resolvedActiveAttachment ?? activeAttachment;
      drawAttachmentOutline(ov, outlineAttachment, activeBone, previewWorldToScreen, effectiveZoom);
    }

    // Mesh wireframe + vertex handles (overlay canvas, never affects GL texture)
    if (tool === 'mesh' && meshAttachment?.mesh && activeBone) {
      const screenVerts = getMeshVertexScreenPositions(
        meshAttachment, activeBone, bones, activeWorldToScreen,
        meshAttachment.mesh.vertices,
      );
      const edges = meshAttachment.mesh.edges;
      // Draw edges
      ov.save();
      ov.strokeStyle = 'rgba(124,58,237,0.55)';
      ov.lineWidth = 1;
      ov.setLineDash([]);
      for (const [a, b] of edges) {
        const pa = screenVerts[a]; const pb = screenVerts[b];
        if (!pa || !pb) continue;
        ov.beginPath();
        ov.moveTo(pa.x, pa.y);
        ov.lineTo(pb.x, pb.y);
        ov.stroke();
      }
      // Draw vertex circles
      for (let i = 0; i < screenVerts.length; i += 1) {
        const sp = screenVerts[i];
        if (!sp) continue;
        const isSelected = selectedMeshVertexIndices.includes(i);
        const isHovered = hoveredMeshVertexIndex === i;
        const isPinned = meshAttachment.pinned?.[i];
        ov.beginPath();
        ov.arc(sp.x, sp.y, isSelected || isHovered ? 6 : 4, 0, Math.PI * 2);
        ov.fillStyle = isPinned ? 'rgba(245,158,11,0.9)' : isSelected ? 'rgba(124,58,237,1)' : 'rgba(255,255,255,0.9)';
        ov.fill();
        ov.strokeStyle = isSelected ? '#fff' : 'rgba(124,58,237,0.8)';
        ov.lineWidth = 1.5;
        ov.stroke();
      }
      // Marquee selection rectangle
      if (meshMarquee) {
        const mx = Math.min(meshMarquee.sx, meshMarquee.currentSx);
        const my = Math.min(meshMarquee.sy, meshMarquee.currentSy);
        const mw = Math.abs(meshMarquee.currentSx - meshMarquee.sx);
        const mh = Math.abs(meshMarquee.currentSy - meshMarquee.sy);
        ov.fillStyle = 'rgba(124,58,237,0.08)';
        ov.fillRect(mx, my, mw, mh);
        ov.strokeStyle = 'rgba(124,58,237,0.7)';
        ov.lineWidth = 1;
        ov.setLineDash([4, 3]);
        ov.strokeRect(mx, my, mw, mh);
      }
      ov.restore();
    }

    // Warp deformer control-point overlay
    if (tool === 'warp' && activeDeformer && activeBone && activeAttachment) {
      const currentPts = resolveDeformerAtFrame(activeDeformer, frame, deformerKeyframes);
      const screenPts = getMeshVertexScreenPositions(
        activeAttachment, activeBone, bones, activeWorldToScreen, currentPts,
      );
      const { cols, rows } = activeDeformer.grid;
      const idx = (col: number, row: number) => row * (cols + 1) + col;
      ov.save();
      ov.strokeStyle = 'rgba(6,182,212,0.7)';
      ov.lineWidth = 1;
      ov.setLineDash([]);
      // horizontal lines
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col < cols; col++) {
          const pa = screenPts[idx(col, row)];
          const pb = screenPts[idx(col + 1, row)];
          if (!pa || !pb) continue;
          ov.beginPath();
          ov.moveTo(pa.x, pa.y);
          ov.lineTo(pb.x, pb.y);
          ov.stroke();
        }
      }
      // vertical lines
      for (let col = 0; col <= cols; col++) {
        for (let row = 0; row < rows; row++) {
          const pa = screenPts[idx(col, row)];
          const pb = screenPts[idx(col, row + 1)];
          if (!pa || !pb) continue;
          ov.beginPath();
          ov.moveTo(pa.x, pa.y);
          ov.lineTo(pb.x, pb.y);
          ov.stroke();
        }
      }
      // control point handles
      for (let i = 0; i < screenPts.length; i++) {
        const sp = screenPts[i];
        if (!sp) continue;
        const isSelected = selectedDeformerCPs.includes(i);
        const isHovered = hoveredDeformerCPIndex === i;
        const size = isSelected || isHovered ? 6 : 4;
        ov.fillStyle = isSelected ? 'rgba(6,182,212,1)' : 'rgba(6,182,212,0.7)';
        ov.strokeStyle = '#fff';
        ov.lineWidth = 1;
        ov.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);
        ov.strokeRect(sp.x - size / 2, sp.y - size / 2, size, size);
      }
      // marquee
      if (deformerMarquee) {
        const mx = Math.min(deformerMarquee.sx, deformerMarquee.currentSx);
        const my = Math.min(deformerMarquee.sy, deformerMarquee.currentSy);
        const mw = Math.abs(deformerMarquee.currentSx - deformerMarquee.sx);
        const mh = Math.abs(deformerMarquee.currentSy - deformerMarquee.sy);
        ov.fillStyle = 'rgba(6,182,212,0.08)';
        ov.fillRect(mx, my, mw, mh);
        ov.strokeStyle = 'rgba(6,182,212,0.7)';
        ov.lineWidth = 1;
        ov.setLineDash([4, 3]);
        ov.strokeRect(mx, my, mw, mh);
      }
      ov.restore();
    }

    // Weight paint heatmap + brush circle overlay
    if (tool === 'weights' && activeAttachment?.type === 'mesh' && activeAttachment.mesh && activeBone) {
      const verts = activeAttachment.mesh.vertices;
      const screenVerts = getMeshVertexScreenPositions(
        activeAttachment, activeBone, bones, activeWorldToScreen, verts,
      );
      ov.save();
      // Draw per-vertex heatmap circles
      for (let i = 0; i < screenVerts.length; i++) {
        const sp = screenVerts[i];
        if (!sp) continue;
        let w = 0;
        if (weightBrushBoneId !== null) {
          const entry = activeAttachment.vertexWeights?.[i]?.find((e) => e.boneId === weightBrushBoneId);
          w = entry?.weight ?? 0;
        }
        ov.beginPath();
        ov.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
        ov.fillStyle = weightToColor(w);
        ov.fill();
        ov.strokeStyle = 'rgba(255,255,255,0.3)';
        ov.lineWidth = 0.5;
        ov.stroke();
      }
      // Draw brush circle at mouse position
      if (weightBrushPos && weightBrushBoneId !== null) {
        ov.beginPath();
        ov.arc(weightBrushPos.x, weightBrushPos.y, weightBrushRadius, 0, Math.PI * 2);
        ov.strokeStyle = 'rgba(255,255,255,0.6)';
        ov.lineWidth = 1;
        ov.setLineDash([4, 3]);
        ov.stroke();
      }
      ov.restore();
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

        drawBoneRelation(ov, parent, bone, isHighlighted, previewWorldToScreen);
      });

      bones.forEach((bone) => {
        const skin = skins.find((s) => s.id === bone.skinId);
        const isSelected = selectedBoneIds.includes(bone.id);
        const isHovered = hoveredBoneId === bone.id;
        const hasKeyframe = mode === 'animate' && keyframes[bone.id]?.[frame] !== undefined;

        drawBone(ov, bone, skin, isSelected, isHovered, tool, mode, hasKeyframe, previewWorldToScreen);
      });
    }

    const activeIkRootId = selectedBoneId !== null ? getIkRootForBone(selectedBoneId, bones)?.id ?? null : null;

    if (activeIkRootId !== null && ikChainRootIds.includes(activeIkRootId)) {
      const ikChain = getIkChain(activeIkRootId, bones);
      if (ikChain) {
        const handle = previewWorldToScreen(ikChain.target.x, ikChain.target.y);
        ov.save();
        ov.beginPath();
        ov.arc(handle.x, handle.y, IK_HANDLE_RADIUS, 0, Math.PI * 2);
        ov.fillStyle = 'rgba(6, 182, 212, 0.18)';
        ov.fill();
        ov.strokeStyle = '#06b6d4';
        ov.lineWidth = 2;
        ov.stroke();
        ov.beginPath();
        ov.moveTo(handle.x - 6, handle.y);
        ov.lineTo(handle.x + 6, handle.y);
        ov.moveTo(handle.x, handle.y - 6);
        ov.lineTo(handle.x, handle.y + 6);
        ov.stroke();
        ov.restore();
      }
    }

    if (previousMovedBones.length > 0) {
      drawSlotOutlines(ov, slots, resolvedAttachments, previousMovedBones, previewWorldToScreen, effectiveZoom, {
        strokeStyle: 'rgba(8,145,178,0.9)',
        lineWidth: 2,
        dash: [6, 4],
      });
      previousMovedBones.forEach((bone) => {
        drawGhostBone(ov, bone, '#0891b2', 0.4, previewWorldToScreen);
      });
    }

    if (nextMovedBones.length > 0) {
      drawSlotOutlines(ov, slots, resolvedAttachments, nextMovedBones, previewWorldToScreen, effectiveZoom, {
        strokeStyle: 'rgba(219,39,119,0.9)',
        lineWidth: 2,
        dash: [6, 4],
      });
      nextMovedBones.forEach((bone) => {
        drawGhostBone(ov, bone, '#db2777', 0.4, previewWorldToScreen);
      });
    }
    if (tool === 'rotate' && activeBone) {
      const radiusWorld = GIZMO_RADIUS_PX / effectiveZoom;
      const rings = [
        { axis: 'z' as const, colour: '#3b82f6' },
        { axis: 'y' as const, colour: '#22c55e' },
        { axis: 'x' as const, colour: '#ef4444' },
      ];
      for (const { axis, colour } of rings) {
        const pts = gizmoRing(activeBone, axis, previewWorldToScreen, radiusWorld);
        ov.beginPath();
        pts.forEach((pt, i) => (i === 0 ? ov.moveTo(pt.x, pt.y) : ov.lineTo(pt.x, pt.y)));
        ov.strokeStyle = colour;
        ov.lineWidth = isDragging && rotateAxis === axis ? 3 : 1.5;
        ov.globalAlpha = isDragging && rotateAxis !== axis ? 0.25 : 0.9;
        ov.stroke();
      }
      ov.globalAlpha = 1;
    }

    if (isOrbited) {
      ov.fillStyle = 'rgba(0,0,0,0.55)';
      ov.fillRect(viewportRect.x + 10, viewportRect.y + 10, canEdit ? 250 : 300, 34);
      ov.fillStyle = '#fbbf24';
      ov.font = '11px system-ui, sans-serif';
      ov.fillText(`ORBIT  yaw ${yaw.toFixed(0)}°  pitch ${pitch.toFixed(0)}°`, viewportRect.x + 18, viewportRect.y + 27);
      ov.fillStyle = canEdit ? 'rgba(255,255,255,0.65)' : '#f87171';
      ov.fillText(
        canEdit ? 'press 0 to reset' : 'edge-on — editing unavailable, press 0 to reset',
        viewportRect.x + 18,
        viewportRect.y + 39,
      );
    }

    ov.restore();

  }, [bones, skins, selectedBoneId, selectedBoneIds, hoveredBoneId, camX, camY, camZoom, tool, mode, keyframes, frame, duration, setupPose, slots, resolvedAttachments, warpedResolvedAttachments, showBoneIndicators, showViewport, onionSkinEnabled, attachmentDragEnabled, backgroundImage, backgroundLoaded, imageLoadTrigger, resizeTick, ikChainRootIds, activeSlot, activeBone, activeAttachment, resolvedActiveAttachment, canvasWidth, canvasHeight, effectiveZoom, previewWorldToScreen, meshAttachment, selectedMeshVertexIndices, hoveredMeshVertexIndex, meshMarquee, activeDeformer, deformers, deformerKeyframes, selectedDeformerCPs, hoveredDeformerCPIndex, deformerMarquee, weightBrushBoneId, weightBrushRadius, weightBrushPos, physicsOffsets, yaw, pitch, isOrbited, canEdit, activeWorldToScreen, isDragging, rotateAxis]);

  // useEffectEvent ensures this always captures the latest state/props,
  // even when called from a requestAnimationFrame callback.
  const ORBIT_DEGREES_PER_PIXEL = 0.4;

  const processDragAt = useEffectEvent((sx: number, sy: number) => {
    if (orbitStart) {
      // Drag right turns the rig's right side away; drag up tips the top back.
      orbit((sx - orbitStart.x) * ORBIT_DEGREES_PER_PIXEL, (sy - orbitStart.y) * ORBIT_DEGREES_PER_PIXEL);
      setOrbitStart({ x: sx, y: sy });
      return;
    }

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

    // Mesh marquee update
    if (meshMarquee) {
      setMeshMarquee((prev) => prev ? { ...prev, currentSx: sx, currentSy: sy } : null);
      return;
    }

    // Mesh vertex drag
    if (meshDragStart && activeBone) {
      const dx = sx - meshDragStart.startScreenX;
      const dy = sy - meshDragStart.startScreenY;
      const cos = Math.cos(-meshDragStart.totalRotation);
      const sin = Math.sin(-meshDragStart.totalRotation);
      const meshScale = effectiveZoom * 0.5;
      const localDx = (dx * cos - dy * sin) / (meshScale * meshDragStart.totalScaleX || 1);
      const localDy = (dx * sin + dy * cos) / (meshScale * meshDragStart.totalScaleY || 1);
      const selectedSet = new Set(meshDragStart.selectedIndices);
      const nextVerts = meshDragStart.initialVertices.map((v, i) =>
        selectedSet.has(i) ? { x: v.x + localDx, y: v.y + localDy } : v,
      );
      if (mode === 'animate') {
        const attachmentKey = getAttachmentKey({ slotId: meshDragStart.slotId, name: meshDragStart.attachmentName });
        setMeshDeformKeyframe(attachmentKey, nextVerts);
      } else {
        const { updateAttachment: ua, attachments: atts } = useSlotStore.getState();
        const att = atts.find(
          (a) => a.slotId === meshDragStart.slotId && a.name === meshDragStart.attachmentName,
        );
        if (att?.mesh) {
          // Use nextVerts (from initialVertices + cumulative delta), not att.mesh.vertices,
          // to avoid double-accumulation on every mouse-move call.
          ua(meshDragStart.slotId, meshDragStart.attachmentName, {
            mesh: { ...att.mesh, vertices: att.mesh.vertices.map((v, i) => ({ ...v, x: nextVerts[i]!.x, y: nextVerts[i]!.y })) },
          });
        }
      }
      return;
    }

    // Deformer marquee update
    if (deformerMarquee) {
      setDeformerMarquee((prev) => prev ? { ...prev, currentSx: sx, currentSy: sy } : null);
      return;
    }

    // Deformer control-point drag
    if (deformerDragState && activeBone) {
      const dx = sx - deformerDragState.startScreenX;
      const dy = sy - deformerDragState.startScreenY;
      const cos = Math.cos(-deformerDragState.totalRotation);
      const sin = Math.sin(-deformerDragState.totalRotation);
      const localDx = (dx * cos - dy * sin) / (effectiveZoom * 0.5 * (deformerDragState.totalScaleX || 1));
      const localDy = (dx * sin + dy * cos) / (effectiveZoom * 0.5 * (deformerDragState.totalScaleY || 1));
      const selectedSet = new Set(deformerDragState.selectedCPIndices);
      const nextPts = deformerDragState.initialPoints.map((p, i) =>
        selectedSet.has(i) ? { x: p.x + localDx, y: p.y + localDy } : p,
      );
      if (mode === 'animate') {
        setDeformerKF(deformerDragState.deformerId, frame, nextPts);
      } else {
        useDeformerStore.getState().updateDeformer(deformerDragState.deformerId, { rest: nextPts });
      }
      return;
    }

    if (ikDragStart) {
      const world = previewScreenToWorld(sx, sy);
      if (!world) return;
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
      if (!world) return;
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
      } else if (tool === 'rotate' && rotateAxis !== 'z') {
        // Out-of-plane rings map drag distance to angle: an in-plane sweep is
        // meaningless for a ring seen nearly edge-on, which these often are.
        const DEGREES_PER_PIXEL = 0.5;
        const delta =
          rotateAxis === 'y'
            ? (sx - dragStart.sx) * DEGREES_PER_PIXEL
            : (sy - dragStart.sy) * DEGREES_PER_PIXEL;

        transformTargetIds.forEach((boneId) => {
          const initialState = dragStart.bones[boneId];
          if (!initialState) return;
          updateBone(boneId, {
            [rotateAxis === 'y' ? 'rotationY' : 'rotationX']:
              (rotateAxis === 'y' ? initialState.rotationY : initialState.rotationX) + delta,
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

    const hit = hitTestBone({ x: sx, y: sy }, bones, previewWorldToScreen);
    setHoveredBoneId(hit?.id || null);
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Weight paint: update brush position and paint if button held
    if (tool === 'weights') {
      setWeightBrushPos({ x: sx, y: sy });
      setHoveredBoneId(null);
      if (
        isWeightPaintingRef.current &&
        activeAttachment?.type === 'mesh' && activeAttachment.mesh &&
        activeBone && activeSlot && weightBrushBoneId !== null
      ) {
        const erase = e.shiftKey;
        const fallbackBoneId = activeBone.id;
        computeAllWorldTransforms(bones);
        const screenVerts = getMeshVertexScreenPositions(
          activeAttachment, activeBone, bones, activeWorldToScreen, activeAttachment.mesh.vertices,
        );
        const nextWeights = (activeAttachment.vertexWeights
          ? [...activeAttachment.vertexWeights]
          : activeAttachment.mesh.vertices.map(() => []));
        let changed = false;
        for (let i = 0; i < screenVerts.length; i++) {
          const sp = screenVerts[i];
          if (!sp) continue;
          const dist = Math.hypot(sp.x - sx, sp.y - sy);
          if (dist > weightBrushRadius) continue;
          const t = 1 - dist / weightBrushRadius;
          const smooth = t * t * (3 - 2 * t);
          const delta = (erase ? -1 : 1) * weightBrushStrength * smooth;
          nextWeights[i] = paintWeightBrush(nextWeights[i] ?? [], weightBrushBoneId, fallbackBoneId, delta);
          changed = true;
        }
        if (changed) {
          useSlotStore.getState().updateAttachment(activeSlot.id, activeAttachment.name, { vertexWeights: nextWeights });
        }
      }
      return;
    }

    const isActiveDrag =
      isDragging || isPanning || orbitStart !== null || attachmentDragStart !== null ||
      ikDragStart !== null || meshDragStart !== null || meshMarquee !== null ||
      deformerDragState !== null || deformerMarquee !== null;

    if (!isActiveDrag) {
      // Hover cheap path: also update hovered mesh vertex index.
      if (tool === 'mesh' && meshAttachment?.mesh && activeBone) {
        const screenVerts = getMeshVertexScreenPositions(meshAttachment, activeBone, bones, activeWorldToScreen, meshAttachment.mesh.vertices);
        const hi = screenVerts.findIndex((p) => Math.hypot(p.x - sx, p.y - sy) <= 8);
        setHoveredMeshVertexIndex(hi >= 0 ? hi : null);
        setHoveredBoneId(null);
      } else if (tool === 'warp' && activeDeformer && activeBone && activeAttachment) {
        const currentPts = resolveDeformerAtFrame(activeDeformer, frame, deformerKeyframes);
        const screenPts = getMeshVertexScreenPositions(activeAttachment, activeBone, bones, activeWorldToScreen, currentPts);
        const hi = screenPts.findIndex((p) => Math.hypot(p.x - sx, p.y - sy) <= 8);
        setHoveredDeformerCPIndex(hi >= 0 ? hi : null);
        setHoveredBoneId(null);
      } else {
        processDragAt(sx, sy);
      }
      return;
    }

    // Active drag: store latest position and process at most once per frame.
    // This prevents a high-polling mouse from queuing more renders than the
    // display can consume, which causes lag that grows the longer you drag.
    pendingDragPos.current = { sx, sy };
    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        const pos = pendingDragPos.current;
        if (pos) processDragAt(pos.sx, pos.sy);
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Alt-drag or middle-drag orbits. Alt is the one that matters: a MacBook
    // trackpad has no middle button at all, so middle-drag alone left the whole
    // feature unreachable on the machine this is developed on. Alt+drag is also
    // what Maya trained people on. Alt is otherwise unused in this canvas.
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setOrbitStart({ x: sx, y: sy });
      return;
    }

    // Editing works at any angle now, except looking straight along the plane
    // being edited, where a screen point maps to an unbounded world distance.
    if (!canEdit) {
      setIsPanning(true);
      setPanStart({ x: sx, y: sy });
      return;
    }

    const hit = hitTestBone({ x: sx, y: sy }, bones, previewWorldToScreen);

    // ── Weight paint interactions ──────────────────────────────────────────
    if (tool === 'weights' && e.button === 0 && weightBrushBoneId !== null) {
      captureSnapshot();
      isWeightPaintingRef.current = true;
      return;
    }

    // ── Warp tool interactions ─────────────────────────────────────────────
    if (tool === 'warp' && activeDeformer && activeBone && activeAttachment) {
      if (e.button !== 0) return;
      const currentPts = resolveDeformerAtFrame(activeDeformer, frame, deformerKeyframes);
      const screenPts = getMeshVertexScreenPositions(activeAttachment, activeBone, bones, activeWorldToScreen, currentPts);
      const targetIdx = screenPts.findIndex((p) => Math.hypot(p.x - sx, p.y - sy) <= 10);

      if (targetIdx >= 0) {
        // Click on a control point → select + start drag
        const nextSelected = e.shiftKey
          ? selectedDeformerCPs.includes(targetIdx)
            ? selectedDeformerCPs.filter((i) => i !== targetIdx)
            : [...selectedDeformerCPs, targetIdx]
          : selectedDeformerCPs.includes(targetIdx)
            ? selectedDeformerCPs
            : [targetIdx];
        setSelectedDeformerCPs(nextSelected);
        captureSnapshot();
        computeAllWorldTransforms(bones);
        const totalRotation = (activeBone._wrot * Math.PI) / 180;
        const totalScaleX = activeBone.scaleX;
        const totalScaleY = activeBone.scaleY;
        if (mode === 'animate' && !(frame in (deformerKeyframes[activeDeformer.id] ?? {}))) {
          const existingFrames = Object.keys(deformerKeyframes[activeDeformer.id] ?? {}).map(Number);
          const boneEasing = normalizeKeyframeEasing(keyframes[activeBone.id]?.[frame]?.easing);
          if (frame > 0 && !existingFrames.some((targetFrame) => targetFrame < frame)) {
            setDeformerKF(activeDeformer.id, 0, activeDeformer.rest);
            updateDeformerKeyframeEasing(activeDeformer.id, 0, boneEasing);
          }
          setDeformerKF(activeDeformer.id, frame, currentPts);
          updateDeformerKeyframeEasing(activeDeformer.id, frame, boneEasing);
        }
        setDeformerDragState({
          deformerId: activeDeformer.id,
          selectedCPIndices: nextSelected,
          startScreenX: sx,
          startScreenY: sy,
          totalRotation,
          totalScaleX,
          totalScaleY,
          initialPoints: currentPts,
        });
      } else {
        // Click on empty space → clear selection + start marquee
        if (!e.shiftKey) setSelectedDeformerCPs([]);
        setDeformerMarquee({ sx, sy, currentSx: sx, currentSy: sy });
      }
      return;
    }

    // ── Mesh tool interactions ────────────────────────────────────────────
    if (tool === 'mesh' && activeSlot && activeBone && activeAttachment?.type === 'mesh' && meshAttachment?.mesh) {
      const displayVerts = meshAttachment.mesh.vertices;
      const screenVerts = getMeshVertexScreenPositions(meshAttachment, activeBone, bones, activeWorldToScreen, displayVerts);
      const targetIdx = screenVerts.findIndex((p) => Math.hypot(p.x - sx, p.y - sy) <= 10);
      const attachmentKey = getAttachmentKey(activeAttachment);

      // Right-click on vertex: remove it
      if (e.button === 2 && targetIdx >= 0) {
        e.preventDefault();
        captureSnapshot();
        const animState = useAnimationStore.getState();
        const result = removeMeshVertices(activeAttachment, [targetIdx], animState.meshDeformKeyframes, attachmentKey);
        const { updateAttachment: ua } = useSlotStore.getState();
        ua(activeSlot.id, activeAttachment.name, result.attachment);
        const nf = result.meshDeformKeyframes[attachmentKey];
        if (nf && Object.keys(nf).length > 0) replaceMeshDeformKeyframesForAttachment(attachmentKey, nf);
        else clearMeshDeformKeyframesForAttachment(attachmentKey);
        setSelectedMeshVertexIndices([]);
        return;
      }

      if (e.button !== 0) return;

      // Click on vertex: select + start drag
      if (targetIdx >= 0) {
        let nextSelected: number[];
        if (e.shiftKey) {
          nextSelected = selectedMeshVertexIndices.includes(targetIdx)
            ? selectedMeshVertexIndices.filter((i) => i !== targetIdx)
            : [...selectedMeshVertexIndices, targetIdx];
        } else {
          nextSelected = selectedMeshVertexIndices.includes(targetIdx) ? selectedMeshVertexIndices : [targetIdx];
        }
        setSelectedMeshVertexIndices(nextSelected);
        if (nextSelected.length === 0) return;

        if (meshDragStart === null) captureSnapshot();

        if (mode === 'animate') {
          const existingFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number);
          const boneEasing = normalizeKeyframeEasing(keyframes[activeBone.id]?.[frame]?.easing);
          if (frame > 0 && activeAttachment.mesh && !existingFrames.some((f) => f < frame)) {
            setMeshDeformKeyframeAtFrame(attachmentKey, 0, activeAttachment.mesh.vertices.map((v) => ({ x: v.x, y: v.y })));
            updateMeshDeformKeyframeEasing(attachmentKey, 0, boneEasing);
          }
          setMeshDeformKeyframeAtFrame(attachmentKey, frame, displayVerts.map((v) => ({ x: v.x, y: v.y })));
          updateMeshDeformKeyframeEasing(attachmentKey, frame, boneEasing);
          insertKeyframe(activeBone.id, { x: activeBone.x, y: activeBone.y, rotation: activeBone.rotation, scaleX: activeBone.scaleX, scaleY: activeBone.scaleY });
        }

        const totalRotation = ((activeBone._wrot + activeAttachment.rotation) * Math.PI) / 180;
        setMeshDragStart({
          slotId: activeSlot.id,
          attachmentName: activeAttachment.name,
          selectedIndices: nextSelected,
          startScreenX: sx,
          startScreenY: sy,
          totalRotation,
          totalScaleX: activeAttachment.scaleX * activeBone.scaleX,
          totalScaleY: activeAttachment.scaleY * activeBone.scaleY,
          initialVertices: displayVerts.map((v) => ({ x: v.x, y: v.y })),
        });
        return;
      }

      // Double-click on empty space inside the mesh: add a new vertex there
      if (e.detail >= 2) {
        const animState = useAnimationStore.getState();
        const insertResult = insertMeshVertex(activeAttachment, sx, sy, screenVerts, animState.meshDeformKeyframes, attachmentKey);
        if (insertResult) {
          captureSnapshot();
          const { updateAttachment: ua } = useSlotStore.getState();
          ua(activeSlot.id, activeAttachment.name, insertResult.attachment);
          const nf = insertResult.meshDeformKeyframes[attachmentKey];
          if (nf && Object.keys(nf).length > 0) replaceMeshDeformKeyframesForAttachment(attachmentKey, nf);
          const newIdx = (insertResult.attachment.mesh?.vertices.length ?? 1) - 1;
          setSelectedMeshVertexIndices([newIdx]);
          return;
        }
      }

      // Click on empty space: start marquee or deselect
      if (!e.shiftKey) setSelectedMeshVertexIndices([]);
      setMeshMarquee({ sx, sy, currentSx: sx, currentSy: sy });
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
    if (!world) return;

    // Grabbing a ring picks the axis; anywhere else keeps the original Z drag,
    // so muscle memory for the 2D rotate tool is untouched.
    if (tool === 'rotate' && activeBone) {
      setRotateAxis(
        gizmoAxisAt(sx, sy, activeBone, previewWorldToScreen, GIZMO_RADIUS_PX / effectiveZoom) ?? 'z',
      );
    }

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
                rotationX: bone.rotationX ?? 0,
                rotationY: bone.rotationY ?? 0,
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
            rotationX: number;
            rotationY: number;
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
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragPos.current = null;

    setIsPanning(false);
    setPanStart(null);
    setOrbitStart(null);

    if (ikDragStart && mode === 'animate') {
      const affectedBoneIds = [ikDragStart.rootId, ikDragStart.childId];
      affectedBoneIds.forEach((boneId) => {
        const bone = bones.find((item) => item.id === boneId);
        if (!bone) return;

        insertKeyframe(bone.id, {
          x: bone.x,
          y: bone.y,
          rotation: bone.rotation,
          rotationX: bone.rotationX ?? 0,
          rotationY: bone.rotationY ?? 0,
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
          rotationX: bone.rotationX ?? 0,
          rotationY: bone.rotationY ?? 0,
          scaleX: bone.scaleX,
          scaleY: bone.scaleY,
        });
      });
    }

    setAttachmentDragStart(null);
    setIkDragStart(null);
    setIsDragging(false);
    setDragStart(null);

    // Mesh: commit marquee selection
    if (meshMarquee && meshAttachment?.mesh && activeBone) {
      const mx0 = Math.min(meshMarquee.sx, meshMarquee.currentSx);
      const my0 = Math.min(meshMarquee.sy, meshMarquee.currentSy);
      const mx1 = Math.max(meshMarquee.sx, meshMarquee.currentSx);
      const my1 = Math.max(meshMarquee.sy, meshMarquee.currentSy);
      const screenVerts = getMeshVertexScreenPositions(meshAttachment, activeBone, bones, activeWorldToScreen, meshAttachment.mesh.vertices);
      const inside = screenVerts
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.x >= mx0 && p.x <= mx1 && p.y >= my0 && p.y <= my1)
        .map(({ i }) => i);
      setSelectedMeshVertexIndices(inside);
    }
    setMeshMarquee(null);
    setMeshDragStart(null);

    // Warp: commit deformer marquee selection
    if (deformerMarquee && activeDeformer && activeBone && activeAttachment) {
      const mx0 = Math.min(deformerMarquee.sx, deformerMarquee.currentSx);
      const my0 = Math.min(deformerMarquee.sy, deformerMarquee.currentSy);
      const mx1 = Math.max(deformerMarquee.sx, deformerMarquee.currentSx);
      const my1 = Math.max(deformerMarquee.sy, deformerMarquee.currentSy);
      const currentPts = resolveDeformerAtFrame(activeDeformer, frame, deformerKeyframes);
      const screenPts = getMeshVertexScreenPositions(activeAttachment, activeBone, bones, activeWorldToScreen, currentPts);
      const inside = screenPts
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.x >= mx0 && p.x <= mx1 && p.y >= my0 && p.y <= my1)
        .map(({ i }) => i);
      setSelectedDeformerCPs(inside);
    }
    setDeformerMarquee(null);
    setDeformerDragState(null);

    // Weight paint: stop painting on mouse up
    isWeightPaintingRef.current = false;
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
      <canvas ref={bgCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
      <canvas ref={glCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setWeightBrushPos(null); isWeightPaintingRef.current = false; }}
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

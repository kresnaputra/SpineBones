import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useHistoryStore } from '../../stores/historyStore';
import { getAttachmentKey } from '../../utils/attachmentUtils';
import { resolveAttachmentAtFrame } from '../../utils/attachmentUtils';
import {
  rebuildMeshGrid,
  relaxMeshVertices,
  getVertexBasePosition,
} from '../../utils/meshAttachment';
import { generateAutoMesh } from '../../utils/meshGeneration';
import { normalizeKeyframeEasing } from '../../utils/easing';

const GRID_PRESETS = [
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
  { label: '5×5', cols: 5, rows: 5 },
] as const;

export const MeshPropertiesPanel = () => {
  const [relaxStrength, setRelaxStrength] = useState(0.5);
  const [autoMeshDensity, setAutoMeshDensity] = useState(0.5);
  const [autoMeshEdgeDetail, setAutoMeshEdgeDetail] = useState(0.4);
  const [isGenerating, setIsGenerating] = useState(false);

  const {
    tool,
    mode,
    selectedBoneId,
    selectedSlotId,
    selectedMeshVertexIndices,
    setSelectedMeshVertexIndices,
  } = useEditorStore();

  const {
    frame,
    keyframes,
    meshDeformKeyframes,
    attachmentOpacityKeyframes,
    setMeshDeformKeyframeAtFrame,
    updateMeshDeformKeyframeEasing,
    insertKeyframe,
    clearMeshDeformKeyframesForAttachment,
  } = useAnimationStore();

  const { slots, attachments, updateAttachment } = useSlotStore();
  const { bones } = useSkeletonStore();
  const { captureSnapshot } = useHistoryStore();

  if (tool !== 'mesh' || selectedBoneId === null) return null;

  const boneSlots = slots.filter((s) => s.boneId === selectedBoneId);
  const activeSlot =
    (selectedSlotId !== null
      ? boneSlots.find((s) => s.id === selectedSlotId && s.attachmentName !== null)
      : null) ?? boneSlots.find((s) => s.attachmentName !== null);

  if (!activeSlot?.attachmentName) return null;

  const attachment = attachments.find(
    (a) => a.slotId === activeSlot.id && a.name === activeSlot.attachmentName,
  );

  if (!attachment || attachment.type !== 'mesh' || !attachment.mesh?.vertices.length) return null;

  const activeBone = bones.find((b) => b.id === selectedBoneId);
  if (!activeBone) return null;

  const attachmentKey = getAttachmentKey(attachment);

  // In setup mode every edit here targets the rest mesh, so resolve against rest
  // values rather than the frame's keyframed ones.
  const resolvedAttachment = resolveAttachmentAtFrame(
    attachment,
    frame,
    mode === 'animate' ? attachmentOpacityKeyframes : {},
    mode === 'animate' ? meshDeformKeyframes : {},
  );
  const workingVertices = resolvedAttachment.mesh?.vertices ?? attachment.mesh.vertices;

  const vertexCount = attachment.mesh.vertices.length;
  const triCount = attachment.mesh.triangles.length;
  const allIndices = Array.from({ length: vertexCount }, (_, i) => i);
  const operationIndices = selectedMeshVertexIndices.length > 0 ? selectedMeshVertexIndices : allIndices;
  const pinnedIndices = attachment.pinned?.map((p, i) => (p ? i : -1)).filter((i) => i >= 0) ?? [];
  const activeGrid = attachment.mesh.grid ?? null;

  const handleAutoGenerate = async () => {
    if (!attachment.imageData || isGenerating) return;
    setIsGenerating(true);
    try {
      const mesh = await generateAutoMesh(attachment, autoMeshDensity, autoMeshEdgeDetail);
      if (mesh) {
        captureSnapshot();
        updateAttachment(activeSlot.id, attachment.name, { mesh, pinned: undefined });
        clearMeshDeformKeyframesForAttachment(attachmentKey);
        setSelectedMeshVertexIndices([]);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRebuildGrid = (cols: number, rows: number) => {
    captureSnapshot();
    updateAttachment(activeSlot.id, attachment.name, rebuildMeshGrid(attachment, cols, rows));
    clearMeshDeformKeyframesForAttachment(attachmentKey);
    setSelectedMeshVertexIndices([]);
  };

  const handleRelax = () => {
    if (!attachment.mesh?.triangles.length) return;
    captureSnapshot();
    const relaxed = relaxMeshVertices(workingVertices, attachment.mesh.triangles, operationIndices, pinnedIndices, relaxStrength);

    if (mode === 'animate') {
      const existingFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number);
      const boneEasing = normalizeKeyframeEasing(keyframes[activeBone.id]?.[frame]?.easing);
      if (frame > 0 && !existingFrames.some((f) => f < frame)) {
        setMeshDeformKeyframeAtFrame(attachmentKey, 0, attachment.mesh.vertices.map((v) => ({ x: v.x, y: v.y })));
      }
      setMeshDeformKeyframeAtFrame(attachmentKey, frame, relaxed.map((v) => ({ x: v.x, y: v.y })));
      updateMeshDeformKeyframeEasing(attachmentKey, frame, boneEasing);
      insertKeyframe(activeBone.id, { x: activeBone.x, y: activeBone.y, rotation: activeBone.rotation, scaleX: activeBone.scaleX, scaleY: activeBone.scaleY });
    } else {
      updateAttachment(activeSlot.id, attachment.name, {
        mesh: { ...attachment.mesh, vertices: relaxed },
      });
    }
  };

  const handleResetSelected = () => {
    captureSnapshot();
    if (mode === 'animate') {
      const baseVerts = attachment.mesh!.vertices;
      const current = workingVertices.map((v, i) =>
        operationIndices.includes(i) ? { x: baseVerts[i]!.x, y: baseVerts[i]!.y } : { x: v.x, y: v.y },
      );
      const existingFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number);
      if (frame > 0 && !existingFrames.some((f) => f < frame)) {
        setMeshDeformKeyframeAtFrame(attachmentKey, 0, baseVerts.map((v) => ({ x: v.x, y: v.y })));
      }
      setMeshDeformKeyframeAtFrame(attachmentKey, frame, current);
    } else {
      const resetVerts = attachment.mesh!.vertices.map((v, i) => {
        if (!operationIndices.includes(i)) return v;
        const base = getVertexBasePosition(v, attachment);
        return { ...v, x: base.x, y: base.y };
      });
      updateAttachment(activeSlot.id, attachment.name, { mesh: { ...attachment.mesh!, vertices: resetVerts } });
    }
  };

  const handleTogglePin = () => {
    if (operationIndices.length === 0) return;
    captureSnapshot();
    const pinned = attachment.pinned?.slice() ?? new Array(vertexCount).fill(false);
    const anyUnpinned = operationIndices.some((i) => !pinned[i]);
    operationIndices.forEach((i) => { pinned[i] = anyUnpinned; });
    updateAttachment(activeSlot.id, attachment.name, { pinned });
  };

  const selectedArePinned = operationIndices.length > 0 && operationIndices.every((i) => attachment.pinned?.[i]);

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        Mesh
        <span className="ml-2 font-normal normal-case text-text-dim">
          {vertexCount}v · {triCount}t
          {selectedMeshVertexIndices.length > 0 ? ` · ${selectedMeshVertexIndices.length} selected` : ''}
        </span>
      </div>

      <div className="px-3 py-2 border-b border-border/50 space-y-0.5">
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">+</span>
          <span><span className="text-text">Double-click</span> empty space inside mesh to add vertex</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">−</span>
          <span>Select vertex then <span className="text-text">Delete / ⌫</span> to remove</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">⬚</span>
          <span><span className="text-text">Right-click</span> vertex to remove it</span>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/50 space-y-1.5">
        <div className="text-[9px] text-text-dim uppercase tracking-wide mb-1">Auto Mesh</div>
        <div className="flex items-center gap-2">
          <label className="text-[9px] text-text-dim w-14 flex-shrink-0">Density</label>
          <input
            type="range" min="0" max="1" step="0.05" value={autoMeshDensity}
            onChange={(e) => setAutoMeshDensity(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-[10px] text-text w-7 text-right">{Math.round(autoMeshDensity * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[9px] text-text-dim w-14 flex-shrink-0">Edge Detail</label>
          <input
            type="range" min="0" max="1" step="0.05" value={autoMeshEdgeDetail}
            onChange={(e) => setAutoMeshEdgeDetail(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-[10px] text-text w-7 text-right">{Math.round(autoMeshEdgeDetail * 100)}%</span>
        </div>
        <button
          onClick={handleAutoGenerate}
          disabled={isGenerating || !attachment.imageData}
          className="w-full px-2 py-1 text-[10px] rounded border border-accent/50 bg-accent/10 text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? 'Generating…' : 'Generate Auto Mesh'}
        </button>
        <div className="text-[9px] text-text-dim">Traces sprite alpha, clears deform keyframes.</div>
      </div>

      <div className="px-3 py-2 border-b border-border/50">
        <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">Rebuild Grid</div>
        <div className="flex gap-1 flex-wrap">
          {GRID_PRESETS.map(({ label, cols, rows }) => {
            const isActive = activeGrid?.columns === cols && activeGrid.rows === rows;
            return (
              <button
                key={label}
                onClick={() => handleRebuildGrid(cols, rows)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-all ${
                  isActive
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="text-[9px] text-text-dim mt-1">Clears deform keyframes for this mesh.</div>
      </div>

      <div className="px-3 py-2 border-b border-border/50 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-dim">
            Relax {selectedMeshVertexIndices.length > 0 ? 'Selected' : 'All'}
          </span>
          <button
            onClick={handleRelax}
            className="px-2 py-0.5 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
          >
            Relax
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[9px] text-text-dim w-12 flex-shrink-0">Strength</label>
          <input
            type="range" min="0.05" max="1" step="0.05" value={relaxStrength}
            onChange={(e) => setRelaxStrength(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-[10px] text-text w-7 text-right">{Math.round(relaxStrength * 100)}%</span>
        </div>
        <div className="text-[9px] text-text-dim">Pinned vertices are skipped.</div>
      </div>

      <div className="px-3 py-2 border-b border-border/50 flex gap-2">
        <button
          onClick={handleResetSelected}
          className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
        >
          Reset {selectedMeshVertexIndices.length > 0 ? 'Selected' : 'All'}
        </button>
        <button
          onClick={handleTogglePin}
          disabled={selectedMeshVertexIndices.length === 0}
          className={`flex-1 px-2 py-1 text-[10px] rounded border transition-all disabled:opacity-40 ${
            selectedArePinned
              ? 'border-amber-500 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
              : 'border-border bg-panel2 text-text-dim hover:border-amber-500/60 hover:text-text'
          }`}
        >
          {selectedArePinned ? 'Unpin' : 'Pin'} Selected
        </button>
      </div>
    </div>
  );
};

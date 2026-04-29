import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useHistoryStore } from '../../stores/historyStore';
import {
  getMeshAttachmentKey,
  resolveAttachmentAtFrame,
  rebuildMeshGrid,
  relaxMeshVertices,
  getVertexBasePosition,
} from '../../utils/meshAttachment';
import { normalizeKeyframeEasing } from '../../utils/easing';
import type { MeshVertexWeight } from '../../types';

const GRID_PRESETS = [
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
  { label: '5×5', cols: 5, rows: 5 },
] as const;

export const MeshPropertiesPanel = () => {
  const [relaxStrength, setRelaxStrength] = useState(0.5);

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

  if (!attachment || attachment.type !== 'mesh' || !attachment.meshVertices?.length) return null;

  const activeBone = bones.find((b) => b.id === selectedBoneId);
  if (!activeBone) return null;

  const attachmentKey = getMeshAttachmentKey(attachment);

  // Resolved vertices for animate mode operations.
  const resolvedAttachment = resolveAttachmentAtFrame(
    attachment,
    frame,
    meshDeformKeyframes,
    attachmentOpacityKeyframes,
  );
  const workingVertices = resolvedAttachment.meshVertices ?? attachment.meshVertices;

  const vertexCount = attachment.meshVertices.length;
  const allIndices = Array.from({ length: vertexCount }, (_, i) => i);
  const operationIndices =
    selectedMeshVertexIndices.length > 0 ? selectedMeshVertexIndices : allIndices;
  const pinnedIndices = attachment.meshPinnedVertices
    ?.map((p, i) => (p ? i : -1))
    .filter((i) => i >= 0) ?? [];

  // ─── Grid rebuild ──────────────────────────────────────────────────────────

  const handleRebuildGrid = (cols: number, rows: number) => {
    captureSnapshot();
    const newAttachment = rebuildMeshGrid(attachment, cols, rows);
    updateAttachment(activeSlot.id, attachment.name, newAttachment);
    clearMeshDeformKeyframesForAttachment(attachmentKey);
    setSelectedMeshVertexIndices([]);
  };

  // ─── Relax ─────────────────────────────────────────────────────────────────

  const handleRelax = () => {
    if (!attachment.meshTriangles?.length) return;
    captureSnapshot();

    const relaxed = relaxMeshVertices(
      workingVertices,
      attachment.meshTriangles,
      operationIndices,
      pinnedIndices,
      relaxStrength,
    );

    if (mode === 'animate') {
      const existingFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number);
      const currentBoneEasing = normalizeKeyframeEasing(keyframes[activeBone.id]?.[frame]?.easing);

      if (frame > 0 && !existingFrames.some((f) => f < frame)) {
        setMeshDeformKeyframeAtFrame(
          attachmentKey,
          0,
          (attachment.meshVertices ?? []).map((v) => ({ x: v.x, y: v.y })),
        );
      }
      setMeshDeformKeyframeAtFrame(
        attachmentKey,
        frame,
        relaxed.map((v) => ({ x: v.x, y: v.y })),
      );
      updateMeshDeformKeyframeEasing(attachmentKey, frame, currentBoneEasing);
      insertKeyframe(activeBone.id, {
        x: activeBone.x,
        y: activeBone.y,
        rotation: activeBone.rotation,
        scaleX: activeBone.scaleX,
        scaleY: activeBone.scaleY,
      });
    } else {
      updateAttachment(activeSlot.id, attachment.name, {
        meshVertices: relaxed,
      });
    }
  };

  // ─── Reset selected vertices ───────────────────────────────────────────────

  const handleResetSelected = () => {
    if (operationIndices.length === 0) return;
    captureSnapshot();

    if (mode === 'animate') {
      // Reset selected vertices in the current keyframe back to setup-pose positions.
      const baseVertices = attachment.meshVertices!;
      const currentResolved = workingVertices.map((v, i) =>
        operationIndices.includes(i) ? { x: baseVertices[i]!.x, y: baseVertices[i]!.y } : { x: v.x, y: v.y },
      );
      const existingFrames = Object.keys(meshDeformKeyframes[attachmentKey] ?? {}).map(Number);
      if (frame > 0 && !existingFrames.some((f) => f < frame)) {
        setMeshDeformKeyframeAtFrame(
          attachmentKey,
          0,
          baseVertices.map((v) => ({ x: v.x, y: v.y })),
        );
      }
      setMeshDeformKeyframeAtFrame(attachmentKey, frame, currentResolved);
    } else {
      // Reset selected vertices to UV-derived base positions.
      const resetVertices = (attachment.meshVertices ?? []).map((v, i) => {
        if (!operationIndices.includes(i)) return v;
        const base = getVertexBasePosition(v, attachment);
        return { ...v, x: base.x, y: base.y };
      });
      updateAttachment(activeSlot.id, attachment.name, { meshVertices: resetVertices });
    }
  };

  // ─── Pin / unpin ───────────────────────────────────────────────────────────

  const handleTogglePin = () => {
    if (operationIndices.length === 0) return;
    captureSnapshot();
    const pinned = attachment.meshPinnedVertices?.slice() ?? new Array(vertexCount).fill(false);
    const anyUnpinned = operationIndices.some((i) => !pinned[i]);
    operationIndices.forEach((i) => {
      pinned[i] = anyUnpinned;
    });
    updateAttachment(activeSlot.id, attachment.name, { meshPinnedVertices: pinned });
  };

  const selectedArePinned =
    operationIndices.length > 0 &&
    operationIndices.every((i) => attachment.meshPinnedVertices?.[i]);

  // ─── Bone weights for selected vertex ─────────────────────────────────────

  // Show weight UI only when exactly one vertex is selected (keeps MVP tractable).
  const singleSelected =
    selectedMeshVertexIndices.length === 1 ? selectedMeshVertexIndices[0] : null;

  const currentWeights: MeshVertexWeight[] =
    singleSelected !== null
      ? (attachment.meshVertexWeights?.[singleSelected] ?? [])
      : [];

  const handleSetWeight = (boneId: number, rawWeight: number) => {
    if (singleSelected === null) return;
    captureSnapshot();
    const weight = Math.max(0, Math.min(1, rawWeight));
    const existing = attachment.meshVertexWeights?.map((w) => [...w]) ??
      new Array(vertexCount).fill(null).map(() => [] as MeshVertexWeight[]);
    const row = existing[singleSelected] ?? [];
    const idx = row.findIndex((w) => w.boneId === boneId);
    if (idx >= 0) {
      if (weight === 0) {
        row.splice(idx, 1);
      } else {
        row[idx]!.weight = weight;
      }
    } else if (weight > 0) {
      row.push({ boneId, weight });
    }
    existing[singleSelected] = row;
    updateAttachment(activeSlot.id, attachment.name, { meshVertexWeights: existing });
  };

  // ─── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        Mesh
        <span className="ml-2 font-normal normal-case text-text-dim">
          {vertexCount}v · {attachment.meshTriangles?.length ?? 0}t
          {selectedMeshVertexIndices.length > 0
            ? ` · ${selectedMeshVertexIndices.length} selected`
            : ''}
        </span>
      </div>

      {/* Vertex interaction hints */}
      <div className="px-3 py-2 border-b border-border/50 space-y-0.5">
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">+</span>
          <span><span className="text-text">Double-click</span> inside mesh to add vertex</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">−</span>
          <span>Select vertex then <span className="text-text">Delete / ⌫</span> to remove</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5 items-start">
          <span className="text-text-dim/60">⬚</span>
          <span><span className="text-text">Drag</span> empty space to box-select</span>
        </div>
      </div>

      {/* Grid presets */}
      <div className="px-3 py-2 border-b border-border/50">
        <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">Rebuild Grid</div>
        <div className="flex gap-1 flex-wrap">
          {GRID_PRESETS.map(({ label, cols, rows }) => (
            <button
              key={label}
              onClick={() => handleRebuildGrid(cols, rows)}
              className="px-2 py-0.5 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
              title={`Rebuild as ${cols}×${rows} grid (clears deform keyframes)`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[9px] text-text-dim mt-1">Clears deform keyframes for this mesh.</div>
      </div>

      {/* Relax */}
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
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={relaxStrength}
            onChange={(e) => setRelaxStrength(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-[10px] text-text w-7 text-right">{Math.round(relaxStrength * 100)}%</span>
        </div>
        <div className="text-[9px] text-text-dim">Pinned vertices are skipped.</div>
      </div>

      {/* Reset / Pin */}
      <div className="px-3 py-2 border-b border-border/50 flex gap-2">
        <button
          onClick={handleResetSelected}
          disabled={operationIndices.length === 0}
          className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all disabled:opacity-40"
          title={
            mode === 'animate'
              ? 'Reset selected vertices to setup-pose positions at current frame'
              : 'Reset selected vertices to their UV-derived base positions'
          }
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
          title={selectedArePinned ? 'Unpin selected vertices' : 'Pin selected vertices (excluded from relax)'}
        >
          {selectedArePinned ? 'Unpin' : 'Pin'}
        </button>
      </div>

      {/* Bone weights (single vertex) */}
      {singleSelected !== null && (
        <div className="px-3 py-2">
          <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">
            Bone Weights — Vertex {singleSelected}
          </div>
          <div className="space-y-1">
            {bones.map((bone) => {
              const w = currentWeights.find((ww) => ww.boneId === bone.id)?.weight ?? 0;
              return (
                <div key={bone.id} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-dim truncate flex-1">{bone.name}</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={w.toFixed(2)}
                    onChange={(e) => handleSetWeight(bone.id, Number(e.target.value))}
                    className="w-14 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[10px] focus:outline-none focus:border-accent"
                  />
                </div>
              );
            })}
          </div>
          <div className="text-[9px] text-text-dim mt-1">
            Weights ≥ 2 bones activate multi-bone blending during render.
          </div>
        </div>
      )}
    </div>
  );
};

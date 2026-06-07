import { useEditorStore } from '../../stores/editorStore';
import { useDeformerStore } from '../../stores/deformerStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useHistoryStore } from '../../stores/historyStore';
import { ensureMeshAttachment } from '../../utils/meshAttachment';

const GRID_PRESETS = [
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
] as const;

const buildRestGrid = (
  cols: number,
  rows: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x: number; y: number }[] => {
  const pts: { x: number; y: number }[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      pts.push({
        x: minX + (col / cols) * (maxX - minX),
        y: minY + (row / rows) * (maxY - minY),
      });
    }
  }
  return pts;
};

const MARGIN = 0.08;

export const DeformerPropertiesPanel = () => {
  const { tool, mode, selectedBoneId, selectedSlotId } = useEditorStore();
  const { frame } = useAnimationStore();
  const {
    deformers,
    deformerKeyframes,
    addDeformer,
    removeDeformer,
    clearDeformerKeyframes,
    deleteDeformerKeyframe,
  } = useDeformerStore();
  const { slots, attachments, updateAttachment } = useSlotStore();
  const { bones } = useSkeletonStore();
  const { captureSnapshot } = useHistoryStore();

  if (tool !== 'warp' || selectedBoneId === null) return null;

  const boneSlots = slots.filter((s) => s.boneId === selectedBoneId);
  const activeSlot =
    (selectedSlotId !== null
      ? boneSlots.find((s) => s.id === selectedSlotId && s.attachmentName !== null)
      : null) ?? boneSlots.find((s) => s.attachmentName !== null);

  if (!activeSlot?.attachmentName) {
    return (
      <div className="border-b border-border">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          Warp Deformer
        </div>
        <div className="px-3 py-2 text-[9px] text-text-dim">Select a bone with an attachment.</div>
      </div>
    );
  }

  const attachment = attachments.find(
    (a) => a.slotId === activeSlot.id && a.name === activeSlot.attachmentName,
  );
  if (!attachment) return null;

  const boundDeformer = attachment.deformerId != null
    ? deformers.find((d) => d.id === attachment.deformerId)
    : undefined;

  const kfsForDeformer = boundDeformer ? (deformerKeyframes[boundDeformer.id] ?? {}) : {};
  const hasKFAtFrame = boundDeformer ? (frame in kfsForDeformer) : false;
  const totalKFs = Object.keys(kfsForDeformer).length;

  const handleCreate = (cols: number, rows: number) => {
    captureSnapshot();

    // Auto-convert image→mesh so the warp has vertices to deform
    let meshAttachment = attachment;
    if (attachment.type !== 'mesh' || !attachment.mesh?.vertices.length) {
      meshAttachment = ensureMeshAttachment(attachment);
      updateAttachment(activeSlot.id, activeSlot.attachmentName!, {
        type: 'mesh',
        mesh: meshAttachment.mesh,
      });
    }

    // Prefer opaqueBounds (tight around visible pixels), then vertex extents, then full dims.
    let minX: number, minY: number, maxX: number, maxY: number;
    const ob = meshAttachment.opaqueBounds;
    if (ob) {
      minX = ob.x - meshAttachment.width / 2;
      minY = ob.y - meshAttachment.height / 2;
      maxX = minX + ob.width;
      maxY = minY + ob.height;
    } else {
      const verts = meshAttachment.mesh?.vertices ?? [];
      minX = -meshAttachment.width / 2;
      minY = -meshAttachment.height / 2;
      maxX = meshAttachment.width / 2;
      maxY = meshAttachment.height / 2;
      if (verts.length >= 2) {
        minX = Math.min(...verts.map((v) => v.x));
        maxX = Math.max(...verts.map((v) => v.x));
        minY = Math.min(...verts.map((v) => v.y));
        maxY = Math.max(...verts.map((v) => v.y));
      }
    }
    const mx = (maxX - minX) * MARGIN;
    const my = (maxY - minY) * MARGIN;
    minX -= mx; maxX += mx; minY -= my; maxY += my;
    const bounds = { minX, minY, maxX, maxY };
    const rest = buildRestGrid(cols, rows, minX, minY, maxX, maxY);
    const bone = bones.find((b) => b.id === selectedBoneId);
    const newId = addDeformer({
      name: `Warp ${activeSlot.attachmentName ?? ''}`,
      parentBoneId: bone?.id ?? null,
      grid: { cols, rows },
      rest,
      bounds,
    });
    updateAttachment(activeSlot.id, activeSlot.attachmentName!, { deformerId: newId });
  };

  const handleUnbind = () => {
    captureSnapshot();
    updateAttachment(activeSlot.id, activeSlot.attachmentName!, { deformerId: undefined });
  };

  const handleDelete = () => {
    if (!boundDeformer) return;
    captureSnapshot();
    removeDeformer(boundDeformer.id);
    updateAttachment(activeSlot.id, activeSlot.attachmentName!, { deformerId: undefined });
  };

  const handleClearFrame = () => {
    if (!boundDeformer || !hasKFAtFrame) return;
    captureSnapshot();
    deleteDeformerKeyframe(boundDeformer.id, frame);
  };

  const handleClearAll = () => {
    if (!boundDeformer || totalKFs === 0) return;
    captureSnapshot();
    clearDeformerKeyframes(boundDeformer.id);
  };

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        Warp Deformer
        {boundDeformer && (
          <span className="ml-2 font-normal normal-case text-text-dim">
            {boundDeformer.grid.cols}×{boundDeformer.grid.rows}
            {' · '}{(boundDeformer.grid.cols + 1) * (boundDeformer.grid.rows + 1)} pts
          </span>
        )}
      </div>

      {!boundDeformer ? (
        <div className="px-3 py-2 border-b border-border/50">
          <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">Create Warp Deformer</div>
          <div className="flex gap-1 flex-wrap">
            {GRID_PRESETS.map(({ label, cols, rows }) => (
              <button
                key={label}
                onClick={() => handleCreate(cols, rows)}
                className="px-2 py-0.5 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-[9px] text-text-dim mt-1">Wraps a cage around the active mesh.</div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border/50">
            <div className="text-[9px] text-text-dim truncate">{boundDeformer.name}</div>
            <div className="flex gap-1.5 mt-1.5">
              <button
                onClick={handleUnbind}
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
              >
                Unbind
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-red-500/60 hover:text-red-400 transition-all"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="px-3 py-2 border-b border-border/50">
            <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">
              Keyframes
              {totalKFs > 0 && <span className="ml-1 font-normal normal-case">({totalKFs} total)</span>}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={handleClearFrame}
                disabled={!hasKFAtFrame}
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear Frame
              </button>
              <button
                onClick={handleClearAll}
                disabled={totalKFs === 0}
                className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-red-500/60 hover:text-red-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="px-3 py-2 border-b border-border/50 space-y-0.5">
            <div className="text-[9px] text-text-dim flex gap-1.5">
              <span className="text-text-dim/60">◈</span>
              <span>Click control point to select</span>
            </div>
            <div className="text-[9px] text-text-dim flex gap-1.5">
              <span className="text-text-dim/60">⊡</span>
              <span>Drag to {mode === 'animate' ? 'warp (keyframe)' : 'reshape rest'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

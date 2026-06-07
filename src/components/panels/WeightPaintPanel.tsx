import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useSlotStore } from '../../stores/slotStore';
import { useHistoryStore } from '../../stores/historyStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { computeAutoWeights } from '../../utils/weightUtils';

export const WeightPaintPanel = () => {
  const {
    tool,
    selectedBoneId,
    weightBrushBoneId,
    weightBrushRadius,
    weightBrushStrength,
    setWeightBrushBoneId,
    setWeightBrushRadius,
    setWeightBrushStrength,
  } = useEditorStore();
  const { bones } = useSkeletonStore();
  const { slots, attachments, updateAttachment } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();

  if (tool !== 'weights') return null;

  const boneSlots = selectedBoneId !== null ? slots.filter((s) => s.boneId === selectedBoneId) : [];
  const activeSlot = boneSlots.find((s) => s.attachmentName !== null) ?? null;
  const activeAttachment = activeSlot?.attachmentName
    ? attachments.find((a) => a.slotId === activeSlot.id && a.name === activeSlot.attachmentName) ?? null
    : null;
  const hasMesh = activeAttachment?.type === 'mesh' && (activeAttachment.mesh?.vertices.length ?? 0) > 0;

  const handleAutoWeights = () => {
    if (!activeAttachment?.mesh || !activeSlot) return;
    const fallbackBone = bones.find((b) => b.id === selectedBoneId);
    if (!fallbackBone) return;
    captureSnapshot();
    computeAllWorldTransforms(bones);
    const weights = computeAutoWeights(
      activeAttachment.mesh.vertices,
      activeAttachment,
      fallbackBone,
      bones,
    );
    updateAttachment(activeSlot.id, activeAttachment.name, { vertexWeights: weights });
  };

  const handleClearWeights = () => {
    if (!activeAttachment?.mesh || !activeSlot) return;
    captureSnapshot();
    updateAttachment(activeSlot.id, activeAttachment.name, { vertexWeights: undefined });
  };

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        Weight Paint
      </div>

      {!hasMesh ? (
        <div className="px-3 py-2 text-[9px] text-text-dim">
          Select a bone with a mesh attachment.
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border/50">
            <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wide">Paint Bone</div>
            <select
              value={weightBrushBoneId ?? ''}
              onChange={(e) =>
                setWeightBrushBoneId(e.target.value === '' ? null : parseInt(e.target.value))
              }
              className="w-full bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent"
            >
              <option value="">— select bone —</option>
              {bones.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="px-3 py-2 border-b border-border/50 space-y-2">
            <div>
              <div className="flex justify-between text-[9px] text-text-dim mb-0.5">
                <span>Radius</span>
                <span>{Math.round(weightBrushRadius)}px</span>
              </div>
              <input
                type="range"
                min="10"
                max="300"
                value={weightBrushRadius}
                onChange={(e) => setWeightBrushRadius(parseFloat(e.target.value))}
                className="w-full h-1 accent-accent"
              />
            </div>
            <div>
              <div className="flex justify-between text-[9px] text-text-dim mb-0.5">
                <span>Strength</span>
                <span>{weightBrushStrength.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={weightBrushStrength}
                onChange={(e) => setWeightBrushStrength(parseFloat(e.target.value))}
                className="w-full h-1 accent-accent"
              />
            </div>
          </div>

          <div className="px-3 py-2 border-b border-border/50 flex gap-1.5">
            <button
              onClick={handleAutoWeights}
              className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
            >
              Auto Weights
            </button>
            <button
              onClick={handleClearWeights}
              className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-red-500/60 hover:text-red-400 transition-all"
            >
              Clear
            </button>
          </div>

          <div className="px-3 py-2 border-b border-border/50 space-y-0.5">
            <div className="text-[9px] text-text-dim flex gap-1.5">
              <span className="text-text-dim/60">◈</span>
              <span>Left-drag to add weight</span>
            </div>
            <div className="text-[9px] text-text-dim flex gap-1.5">
              <span className="text-text-dim/60">◈</span>
              <span>Shift+drag to erase weight</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';
import { AttachmentPropertiesPanel } from './AttachmentPropertiesPanel';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { getIkChain, getIkRootForBone } from '../../utils/ik';

export const PropertiesPanel = () => {
  const { selectedBoneId, mode } = useEditorStore();
  const { bones, updateBone, ikChainRootIds, toggleIkChain } = useSkeletonStore();
  const { insertKeyframe } = useAnimationStore();
  const { captureSnapshot } = useHistoryStore();

  const selectedBone = bones.find((b) => b.id === selectedBoneId);
  const ikRootBone = selectedBone ? getIkRootForBone(selectedBone.id, bones) : null;
  const ikChain = ikRootBone ? getIkChain(ikRootBone.id, bones) : null;
  const ikEnabled = ikRootBone ? ikChainRootIds.includes(ikRootBone.id) : false;

  const handleChange = (key: string, value: string | number | null) => {
    if (!selectedBone) return;
    captureSnapshot();
    updateBone(selectedBone.id, { [key]: value });
    if (mode === 'animate' && typeof value === 'number') {
      insertKeyframe(selectedBone.id, {
        x: selectedBone.x,
        y: selectedBone.y,
        rotation: selectedBone.rotation,
        scaleX: selectedBone.scaleX,
        scaleY: selectedBone.scaleY,
        [key]: value,
      });
    }
  };

  if (!selectedBone) {
    return (
      <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 panel-padding-left">
          ⚙️ Properties
        </div>
        <div className="p-4 text-[10px] text-text-dim panel-padding-left">
          Select a bone to edit its properties
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 panel-padding-left">
        ⚙️ Properties
      </div>
      
      <AttachmentPropertiesPanel />
      <div className="overflow-y-auto scrollbar-thin panel-padding-left">
        <PropRow label="Name">
          <input
            type="text"
            value={selectedBone.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="X">
          <input
            type="number"
            value={selectedBone.x.toFixed(1)}
            onChange={(e) => handleChange('x', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Y">
          <input
            type="number"
            value={selectedBone.y.toFixed(1)}
            onChange={(e) => handleChange('y', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Length">
          <input
            type="number"
            value={selectedBone.length.toFixed(1)}
            onChange={(e) => handleChange('length', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Rotation">
          <input
            type="number"
            value={selectedBone.rotation.toFixed(1)}
            onChange={(e) => handleChange('rotation', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Scale X">
          <input
            type="number"
            step="0.1"
            value={selectedBone.scaleX.toFixed(2)}
            onChange={(e) => handleChange('scaleX', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Scale Y">
          <input
            type="number"
            step="0.1"
            value={selectedBone.scaleY.toFixed(2)}
            onChange={(e) => handleChange('scaleY', parseFloat(e.target.value))}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          />
        </PropRow>

        <PropRow label="Parent">
          <select
            value={selectedBone.parentId ?? ''}
            onChange={(e) => {
              if (!selectedBone) return;
              const newParentId = e.target.value === '' ? null : parseInt(e.target.value);
              
              captureSnapshot();
              computeAllWorldTransforms(bones);

              const worldX = selectedBone._wx;
              const worldY = selectedBone._wy;
              const worldRot = selectedBone._wrot;

              let newX = worldX;
              let newY = worldY;
              let newRot = worldRot;

              if (newParentId !== null) {
                const newParent = bones.find((b) => b.id === newParentId);
                if (newParent) {
                  const cos = Math.cos((-newParent._wrot * Math.PI) / 180);
                  const sin = Math.sin((-newParent._wrot * Math.PI) / 180);
                  const dx = worldX - newParent._wx;
                  const dy = worldY - newParent._wy;
                  newX = (dx * cos - dy * sin) / newParent.scaleX;
                  newY = (dx * sin + dy * cos) / newParent.scaleY;
                  newRot = worldRot - newParent._wrot;
                }
              }

              updateBone(selectedBone.id, {
                parentId: newParentId,
                x: newX,
                y: newY,
                rotation: newRot,
              });
            }}
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] focus:outline-none focus:border-accent min-w-0"
          >
            <option value="">None</option>
            {bones
              .filter((b) => b.id !== selectedBone.id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </PropRow>

        {ikRootBone && ikChain ? (
          <PropRow label="2-Bone IK">
            <label className="flex items-center gap-2 text-[11px] text-text min-w-0">
              <input
                type="checkbox"
                checked={ikEnabled}
                onChange={() => {
                  captureSnapshot();
                  toggleIkChain(ikRootBone.id);
                }}
              />
              <span className="truncate">
                {ikChain.end
                  ? `Target on ${ikChain.root.name} -> ${ikChain.child.name} -> ${ikChain.end.name}`
                  : `Target on ${ikChain.root.name} -> ${ikChain.child.name}`}
              </span>
            </label>
          </PropRow>
        ) : null}
      </div>
    </div>
  );
};

const PropRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
    <span className="w-[60px] text-text-dim text-[10px] flex-shrink-0">{label}</span>
    {children}
  </div>
);

import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';

export const PropertiesPanel = () => {
  const { selectedBoneId, mode } = useEditorStore();
  const { bones, updateBone } = useSkeletonStore();
  const { insertKeyframe } = useAnimationStore();
  const { captureSnapshot } = useHistoryStore();

  const selectedBone = bones.find((b) => b.id === selectedBoneId);

  const handleChange = (key: string, value: string | number) => {
    if (!selectedBone) return;
    captureSnapshot();
    updateBone(selectedBone.id, { [key]: value });
    
    if (mode === 'animate') {
      insertKeyframe(selectedBone.id, {
        x: selectedBone.x,
        y: selectedBone.y,
        rotation: selectedBone.rotation,
        scaleX: selectedBone.scaleX,
        scaleY: selectedBone.scaleY,
        ...{ [key]: value },
      });
    }
  };

  if (!selectedBone) {
    return (
      <div className="flex flex-col overflow-hidden">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          ⚙ Properties
        </div>
        <div className="p-4 text-[10px] text-text-dim">
          Select a bone to edit its properties
        </div>
      </div>
    );
  }

  const parent = bones.find((b) => b.id === selectedBone.parentId);

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        ⚙ Properties
      </div>
      <div className="overflow-y-auto scrollbar-thin">
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
          <input
            type="text"
            value={parent?.name || 'none'}
            disabled
            className="flex-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-text text-[11px] opacity-50 min-w-0"
          />
        </PropRow>
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

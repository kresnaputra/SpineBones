import { useEditorStore } from '../../stores/editorStore';
import { useSlotStore } from '../../stores/slotStore';

export const AttachmentPropertiesPanel = () => {
  const { selectedBoneId } = useEditorStore();
  const { slots, attachments, updateAttachment } = useSlotStore();

  if (!selectedBoneId) {
    return (
      <div className="border-b border-border">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          🖼️ Attachment
        </div>
        <div className="p-3 text-[10px] text-text-dim">
          Select a bone with an active attachment
        </div>
      </div>
    );
  }

  const boneSlots = slots.filter((s) => s.boneId === selectedBoneId);
  const activeSlot = boneSlots.find((s) => s.attachmentName !== null);
  
  if (!activeSlot || !activeSlot.attachmentName) {
    return (
      <div className="border-b border-border">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          🖼️ Attachment
        </div>
        <div className="p-3 text-[10px] text-text-dim">
          No active attachment for this bone
        </div>
      </div>
    );
  }

  const attachment = attachments.find(
    (a) => a.slotId === activeSlot.id && a.name === activeSlot.attachmentName
  );

  if (!attachment) return null;

  const handleUpdate = (field: string, value: number) => {
    updateAttachment(activeSlot.id, activeSlot.attachmentName!, {
      [field]: value,
    });
  };

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        🖼️ Attachment: {attachment.name}
      </div>
      <div className="p-3 space-y-2">
        <div className="text-[9px] text-text-dim mb-2">
          Adjust offset to change rotation pivot
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-dim w-16">Offset X</label>
          <input
            type="number"
            value={attachment.x}
            onChange={(e) => handleUpdate('x', parseFloat(e.target.value) || 0)}
            className="flex-1 bg-panel2 border border-border rounded px-2 py-1 text-text text-[11px]"
            step="1"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-dim w-16">Offset Y</label>
          <input
            type="number"
            value={attachment.y}
            onChange={(e) => handleUpdate('y', parseFloat(e.target.value) || 0)}
            className="flex-1 bg-panel2 border border-border rounded px-2 py-1 text-text text-[11px]"
            step="1"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-dim w-16">Rotation</label>
          <input
            type="number"
            value={attachment.rotation}
            onChange={(e) => handleUpdate('rotation', parseFloat(e.target.value) || 0)}
            className="flex-1 bg-panel2 border border-border rounded px-2 py-1 text-text text-[11px]"
            step="1"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-dim w-16">Scale X</label>
          <input
            type="number"
            value={attachment.scaleX}
            onChange={(e) => handleUpdate('scaleX', parseFloat(e.target.value) || 1)}
            className="flex-1 bg-panel2 border border-border rounded px-2 py-1 text-text text-[11px]"
            step="0.1"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-dim w-16">Scale Y</label>
          <input
            type="number"
            value={attachment.scaleY}
            onChange={(e) => handleUpdate('scaleY', parseFloat(e.target.value) || 1)}
            className="flex-1 bg-panel2 border border-border rounded px-2 py-1 text-text text-[11px]"
            step="0.1"
          />
        </div>
      </div>
    </div>
  );
};

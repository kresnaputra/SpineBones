import { useEditorStore } from '../../stores/editorStore';
import { useSlotStore } from '../../stores/slotStore';

export const AttachmentPropertiesPanel = () => {
  const { selectedBoneId, attachmentDragEnabled, setAttachmentDragEnabled } = useEditorStore();
  const { slots, attachments, updateAttachment } = useSlotStore();

  if (selectedBoneId === null) {
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
          Attachment
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
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 flex items-center justify-between gap-2">
        <span>Attachment: {attachment.name}</span>
        <button
          type="button"
          onClick={() => setAttachmentDragEnabled(!attachmentDragEnabled)}
          className={`min-w-[88px] rounded-md border px-3 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm transition-all ${
            attachmentDragEnabled
              ? 'border-accent bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_0_14px_rgba(124,58,237,0.35)]'
              : 'border-border bg-panel text-text-dim hover:border-accent/60 hover:text-text'
          }`}
          title={attachmentDragEnabled ? 'Disable canvas drag for this attachment' : 'Enable canvas drag for this attachment'}
        >
          {attachmentDragEnabled ? 'Drag On' : 'Canvas Drag'}
        </button>
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

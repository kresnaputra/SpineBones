import { Upload, Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useSlotStore } from '../../stores/slotStore';

export const SlotListPanel = () => {
  const { selectedBoneId } = useEditorStore();
  const { bones } = useSkeletonStore();
  const { slots, addSlot, deleteSlot, addAttachment, setSlotAttachment, getAttachmentsBySlot } = useSlotStore();

  const selectedBone = bones.find((b) => b.id === selectedBoneId);
  const boneSlots = selectedBone ? slots.filter((s) => s.boneId === selectedBone.id) : [];

  const handleAddSlot = () => {
    if (!selectedBone) return;
    const slotName = prompt('Slot name:', `slot_${slots.length}`);
    if (slotName) {
      addSlot(selectedBone.id, slotName);
    }
  };

  const handleUploadImage = async (slotId: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target?.result as string;
        const img = new Image();
        
        img.onload = () => {
          const attachmentName = file.name.replace(/\.[^/.]+$/, '');
          addAttachment(slotId, {
            name: attachmentName,
            type: 'image',
            imagePath: file.name,
            imageData,
            width: img.width,
            height: img.height,
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          });
          setSlotAttachment(slotId, attachmentName);
        };
        
        img.src = imageData;
      };
      
      reader.readAsDataURL(file);
    };
    
    input.click();
  };

  if (!selectedBone) {
    return (
      <div className="flex flex-col overflow-hidden border-b border-border">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          📎 Slots
        </div>
        <div className="p-4 text-[10px] text-text-dim">
          Select a bone to manage its slots
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 flex items-center justify-between">
        <span>📎 Slots ({selectedBone.name})</span>
        <button
          onClick={handleAddSlot}
          className="p-0.5 rounded hover:bg-accent transition-colors"
          title="Add Slot"
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {boneSlots.length === 0 ? (
          <div className="p-3 text-[10px] text-text-dim">
            No slots. Click + to add one.
          </div>
        ) : (
          boneSlots.map((slot) => {
            const slotAttachments = getAttachmentsBySlot(slot.id);
            const activeAttachment = slotAttachments.find((a) => a.name === slot.attachmentName);

            return (
              <div key={slot.id} className="border-b border-border/40">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-panel2/50">
                  <div className="flex-1">
                    <div className="text-[11px] text-text font-medium">{slot.name}</div>
                    {activeAttachment && (
                      <div className="text-[9px] text-text-dim">
                        {activeAttachment.imagePath}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleUploadImage(slot.id)}
                    className="p-1 rounded hover:bg-accent hover:text-white transition-colors text-text-dim"
                    title="Upload Image"
                  >
                    <Upload size={12} />
                  </button>
                  <button
                    onClick={() => deleteSlot(slot.id)}
                    className="p-1 rounded hover:bg-red-500 hover:text-white transition-colors text-text-dim"
                    title="Delete Slot"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                
                {slotAttachments.length > 0 && (
                  <div className="px-3 py-1">
                    {slotAttachments.map((att) => (
                      <button
                        key={att.name}
                        onClick={() => setSlotAttachment(slot.id, att.name)}
                        className={`block w-full text-left px-2 py-1 text-[10px] rounded mb-0.5 transition-colors ${
                          slot.attachmentName === att.name
                            ? 'bg-accent text-white'
                            : 'text-text-dim hover:bg-panel2'
                        }`}
                      >
                        {att.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

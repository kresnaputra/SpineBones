import { Upload, Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useSlotStore } from '../../stores/slotStore';
import { useAnimationStore } from '../../stores/animationStore';
import { openImageFile } from '../../utils/nativeIO';
import { useHistoryStore } from '../../stores/historyStore';
import { getSlotAttachmentAtFrame } from '../../utils/slotAnimation';

const IMAGE_FILTERS = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
];

export const SlotListPanel = () => {
  const { selectedBoneId, mode } = useEditorStore();
  const { bones } = useSkeletonStore();
  const { slots, addSlot, deleteSlot, addAttachment, setSlotAttachment, getAttachmentsBySlot } = useSlotStore();
  const { frame, slotAttachmentKeyframes, insertSlotAttachmentKeyframe } = useAnimationStore();
  const { captureSnapshot } = useHistoryStore();

  const selectedBone = bones.find((b) => b.id === selectedBoneId);
  const boneSlots = selectedBone ? slots.filter((s) => s.boneId === selectedBone.id) : [];

  const handleAddSlot = () => {
    if (!selectedBone) return;
    if (boneSlots.length >= 1) return;
    captureSnapshot();
    addSlot(selectedBone.id, `${selectedBone.name}_slot_${boneSlots.length}`);
  };

  const handleUploadImage = async (slotId: number) => {
    try {
      const imageFile = await openImageFile({ filters: IMAGE_FILTERS });
      if (!imageFile) return;

      const img = new Image();
      img.onload = () => {
        const attachmentName = imageFile.name.replace(/\.[^/.]+$/, '');

        // Calculate scale to fit scene (target ~200px max dimension)
        const targetSize = 200;
        const maxDimension = Math.max(img.width, img.height);
        const scale = maxDimension > targetSize ? targetSize / maxDimension : 1;

        addAttachment(slotId, {
          name: attachmentName,
          type: 'image',
          imagePath: imageFile.path ?? imageFile.name,
          imageData: imageFile.dataUrl,
          width: img.width,
          height: img.height,
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: scale,
          scaleY: scale,
        });
        if (mode === 'animate') {
          insertSlotAttachmentKeyframe(slotId, attachmentName);
        } else {
          setSlotAttachment(slotId, attachmentName);
        }
      };
      img.onerror = () => {
        alert('Failed to decode image.');
      };
      img.src = imageFile.dataUrl;
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image. Check console for details.');
    }
  };

  if (!selectedBone) {
    return (
      <div className="flex flex-col overflow-hidden border-b border-border">
        <div className="panel-padding-left pr-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          📎 Slots
        </div>
        <div className="panel-padding-left pr-4 py-4 text-[10px] text-text-dim">
          Select a bone to manage its slots
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden border-b border-border">
      <div className="panel-padding-left pr-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 flex items-center justify-between">
        <span>📎 Slots ({selectedBone.name})</span>
        <button
          onClick={handleAddSlot}
          disabled={boneSlots.length >= 1}
          className="p-0.5 rounded hover:bg-accent transition-colors disabled:opacity-30 disabled:pointer-events-none"
          title={boneSlots.length >= 1 ? 'Only one slot per bone allowed' : 'Add Slot'}
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {boneSlots.length === 0 ? (
          <div className="panel-padding-left pr-3 py-3 text-[10px] text-text-dim">
            No slots. Click + to add one.
          </div>
        ) : (
          boneSlots.map((slot) => {
            const slotAttachments = getAttachmentsBySlot(slot.id);
            const activeAttachmentName =
              mode === 'animate'
                ? getSlotAttachmentAtFrame(slot.id, frame, slotAttachmentKeyframes, slot.attachmentName)
                : slot.attachmentName;
            const activeAttachment = slotAttachments.find((a) => a.name === activeAttachmentName);

            return (
              <div key={slot.id} className="border-b border-border/40">
                <div className="flex items-center gap-2 panel-padding-left pr-3 py-1.5 bg-panel2/50">
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
                  <div className="panel-padding-left pr-3 py-1">
                    {slotAttachments.map((att) => (
                      <button
                        key={att.name}
                        onClick={() => {
                          captureSnapshot();
                          if (mode === 'animate') {
                            insertSlotAttachmentKeyframe(slot.id, att.name);
                          } else {
                            setSlotAttachment(slot.id, att.name);
                          }
                        }}
                        className={`block w-full text-left px-2 py-1 text-[10px] rounded mb-0.5 transition-colors ${
                          activeAttachmentName === att.name
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

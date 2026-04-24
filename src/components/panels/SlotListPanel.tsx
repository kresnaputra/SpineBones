import { Upload, Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useSlotStore } from '../../stores/slotStore';
import { openImageFile } from '../../utils/nativeIO';
import { useHistoryStore } from '../../stores/historyStore';
import { getOpaqueBoundsFromImageData } from '../../utils/meshAttachment';
import { resolveSlotAttachmentAtFrame } from '../../utils/slotAnimation';

const IMAGE_FILTERS = [
  {
    name: 'Images',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
];

export const SlotListPanel = () => {
  const { selectedBoneId, selectedSlotId, selectSlot, mode } = useEditorStore();
  const { bones } = useSkeletonStore();
  const { frame, slotAttachmentKeyframes, setSlotAttachmentKeyframeAtFrame } = useAnimationStore();
  const { slots, addSlot, deleteSlot, addAttachment, setSlotAttachment, getAttachmentsBySlot } = useSlotStore();
  const { captureSnapshot } = useHistoryStore();

  const selectedBone = bones.find((b) => b.id === selectedBoneId);
  const boneSlots = selectedBone ? slots.filter((s) => s.boneId === selectedBone.id) : [];

  const handleAddSlot = () => {
    if (!selectedBone) return;
    captureSnapshot();
    const newSlot = addSlot(selectedBone.id, `${selectedBone.name}_slot_${boneSlots.length}`);
    selectSlot(newSlot.id);
  };

  const handleUploadImage = async (slotId: number) => {
    try {
      const imageFile = await openImageFile({ filters: IMAGE_FILTERS });
      if (!imageFile) return;

      const img = new Image();
      img.onload = async () => {
        const attachmentName = imageFile.name.replace(/\.[^/.]+$/, '');

        // Calculate scale to fit scene (target ~200px max dimension)
        const targetSize = 200;
        const maxDimension = Math.max(img.width, img.height);
        const scale = maxDimension > targetSize ? targetSize / maxDimension : 1;

        const opaqueBounds = await getOpaqueBoundsFromImageData(imageFile.dataUrl).catch(
          () => undefined,
        );

        addAttachment(slotId, {
          name: attachmentName,
          type: 'image',
          imagePath: imageFile.path ?? imageFile.name,
          imageData: imageFile.dataUrl,
          opaqueBounds,
          width: img.width,
          height: img.height,
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: scale,
          scaleY: scale,
        });
        if (mode === 'animate') {
          const existingFrames = Object.keys(
            slotAttachmentKeyframes[slotId] ?? {},
          ).map(Number);
          const slot = slots.find((item) => item.id === slotId);
          if (
            frame > 0 &&
            slot &&
            !existingFrames.some((keyframeFrame) => keyframeFrame < frame)
          ) {
            setSlotAttachmentKeyframeAtFrame(slotId, 0, slot.attachmentName);
          }
          setSlotAttachmentKeyframeAtFrame(slotId, frame, attachmentName);
        } else {
          setSlotAttachment(slotId, attachmentName);
        }
        selectSlot(slotId);
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
          className="p-0.5 rounded hover:bg-accent transition-colors"
          title="Add Slot Layer"
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="panel-padding-left pr-3 py-1.5 text-[9px] text-text-dim border-b border-border/60 bg-panel2/40">
        `+` adds a new slot layer. Use the upload button inside a slot to add more sprite attachments for swapping.
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
                ? resolveSlotAttachmentAtFrame(slot, frame, slotAttachmentKeyframes)
                : slot.attachmentName;
            const activeAttachment = slotAttachments.find((a) => a.name === activeAttachmentName);

            return (
              <div key={slot.id} className="border-b border-border/40">
                <div
                  className={`flex items-center gap-2 panel-padding-left pr-3 py-1.5 cursor-pointer transition-colors ${
                    selectedSlotId === slot.id ? 'bg-accent/15' : 'bg-panel2/50 hover:bg-panel2'
                  }`}
                  onClick={() => selectSlot(slot.id)}
                >
                  <div className="flex-1">
                    <div className="text-[11px] text-text font-medium">{slot.name}</div>
                    <div className="text-[9px] text-text-dim">
                      {slotAttachments.length} attachment{slotAttachments.length === 1 ? '' : 's'}
                    </div>
                    {activeAttachment && (
                      <div className="text-[9px] text-text-dim">
                        {activeAttachment.imagePath}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleUploadImage(slot.id);
                    }}
                    className="p-1 rounded hover:bg-accent hover:text-white transition-colors text-text-dim"
                    title="Add Attachment To This Slot"
                  >
                    <Upload size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSlot(slot.id);
                      if (selectedSlotId === slot.id) {
                        selectSlot(null);
                      }
                    }}
                    className="p-1 rounded hover:bg-red-500 hover:text-white transition-colors text-text-dim"
                    title="Delete Slot"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                
                {slotAttachments.length > 0 && (
                  <div className="panel-padding-left pr-3 py-1">
                    <div className="px-2 pb-1 text-[9px] text-text-dim">
                      Attachments in this slot. Select one to make it active.
                    </div>
                    {slotAttachments.map((att) => (
                      <button
                        key={att.name}
                        onClick={() => {
                          selectSlot(slot.id);
                          if (mode === 'animate') {
                            const existingFrames = Object.keys(
                              slotAttachmentKeyframes[slot.id] ?? {},
                            ).map(Number);
                            if (
                              frame > 0 &&
                              !existingFrames.some((keyframeFrame) => keyframeFrame < frame)
                            ) {
                              setSlotAttachmentKeyframeAtFrame(
                                slot.id,
                                0,
                                slot.attachmentName,
                              );
                            }
                            setSlotAttachmentKeyframeAtFrame(slot.id, frame, att.name);
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

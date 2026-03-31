import { useState } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useSkeletonStore } from "../../stores/skeletonStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useSlotStore } from "../../stores/slotStore";
import { useAnimationStore } from "../../stores/animationStore";

const DUPLICATE_OFFSET = 16;

const getUniqueName = (existingNames: string[], sourceName: string) => {
  const baseName = `${sourceName}_copy`;
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.includes(`${baseName}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}_${suffix}`;
};

export const BoneTreePanel = () => {
  const { bones, addBone, deleteBone, reorderBones } = useSkeletonStore();
  const { selectedBoneIds, selectBone, toggleBoneSelection } = useEditorStore();
  const { captureSnapshot } = useHistoryStore();
  const [draggedBoneId, setDraggedBoneId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; boneIds: number[] } | null>(null);

  const handleDragStart = (e: React.DragEvent, boneId: number) => {
    e.stopPropagation();
    setDraggedBoneId(boneId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(boneId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, dropBoneId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId =
      draggedBoneId ?? Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (Number.isNaN(draggedId)) {
      setDraggedBoneId(null);
      return;
    }

    const fromIndex = bones.findIndex((bone) => bone.id === draggedId);
    const toIndex = bones.findIndex((bone) => bone.id === dropBoneId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      setDraggedBoneId(null);
      return;
    }

    captureSnapshot();
    reorderBones(fromIndex, toIndex);
    setDraggedBoneId(null);
  };

  const handleDragEnd = () => {
    setDraggedBoneId(null);
  };

  const handleDuplicateBones = (boneIds: number[]) => {
    const sourceBones = bones.filter((bone) => boneIds.includes(bone.id));
    if (sourceBones.length === 0) return;

    const skeletonState = useSkeletonStore.getState();
    const slotState = useSlotStore.getState();
    const animationState = useAnimationStore.getState();
    const selectedSet = new Set(boneIds);
    const duplicatedBoneIds: number[] = [];
    const duplicatedBoneMap = new Map<number, number>();
    const existingBoneNames = [...bones.map((bone) => bone.name)];

    sourceBones.forEach((sourceBone) => {
      const nextBoneName = getUniqueName(existingBoneNames, sourceBone.name);
      existingBoneNames.push(nextBoneName);

      const duplicatedBone = addBone({
        name: nextBoneName,
        x: sourceBone.x + DUPLICATE_OFFSET,
        y: sourceBone.y + DUPLICATE_OFFSET,
        length: sourceBone.length,
        rotation: sourceBone.rotation,
        scaleX: sourceBone.scaleX,
        scaleY: sourceBone.scaleY,
        parentId: selectedSet.has(sourceBone.parentId ?? -1)
          ? duplicatedBoneMap.get(sourceBone.parentId ?? -1) ?? null
          : sourceBone.parentId,
        skinId: sourceBone.skinId,
        _wx: sourceBone._wx,
        _wy: sourceBone._wy,
        _wrot: sourceBone._wrot,
      });

      duplicatedBoneMap.set(sourceBone.id, duplicatedBone.id);
      duplicatedBoneIds.push(duplicatedBone.id);

      const sourceSetupPose = skeletonState.setupPose[sourceBone.id];
      useSkeletonStore.setState((state) => ({
        setupPose: {
          ...state.setupPose,
          [duplicatedBone.id]: sourceSetupPose
            ? {
                ...sourceSetupPose,
                x: sourceSetupPose.x + DUPLICATE_OFFSET,
                y: sourceSetupPose.y + DUPLICATE_OFFSET,
              }
            : {
                x: duplicatedBone.x,
                y: duplicatedBone.y,
                rotation: duplicatedBone.rotation,
                scaleX: duplicatedBone.scaleX,
                scaleY: duplicatedBone.scaleY,
              },
        },
      }));

      const sourceSlots = slotState.slots.filter((slot) => slot.boneId === sourceBone.id);
      sourceSlots.forEach((slot) => {
        const slotNames = useSlotStore.getState().slots.map((existingSlot) => existingSlot.name);
        const duplicatedSlot = useSlotStore.getState().addSlot(
          duplicatedBone.id,
          getUniqueName(slotNames, slot.name),
        );

        useSlotStore.getState().updateSlot(duplicatedSlot.id, {
          color: slot.color,
        });

        const sourceAttachments = slotState.attachments.filter((attachment) => attachment.slotId === slot.id);
        sourceAttachments.forEach((attachment) => {
          useSlotStore.getState().addAttachment(duplicatedSlot.id, {
            ...attachment,
            name: attachment.name,
          });
        });

        useSlotStore.getState().setSlotAttachment(duplicatedSlot.id, slot.attachmentName);
      });

      const sourceKeyframes = animationState.keyframes[sourceBone.id];
      if (sourceKeyframes) {
        const duplicatedKeyframes = Object.fromEntries(
          Object.entries(sourceKeyframes).map(([frame, keyframe]) => [
            Number(frame),
            {
              ...keyframe,
              x: keyframe.x + DUPLICATE_OFFSET,
              y: keyframe.y + DUPLICATE_OFFSET,
            },
          ]),
        );

        useAnimationStore.setState((state) => ({
          keyframes: {
            ...state.keyframes,
            [duplicatedBone.id]: duplicatedKeyframes,
          },
        }));
      }
    });

    const nextPrimaryBoneId = duplicatedBoneIds[duplicatedBoneIds.length - 1] ?? null;
    useEditorStore.setState({
      selectedBoneId: nextPrimaryBoneId,
      selectedBoneIds: duplicatedBoneIds,
    });
    setContextMenu(null);
  };

  const handleRemoveBones = (boneIds: number[]) => {
    const selectedSet = new Set(boneIds);
    const rootBoneIds = boneIds.filter((boneId) => {
      const bone = bones.find((item) => item.id === boneId);
      return !selectedSet.has(bone?.parentId ?? -1);
    });

    rootBoneIds.forEach((boneId) => {
      deleteBone(boneId);
    });

    if (boneIds.some((boneId) => selectedBoneIds.includes(boneId))) {
      selectBone(null);
    }
    setContextMenu(null);
  };

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden border-b border-border"
      onClick={() => setContextMenu(null)}
    >
      <div className="panel-padding-left pr-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        🦴 Bones
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
        {bones.map((bone) => (
          <div
            key={bone.id}
            draggable
            onDragStart={(e) => handleDragStart(e, bone.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, bone.id)}
            onDragEnd={handleDragEnd}
            onClick={(e) => {
              if (e.shiftKey) {
                toggleBoneSelection(bone.id);
                return;
              }
              selectBone(bone.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const targetBoneIds = selectedBoneIds.includes(bone.id)
                ? selectedBoneIds
                : [bone.id];

              if (!selectedBoneIds.includes(bone.id)) {
                selectBone(bone.id);
              }

              setContextMenu({ x: e.clientX, y: e.clientY, boneIds: targetBoneIds });
            }}
            className={`flex items-center gap-1.5 panel-padding-left pr-3 py-1 cursor-move transition-colors group select-none ${
              selectedBoneIds.includes(bone.id) ? "bg-accent/20" : "hover:bg-panel2"
            } ${draggedBoneId === bone.id ? "opacity-50" : ""}`}
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                selectedBoneIds.includes(bone.id) ? "bg-bone-sel" : "bg-bone-col"
              }`}
            />
            <span className="flex-1 text-text text-[11px]">{bone.name}</span>
            <button
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                captureSnapshot();
                handleRemoveBones([bone.id]);
              }}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-400 px-0.5"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {contextMenu && (
        <div
          className="fixed bg-panel2 border border-border rounded-md shadow-lg py-1 z-50 min-w-[128px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              captureSnapshot();
              handleDuplicateBones(contextMenu.boneIds);
            }}
            className="w-full px-4 py-1.5 text-left text-[11px] text-text hover:bg-accent hover:text-white transition-colors"
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              captureSnapshot();
              handleRemoveBones(contextMenu.boneIds);
            }}
            className="w-full px-4 py-1.5 text-left text-[11px] text-red-400 hover:bg-red-500 hover:text-white transition-colors"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

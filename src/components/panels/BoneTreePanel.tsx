import { useState } from "react";
import { useAnimationStore } from "../../stores/animationStore";
import { useEditorStore } from "../../stores/editorStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useSkeletonStore } from "../../stores/skeletonStore";
import { useSlotStore } from "../../stores/slotStore";

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
  const {
    bones,
    boneGroups,
    addBone,
    addBoneGroup,
    assignBoneToGroup,
    deleteBone,
    deleteBoneGroup,
    renameBoneGroup,
    reorderBones,
  } = useSkeletonStore();
  const { selectedBoneIds, selectBone, toggleBoneSelection } = useEditorStore();
  const { captureSnapshot } = useHistoryStore();
  const [draggedBoneIds, setDraggedBoneIds] = useState<number[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);
  const [isUngroupedDropActive, setIsUngroupedDropActive] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<number[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; boneIds: number[] } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  const getGroupIdForBone = (boneId: number) =>
    boneGroups.find((group) => group.boneIds.includes(boneId))?.id ?? null;

  const ungroupedBones = bones.filter((bone) => getGroupIdForBone(bone.id) === null);

  const handleDragStart = (e: React.DragEvent, boneId: number) => {
    e.stopPropagation();
    const nextDraggedBoneIds = selectedBoneIds.includes(boneId) ? selectedBoneIds : [boneId];
    setDraggedBoneIds(nextDraggedBoneIds);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(nextDraggedBoneIds));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, dropBoneId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedIds = draggedBoneIds.length > 0
      ? draggedBoneIds
      : JSON.parse(e.dataTransfer.getData("text/plain") || "[]");
    const draggedId = Array.isArray(droppedIds) ? droppedIds[0] : null;
    if (typeof draggedId !== "number") {
      setDraggedBoneIds([]);
      return;
    }

    const fromIndex = bones.findIndex((bone) => bone.id === draggedId);
    const toIndex = bones.findIndex((bone) => bone.id === dropBoneId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      setDraggedBoneIds([]);
      return;
    }

    captureSnapshot();
    reorderBones(fromIndex, toIndex);
    setDraggedBoneIds([]);
  };

  const handleDragEnd = () => {
    setDraggedBoneIds([]);
    setDragOverGroupId(null);
    setIsUngroupedDropActive(false);
  };

  const handleAssignBonesToGroup = (boneIds: number[], groupId: number | null) => {
    if (boneIds.length === 0) return;
    captureSnapshot();
    boneIds.forEach((boneId) => assignBoneToGroup(boneId, groupId));
    setDragOverGroupId(null);
    setIsUngroupedDropActive(false);
  };

  const handleCreateGroup = () => {
    captureSnapshot();
    const group = addBoneGroup(`Group ${boneGroups.length + 1}`);
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const startEditingGroup = (groupId: number, currentName: string) => {
    setEditingGroupId(groupId);
    setEditingGroupName(currentName);
  };

  const commitGroupRename = (groupId: number) => {
    const nextName = editingGroupName.trim();
    setEditingGroupId(null);
    if (!nextName) return;
    const currentGroup = boneGroups.find((group) => group.id === groupId);
    if (!currentGroup || currentGroup.name === nextName) return;
    captureSnapshot();
    renameBoneGroup(groupId, nextName);
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

      const sourceGroupId = getGroupIdForBone(sourceBone.id);
      if (sourceGroupId !== null) {
        assignBoneToGroup(duplicatedBone.id, sourceGroupId);
      }

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

  const renderBoneRow = (boneId: number, nested = false): React.ReactNode => {
    const bone = bones.find((item) => item.id === boneId);
    if (!bone) return null;

    return (
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
        className={`flex items-center gap-1.5 pr-3 py-1 cursor-move transition-colors group select-none ${
          selectedBoneIds.includes(bone.id) ? "bg-accent/20" : "hover:bg-panel2"
          } ${draggedBoneIds.includes(bone.id) ? "opacity-50" : ""}`}
        style={{ paddingLeft: nested ? 28 : 12 }}
      >
        <div className="w-3 flex-shrink-0" />
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            selectedBoneIds.includes(bone.id) ? "bg-bone-sel" : "bg-bone-col"
          }`}
        />
        <span className="flex-1 text-text text-[11px] truncate">{bone.name}</span>
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
    );
  };

  const renderGroup = (groupId: number): React.ReactNode => {
    const group = boneGroups.find((item) => item.id === groupId);
    if (!group) return null;

    const hasSelectedBone = group.boneIds.some((boneId) => selectedBoneIds.includes(boneId));
    const collapsed = collapsedGroupIds.includes(group.id) && !hasSelectedBone;
    const groupedBones = group.boneIds
      .map((boneId) => bones.find((bone) => bone.id === boneId))
      .filter((bone): bone is (typeof bones)[number] => bone !== undefined);

    return (
      <div key={group.id} className="mb-1">
        <div
          onDragOver={(e) => {
            handleDragOver(e);
            setDragOverGroupId(group.id);
          }}
          onDragLeave={() => {
            if (dragOverGroupId === group.id) setDragOverGroupId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const droppedIds = draggedBoneIds.length > 0
              ? draggedBoneIds
              : JSON.parse(e.dataTransfer.getData("text/plain") || "[]");
            if (Array.isArray(droppedIds) && droppedIds.every((id) => typeof id === "number")) {
              handleAssignBonesToGroup(droppedIds, group.id);
            }
            setDraggedBoneIds([]);
          }}
          className={`flex items-center gap-1.5 pr-3 py-1.5 mx-1 rounded-md border transition-colors ${
            dragOverGroupId === group.id
              ? "border-accent bg-accent/15"
              : "border-border/60 bg-panel2/60"
          }`}
          style={{ paddingLeft: 8 }}
        >
          <button
            type="button"
            onClick={() =>
              setCollapsedGroupIds((current) =>
                current.includes(group.id)
                  ? current.filter((id) => id !== group.id)
                  : [...current, group.id],
              )
            }
            className="w-3 text-[9px] flex-shrink-0 text-text-dim hover:text-text"
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <div className="w-2 h-2 rounded-sm bg-sky-400/80 flex-shrink-0" />
          {editingGroupId === group.id ? (
            <input
              autoFocus
              value={editingGroupName}
              onChange={(e) => setEditingGroupName(e.target.value)}
              onBlur={() => commitGroupRename(group.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitGroupRename(group.id);
                }
                if (e.key === "Escape") {
                  setEditingGroupId(null);
                }
              }}
              className="flex-1 bg-panel border border-accent rounded px-1 py-0.5 text-text text-[11px] min-w-0"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => startEditingGroup(group.id, group.name)}
              className="flex-1 text-left text-text text-[11px] font-medium truncate"
              title="Double-click to rename"
            >
              {group.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              captureSnapshot();
              deleteBoneGroup(group.id);
            }}
            className="text-[10px] text-red-500 hover:text-red-400 px-0.5"
          >
            ✕
          </button>
        </div>
        {!collapsed ? groupedBones.map((bone) => renderBoneRow(bone.id, true)) : null}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden border-b border-border"
      onClick={() => setContextMenu(null)}
    >
      <div className="panel-padding-left pr-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2 flex items-center gap-2">
        <span className="flex-1">🦴 Bones</span>
        <button
          type="button"
          onClick={handleCreateGroup}
          className="text-[10px] text-accent hover:text-white transition-colors"
        >
          + Group
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
        <div
          onDragOver={(e) => {
            handleDragOver(e);
            setIsUngroupedDropActive(true);
          }}
          onDragLeave={() => setIsUngroupedDropActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const droppedIds = draggedBoneIds.length > 0
              ? draggedBoneIds
              : JSON.parse(e.dataTransfer.getData("text/plain") || "[]");
            if (Array.isArray(droppedIds) && droppedIds.every((id) => typeof id === "number")) {
              handleAssignBonesToGroup(droppedIds, null);
            }
            setDraggedBoneIds([]);
          }}
          className={`mx-1 mb-2 rounded-md border px-2 py-1 ${
            isUngroupedDropActive ? "border-accent bg-accent/10" : "border-border/50 bg-panel2/30"
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-dim mb-1">
            Ungrouped
          </div>
          {ungroupedBones.length === 0 ? (
            <div className="px-1 py-1 text-[10px] text-text-dim">Drop bones here</div>
          ) : (
            ungroupedBones.map((bone) => renderBoneRow(bone.id))
          )}
        </div>

        {boneGroups.map((group) => renderGroup(group.id))}
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

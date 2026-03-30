import { useState } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useSkeletonStore } from "../../stores/skeletonStore";
import { useHistoryStore } from "../../stores/historyStore";

export const BoneTreePanel = () => {
  const { bones, deleteBone, reorderBones } = useSkeletonStore();
  const { selectedBoneId, selectBone } = useEditorStore();
  const { captureSnapshot } = useHistoryStore();
  const [draggedBoneId, setDraggedBoneId] = useState<number | null>(null);

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden border-b border-border">
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
            onClick={() => selectBone(bone.id)}
            className={`flex items-center gap-1.5 panel-padding-left pr-3 py-1 cursor-move transition-colors group select-none ${
              selectedBoneId === bone.id ? "bg-accent/20" : "hover:bg-panel2"
            } ${draggedBoneId === bone.id ? "opacity-50" : ""}`}
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                selectedBoneId === bone.id ? "bg-bone-sel" : "bg-bone-col"
              }`}
            />
            <span className="flex-1 text-text text-[11px]">{bone.name}</span>
            <button
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                captureSnapshot();
                deleteBone(bone.id);
                if (selectedBoneId === bone.id) selectBone(null);
              }}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-400 px-0.5"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

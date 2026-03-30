import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useHistoryStore } from '../../stores/historyStore';

export const BoneTreePanel = () => {
  const { bones, deleteBone, reorderBones } = useSkeletonStore();
  const { selectedBoneId, selectBone } = useEditorStore();
  const { captureSnapshot } = useHistoryStore();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    
    captureSnapshot();
    reorderBones(draggedIndex, dropIndex);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        🦴 Bones
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
        {bones.map((bone, index) => (
          <div
            key={bone.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => selectBone(bone.id)}
            className={`flex items-center gap-1.5 px-3 py-1 cursor-move transition-colors group ${
              selectedBoneId === bone.id ? 'bg-accent/20' : 'hover:bg-panel2'
            } ${draggedIndex === index ? 'opacity-50' : ''}`}
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                selectedBoneId === bone.id ? 'bg-bone-sel' : 'bg-bone-col'
              }`}
            />
            <span className="flex-1 text-text text-[11px]">{bone.name}</span>
            <button
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

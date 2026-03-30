import { useEditorStore } from '../../stores/editorStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useHistoryStore } from '../../stores/historyStore';

export const BoneTreePanel = () => {
  const { bones, deleteBone } = useSkeletonStore();
  const { selectedBoneId, selectBone } = useEditorStore();
  const { captureSnapshot } = useHistoryStore();

  return (
    <div className="flex flex-col flex-1 overflow-hidden border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        🦴 Bones
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
        {bones.map((bone) => (
          <div
            key={bone.id}
            onClick={() => selectBone(bone.id)}
            className={`flex items-center gap-1.5 px-3 py-1 cursor-pointer transition-colors group ${
              selectedBoneId === bone.id ? 'bg-accent/20' : 'hover:bg-panel2'
            }`}
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

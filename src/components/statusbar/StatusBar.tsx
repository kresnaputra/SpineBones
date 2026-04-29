import { useEditorStore } from "../../stores/editorStore";
import { getFileNameFromPath } from "../../utils/nativeIO";

export const StatusBar = () => {
  const { currentProjectPath } = useEditorStore();

  return (
    <div className="h-5.5 bg-accent flex items-center px-3 gap-4 text-[10px] text-white/80 shrink-0">
      <span>SpineBones v0.1.7</span>
      <span>|</span>
      <span>
        <strong className="text-white">Project:</strong>{" "}
        {currentProjectPath
          ? getFileNameFromPath(currentProjectPath)
          : "Untitled"}
      </span>
    </div>
  );
};

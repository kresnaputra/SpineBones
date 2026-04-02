import { useEditorStore } from "../../stores/editorStore";
import { getFileNameFromPath } from "../../utils/nativeIO";

export const StatusBar = () => {
  const { currentProjectPath } = useEditorStore();

  return (
    <div className="h-[22px] bg-accent flex items-center px-3 gap-4 text-[10px] text-white/80 flex-shrink-0">
      <span>SpineBones v0.1.1</span>
      <span>|</span>
      <span>
        <strong className="text-white">Project:</strong>{" "}
        {currentProjectPath
          ? getFileNameFromPath(currentProjectPath)
          : "Untitled"}
      </span>

      <span>|</span>
      <span>
        <strong className="text-white">RMB</strong> pan / parent in setup
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">Scroll</strong> zoom
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">Del</strong> delete
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">K</strong> keyframe
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">C</strong> toggle IK
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">D</strong> canvas drag
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">O</strong> onion skin
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">Space</strong> play/pause
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">W/E</strong> setup/animate
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">Q/B/M/R/S</strong> tools
      </span>
    </div>
  );
};

import { useEditorStore } from '../../stores/editorStore';
import { getFileNameFromPath, isDesktopApp, openPathWithDefaultApp } from '../../utils/nativeIO';

export const StatusBar = () => {
  const { currentProjectPath } = useEditorStore();

  return (
    <div className="h-[22px] bg-accent flex items-center px-3 gap-4 text-[10px] text-white/80 flex-shrink-0">
      <span>SpineBones v1.0</span>
      <span>|</span>
      <span>
        <strong className="text-white">Project:</strong>{' '}
        {currentProjectPath ? getFileNameFromPath(currentProjectPath) : 'Untitled'}
      </span>
      {isDesktopApp() && currentProjectPath ? (
        <>
          <span>|</span>
          <button
            type="button"
            onClick={() => void openPathWithDefaultApp(currentProjectPath)}
            className="hover:text-white transition-colors"
            title={currentProjectPath}
          >
            Open File
          </button>
        </>
      ) : null}
      <span>|</span>
      <span>
        <strong className="text-white">Bone tool:</strong> click to create
      </span>
      <span>|</span>
      <span>
        <strong className="text-white">RMB</strong> pan
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

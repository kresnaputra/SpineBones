export const StatusBar = () => {
  return (
    <div className="h-[22px] bg-accent flex items-center px-3 gap-4 text-[10px] text-white/80 flex-shrink-0">
      <span>SpineWeb v1.0</span>
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
        <strong className="text-white">b/q/m/r/s</strong> tools
      </span>
    </div>
  );
};

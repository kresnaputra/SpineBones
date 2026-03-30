export const StatusBar = () => {
  return (
    <div className="h-[22px] bg-accent flex items-center px-3 gap-4 text-[10px] text-white/80 flex-shrink-0">
      <span>SpineWeb v1.0</span>
      <span>|</span>
      <span>
        <strong className="text-white">Bone tool:</strong> click & drag to create
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
        <strong className="text-white">B/Q/G/R/S</strong> tools
      </span>
    </div>
  );
};

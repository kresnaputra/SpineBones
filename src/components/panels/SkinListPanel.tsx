import { useSkeletonStore } from '../../stores/skeletonStore';

export const SkinListPanel = () => {
  const { skins, activeSkinId, setActiveSkin } = useSkeletonStore();

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="panel-padding-left pr-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        🎨 Skins
      </div>
      <div className="overflow-y-auto scrollbar-thin">
        {skins.map((skin) => (
          <div
            key={skin.id}
            onClick={() => setActiveSkin(skin.id)}
            className={`flex items-center gap-1.5 panel-padding-left pr-3 py-1 cursor-pointer text-[11px] border-b border-border/40 transition-colors ${
              activeSkinId === skin.id ? 'text-accent2' : 'text-text hover:bg-panel2'
            }`}
          >
            <div
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: skin.color }}
            />
            {skin.name}
          </div>
        ))}
      </div>
    </div>
  );
};

import { useEditorStore } from '../../stores/editorStore';
import { usePhysicsStore } from '../../stores/physicsStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import { useAnimationStore } from '../../stores/animationStore';
import { useHistoryStore } from '../../stores/historyStore';
import { computeAllWorldTransforms } from '../../engine/transforms';
import { stepPhysics } from '../../engine/physics';

const DEFAULT_STIFFNESS = 20;
const DEFAULT_DAMPING = 4;
const DEFAULT_GRAVITY = 150;

export const PhysicsPanel = () => {
  const { selectedBoneId } = useEditorStore();
  const { bones } = useSkeletonStore();
  const { configs, addConfig, updateConfig, removeConfig } = usePhysicsStore();
  const { captureSnapshot } = useHistoryStore();

  if (selectedBoneId === null) return null;

  const config = configs.find((c) => c.boneId === selectedBoneId);

  const handleEnable = () => {
    captureSnapshot();
    addConfig({
      boneId: selectedBoneId,
      stiffness: DEFAULT_STIFFNESS,
      damping: DEFAULT_DAMPING,
      gravity: DEFAULT_GRAVITY,
    });
  };

  const handleRemove = () => {
    captureSnapshot();
    removeConfig(selectedBoneId);
  };

  const handleBake = () => {
    if (!config) return;
    const { duration, fps, frame: currentFrame, setFrame, applyKeyframes, insertKeyframe } =
      useAnimationStore.getState();
    captureSnapshot();

    // Simulate forward from frame 0
    computeAllWorldTransforms(bones);
    const bone = bones.find((b) => b.id === selectedBoneId);
    if (!bone) return;

    const dtPerFrame = 1 / fps;
    let rt = { vx: 0, vy: 0, wx: bone._wx, wy: bone._wy };

    for (let f = 0; f <= duration; f++) {
      setFrame(f);
      applyKeyframes();
      computeAllWorldTransforms(bones);
      const b = bones.find((bx) => bx.id === selectedBoneId);
      if (!b) continue;
      rt = stepPhysics(rt, b._wx, b._wy, config, dtPerFrame);

      // Back-convert world position to local
      const parent = bones.find((bx) => bx.id === b.parentId);
      let localX = rt.wx;
      let localY = rt.wy;
      if (parent) {
        const r = (parent._wrot * Math.PI) / 180;
        const cos = Math.cos(-r);
        const sin = Math.sin(-r);
        const dx = rt.wx - parent._wx;
        const dy = rt.wy - parent._wy;
        localX = (dx * cos - dy * sin) / (parent.scaleX || 1);
        localY = (dx * sin + dy * cos) / (parent.scaleY || 1);
      }

      insertKeyframe(selectedBoneId, {
        x: localX,
        y: localY,
        rotation: b.rotation,
        scaleX: b.scaleX,
        scaleY: b.scaleY,
      });
    }

    // Restore original frame
    setFrame(currentFrame);
    applyKeyframes();
  };

  if (!config) {
    return (
      <div className="border-b border-border">
        <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
          Physics
        </div>
        <div className="px-3 py-2 border-b border-border/50">
          <div className="text-[9px] text-text-dim mb-1.5">
            Spring-damper wiggle for {bones.find((b) => b.id === selectedBoneId)?.name ?? 'this bone'}.
          </div>
          <button
            onClick={handleEnable}
            className="w-full px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
          >
            Enable Physics
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 text-[10px] font-bold text-text-dim uppercase tracking-wider border-b border-border bg-panel2">
        Physics
        <span className="ml-2 font-normal normal-case text-accent">active</span>
      </div>

      <div className="px-3 py-2 border-b border-border/50 space-y-2">
        <div>
          <div className="flex justify-between text-[9px] text-text-dim mb-0.5">
            <span>Stiffness</span>
            <span>{config.stiffness.toFixed(0)}</span>
          </div>
          <input
            type="range" min="1" max="100" step="1"
            value={config.stiffness}
            onChange={(e) => updateConfig(selectedBoneId, { stiffness: parseFloat(e.target.value) })}
            className="w-full h-1 accent-accent"
          />
        </div>
        <div>
          <div className="flex justify-between text-[9px] text-text-dim mb-0.5">
            <span>Damping</span>
            <span>{config.damping.toFixed(1)}</span>
          </div>
          <input
            type="range" min="0.5" max="20" step="0.5"
            value={config.damping}
            onChange={(e) => updateConfig(selectedBoneId, { damping: parseFloat(e.target.value) })}
            className="w-full h-1 accent-accent"
          />
        </div>
        <div>
          <div className="flex justify-between text-[9px] text-text-dim mb-0.5">
            <span>Gravity</span>
            <span>{config.gravity.toFixed(0)}</span>
          </div>
          <input
            type="range" min="0" max="500" step="10"
            value={config.gravity}
            onChange={(e) => updateConfig(selectedBoneId, { gravity: parseFloat(e.target.value) })}
            className="w-full h-1 accent-accent"
          />
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/50 flex gap-1.5">
        <button
          onClick={handleBake}
          className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-accent/60 hover:text-text transition-all"
          title="Simulate physics and write keyframes"
        >
          Bake to Keys
        </button>
        <button
          onClick={handleRemove}
          className="flex-1 px-2 py-1 text-[10px] rounded border border-border bg-panel2 text-text-dim hover:border-red-500/60 hover:text-red-400 transition-all"
        >
          Remove
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border/50 space-y-0.5">
        <div className="text-[9px] text-text-dim flex gap-1.5">
          <span className="text-text-dim/60">◈</span>
          <span>Stiffness — how fast it snaps back</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5">
          <span className="text-text-dim/60">◈</span>
          <span>Damping — how fast oscillation settles</span>
        </div>
        <div className="text-[9px] text-text-dim flex gap-1.5">
          <span className="text-text-dim/60">◈</span>
          <span>Physics runs in Animate mode only</span>
        </div>
      </div>
    </div>
  );
};

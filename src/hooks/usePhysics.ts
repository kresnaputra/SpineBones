import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { usePhysicsStore } from '../stores/physicsStore';
import { useSkeletonStore } from '../stores/skeletonStore';
import { computeAllWorldTransforms } from '../engine/transforms';
import { stepPhysics } from '../engine/physics';

/**
 * Runs a spring-physics RAF loop for all configured physics bones.
 * Active only in 'animate' mode. Physics offsets are written to physicsStore
 * and applied to bone._wx/_wy during MainCanvas rendering.
 *
 * Call this once at the top of a component that is always mounted (e.g. MainCanvas).
 */
export const usePhysics = () => {
  const mode = useEditorStore((s) => s.mode);
  const configs = usePhysicsStore((s) => s.configs);

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (configs.length === 0 || mode !== 'animate') {
      usePhysicsStore.getState().clearOffsets();
      return;
    }

    lastTimeRef.current = 0;

    const tick = (now: number) => {
      const dt = lastTimeRef.current > 0
        ? Math.min((now - lastTimeRef.current) / 1000, 0.05)
        : 0;
      lastTimeRef.current = now;

      if (dt > 0) {
        const { configs: cfgs, runtimes } = usePhysicsStore.getState();
        const bones = useSkeletonStore.getState().bones;
        computeAllWorldTransforms(bones);

        const nextRuntimes = { ...runtimes };
        for (const cfg of cfgs) {
          const bone = bones.find((b) => b.id === cfg.boneId);
          if (!bone) continue;
          const rt = nextRuntimes[cfg.boneId] ?? {
            vx: 0, vy: 0, wx: bone._wx, wy: bone._wy,
          };
          const newRt = stepPhysics(rt, bone._wx, bone._wy, cfg, dt);
          nextRuntimes[cfg.boneId] = newRt;
          usePhysicsStore.getState().setOffset(
            cfg.boneId,
            newRt.wx - bone._wx,
            newRt.wy - bone._wy,
          );
        }
        usePhysicsStore.setState({ runtimes: nextRuntimes });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTimeRef.current = 0;
      usePhysicsStore.getState().clearOffsets();
    };
  }, [mode, configs.length]);
};

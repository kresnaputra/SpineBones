import type { PhysicsConfig } from '../types';

export interface PhysicsRuntime {
  vx: number;
  vy: number;
  wx: number;
  wy: number;
}

/**
 * Advance physics state one dt-second step.
 * Returns next PhysicsRuntime with updated velocity and position.
 *
 * Model: spring force toward target + exponential damping + gravity.
 *   force_x = stiffness * (target_x - current_x)
 *   force_y = stiffness * (target_y - current_y) + gravity
 *   velocity = (velocity + force * dt) * exp(-damping * dt)
 *   position += velocity * dt
 */
export const stepPhysics = (
  rt: PhysicsRuntime,
  targetWx: number,
  targetWy: number,
  config: PhysicsConfig,
  dt: number,
): PhysicsRuntime => {
  const springX = (targetWx - rt.wx) * config.stiffness;
  const springY = (targetWy - rt.wy) * config.stiffness + config.gravity;
  const dampFactor = Math.exp(-config.damping * dt);
  const nvx = (rt.vx + springX * dt) * dampFactor;
  const nvy = (rt.vy + springY * dt) * dampFactor;
  return {
    vx: nvx,
    vy: nvy,
    wx: rt.wx + nvx * dt,
    wy: rt.wy + nvy * dt,
  };
};

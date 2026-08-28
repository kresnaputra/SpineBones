import { create } from 'zustand';
import type { Point } from '../types';

/**
 * Pitch is clamped short of 90 degrees. At exactly edge-on the layer depth term
 * of the painter's sort is multiplied by cos(90) = 0, so stacked parts collapse
 * into ties and the rig loses its layering entirely — see `drawOrder`.
 */
export const MAX_PITCH = 85;

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  /** Orbit about the pan focus, in degrees. Both 0 renders exactly as 2D did. */
  yaw: number;
  pitch: number;
  canvasWidth: number;
  canvasHeight: number;
  setCanvasSize: (width: number, height: number) => void;
  pan: (dx: number, dy: number) => void;
  zoomBy: (factor: number) => void;
  orbit: (dYaw: number, dPitch: number) => void;
  resetOrbit: () => void;
  worldToScreen: (wx: number, wy: number) => Point;
  screenToWorld: (sx: number, sy: number) => Point;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  x: 0,
  y: 0,
  zoom: 1,
  yaw: 0,
  pitch: 0,
  canvasWidth: 800,
  canvasHeight: 600,

  setCanvasSize: (width, height) => set({ canvasWidth: width, canvasHeight: height }),

  pan: (dx, dy) => {
    const { zoom } = get();
    set((state) => ({
      x: state.x - dx / zoom,
      y: state.y - dy / zoom,
    }));
  },

  zoomBy: (factor) => {
    set((state) => ({
      zoom: Math.max(0.1, Math.min(10, state.zoom * factor)),
    }));
  },

  orbit: (dYaw, dPitch) => {
    set((state) => {
      // Wrap yaw into (-180, 180] so the number stays readable however far the
      // user drags; the projection itself is periodic and does not care.
      let yaw = (state.yaw + dYaw) % 360;
      if (yaw > 180) yaw -= 360;
      if (yaw <= -180) yaw += 360;
      return {
        yaw,
        pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch + dPitch)),
      };
    });
  },

  resetOrbit: () => set({ yaw: 0, pitch: 0 }),

  worldToScreen: (wx, wy) => {
    const { x, y, zoom, canvasWidth, canvasHeight } = get();
    return {
      x: (wx - x) * zoom + canvasWidth / 2,
      y: (wy - y) * zoom + canvasHeight / 2,
    };
  },

  screenToWorld: (sx, sy) => {
    const { x, y, zoom, canvasWidth, canvasHeight } = get();
    return {
      x: (sx - canvasWidth / 2) / zoom + x,
      y: (sy - canvasHeight / 2) / zoom + y,
    };
  },
}));

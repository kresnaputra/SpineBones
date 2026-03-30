import { create } from 'zustand';
import type { Point } from '../types';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  setCanvasSize: (width: number, height: number) => void;
  pan: (dx: number, dy: number) => void;
  zoomBy: (factor: number) => void;
  worldToScreen: (wx: number, wy: number) => Point;
  screenToWorld: (sx: number, sy: number) => Point;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  x: 0,
  y: 0,
  zoom: 1,
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

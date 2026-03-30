export type Tool = 'pose' | 'bone' | 'move' | 'rotate' | 'scale';
export type Mode = 'setup' | 'animate';

export interface Bone {
  id: number;
  name: string;
  x: number;
  y: number;
  length: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  parentId: number | null;
  skinId: number;
  _wx: number;
  _wy: number;
  _wrot: number;
}

export interface Skin {
  id: number;
  name: string;
  color: string;
}

export interface KeyframeData {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type Keyframes = Record<number, Record<number, KeyframeData>>;

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

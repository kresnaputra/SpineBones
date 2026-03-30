export type Tool = 'pose' | 'bone' | 'move' | 'rotate' | 'scale';
export type Mode = 'setup' | 'animate';

export type SetupPose = Record<
  number,
  { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
>;

export interface Slot {
  id: number;
  name: string;
  boneId: number;
  color: string;
  attachmentName: string | null;
  drawOrder: number;
}

export interface Attachment {
  name: string;
  slotId: number;
  type: 'image' | 'mesh';
  imagePath: string;
  imageData?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

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

export interface ProjectData {
  version: string;
  bones: Bone[];
  skins: Skin[];
  activeSkinId?: number;
  setupPose?: SetupPose;
  slots: Slot[];
  attachments: Attachment[];
  keyframes: Keyframes;
  duration: number;
  fps: number;
  backgroundImage?: string | null;
}

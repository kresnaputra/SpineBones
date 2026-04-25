export interface RagMotionFeatures {
  speed: string;
  energy: string;
  mood: string;
  cycle: boolean;
}

export interface RagSourceInfo {
  type: string;
  projectPath: string | null;
  exportedAt: string;
}

export interface RagRigProfile {
  type: string;
  semanticBones: string[];
  boneCount: number;
  slotCount: number;
}

export type RagKeyframeEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface RagAnimationFrame {
  frame: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  easing: RagKeyframeEasing;
}

export interface RagAnimationBoneTrack {
  boneId: number;
  boneName: string;
  frames: RagAnimationFrame[];
}

export interface RagAnimationData {
  format: string;
  version: string;
  duration: number;
  fps: number;
  bones: Array<{ id: number; name: string; parentId: number | null }>;
  slots: Array<Record<string, unknown>>;
  keyframes: RagAnimationBoneTrack[];
}

export interface RagAnimationDatasetItem {
  datasetFormat: 'spinebones-rag-animation';
  version: string;
  id: string;
  name: string;
  description: string;
  category: string;
  loop: boolean;
  style: string[];
  motionFeatures: RagMotionFeatures;
  requiredBones: string[];
  usage: string;
  tags: string[];
  source: RagSourceInfo;
  rigProfile: RagRigProfile;
  boneMapping: Record<string, string>;
  animation: RagAnimationData;
}

export interface RagQueryContext {
  prompt: string;
  category?: string | null;
  tags?: string[];
  semanticBones?: string[];
}

export interface RagRetrievalResult {
  item: RagAnimationDatasetItem;
  score: number;
  reasons: string[];
}

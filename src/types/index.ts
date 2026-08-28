export type Tool = 'pose' | 'bone' | 'move' | 'rotate' | 'scale' | 'mesh' | 'warp' | 'weights';
export type Mode = 'setup' | 'animate';

export interface AudioTrack {
  id: number;
  name: string;
  dataUrl: string;
  volume: number;
  offsetFrames: number;
}

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

/** One mesh control point: rest-pose local position (x,y) + texture coord (u,v). */
export interface MeshVertex {
  x: number;
  y: number;
  u: number;
  v: number;
}

/** Triangle as three indices into the vertex array. */
export type MeshTriangle = [number, number, number];

/** One bone's influence on a vertex; per-vertex weights sum to 1. */
export interface MeshVertexWeight {
  boneId: number;
  weight: number;
}

/** Triangle mesh attached to an image: rest geometry + topology. */
export interface AttachmentMesh {
  vertices: MeshVertex[];
  triangles: MeshTriangle[];
  /** Unique undirected edges, for wireframe drawing and hit-testing. */
  edges: [number, number][];
  /** Set when the mesh was created from a grid; used for grid-line insertion. */
  grid?: { columns: number; rows: number };
}

export interface Attachment {
  name: string;
  slotId: number;
  type: 'image' | 'mesh';
  imagePath: string;
  imageData?: string;
  opacity?: number;
  opaqueBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  imageIsCropped?: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Present when type === 'mesh'. Rest mesh in attachment-local units. */
  mesh?: AttachmentMesh;
  /** Per-vertex bone weights (parallel to mesh.vertices). Empty/undefined = rigid to slot bone. */
  vertexWeights?: MeshVertexWeight[][];
  /** Edit-time: which vertices are pinned (excluded from relax/auto-weight). */
  pinned?: boolean[];
  /** Parent warp deformer id, if this attachment lives inside one. */
  deformerId?: number;
}

export interface Bone {
  id: number;
  name: string;
  x: number;
  y: number;
  length: number;
  /** Rotation about Z — the original 2D, in-plane rotation. */
  rotation: number;
  /**
   * Rotation about X and Y, tilting the bone's attachment plane out of the
   * screen. Optional and absent by default: a rig without them takes the exact
   * scalar path it always did.
   */
  rotationX?: number;
  rotationY?: number;
  scaleX: number;
  scaleY: number;
  parentId: number | null;
  skinId: number;
  _wx: number;
  _wy: number;
  _wrot: number;
  /**
   * World transform as a column-major 4x4, present **only** on rigs that use
   * out-of-plane rotation. A purely 2D rig leaves this absent and keeps the
   * exact scalar path it always had.
   *
   * Deliberately a plain number array rather than a `Float64Array`: bones are
   * put through `JSON.parse(JSON.stringify(...))` by every undo snapshot and by
   * project saving, and a typed array does not survive that — it comes back as
   * `{"0": …}`. A plain array round-trips harmlessly even if some future code
   * path serialises a bone without stripping it first. It *is* stripped where
   * it matters, but the type choice means forgetting is untidy, not corrupting.
   */
  _wm?: number[];
}

export interface Skin {
  id: number;
  name: string;
  color: string;
}

export interface BoneGroup {
  id: number;
  name: string;
  boneIds: number[];
}

export type KeyframeEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut';

export interface KeyframeData {
  x: number;
  y: number;
  rotation: number;
  /**
   * Out-of-plane rotation. Optional so every keyframe written before 3D
   * rotation existed stays valid — absent reads as 0, which is what those poses
   * meant. No project migration is needed.
   */
  rotationX?: number;
  rotationY?: number;
  scaleX: number;
  scaleY: number;
  easing?: KeyframeEasing;
}

export type Keyframes = Record<number, Record<number, KeyframeData>>;
/**
 * Per-attachment, per-frame mesh deformation: absolute rest-local vertex
 * positions (parallel to the attachment's mesh.vertices). Keyed by attachment key.
 */
export type MeshDeformKeyframes = Record<
  string,
  Record<
    number,
    {
      vertices: Array<Pick<MeshVertex, 'x' | 'y'>>;
      easing?: KeyframeEasing;
    }
  >
>;
export type AttachmentOpacityKeyframes = Record<
  string,
  Record<number, { opacity: number; easing?: KeyframeEasing }>
>;
export type SlotAttachmentKeyframes = Record<
  number,
  Record<number, { attachmentName: string | null }>
>;

/** Warp deformer: a grid cage that bilinearly deforms enclosed mesh vertices. */
export interface Deformer {
  id: number;
  name: string;
  parentBoneId: number | null;
  grid: { cols: number; rows: number };
  /** (cols+1)*(rows+1) rest control points in bone-local attachment space. */
  rest: { x: number; y: number }[];
  /** Fixed bounding box used for bilinear coordinate inversion — never changes after creation. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Per-deformer, per-frame control-point offsets.
 * Keyed by deformerId → frame → { points, easing }.
 */
export type DeformerKeyframes = Record<
  number,
  Record<number, { points: { x: number; y: number }[]; easing?: KeyframeEasing }>
>;

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Spring-damper physics configuration for a single bone. */
export interface PhysicsConfig {
  boneId: number;
  /** Spring stiffness (1–100). Higher = snappier. */
  stiffness: number;
  /** Exponential damping rate per second (0.5–20). Higher = less oscillation. */
  damping: number;
  /** Downward gravitational force in world units/sec² (0–500). */
  gravity: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ProjectData {
  version: string;
  bones: Bone[];
  boneGroups?: BoneGroup[];
  skins: Skin[];
  activeSkinId?: number;
  ikChainRootIds?: number[];
  setupPose?: SetupPose;
  slots: Slot[];
  attachments: Attachment[];
  keyframes: Keyframes;
  slotAttachmentKeyframes?: SlotAttachmentKeyframes;
  attachmentOpacityKeyframes?: AttachmentOpacityKeyframes;
  meshDeformKeyframes?: MeshDeformKeyframes;
  deformers?: Deformer[];
  deformerKeyframes?: DeformerKeyframes;
  nextDeformerId?: number;
  physicsConfigs?: PhysicsConfig[];
  duration: number;
  fps: number;
  backgroundImage?: string | null;
  audioTracks?: AudioTrack[];
  activeAudioTrackId?: number | null;
  audioData?: string | null;
  audioName?: string | null;
  audioVolume?: number;
  audioOffsetFrames?: number;
}

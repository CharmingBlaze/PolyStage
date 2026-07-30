export type EditMode = 'object' | 'vertex' | 'edge' | 'face' | 'bone';
export type TransformMode = 'move' | 'rotate' | 'scale' | 'pivot';
export type ViewMode = 'textured' | 'flat' | 'wireframe' | 'lit' | 'polygon-wire';
/** Top-level app workspaces (Header chips). Brush/UV are overlays on modeling. */
export type WorkspaceMode = 'modeling' | 'animation' | 'paint' | 'rigging';
export type HeaderWorkspace = 'modeling' | 'paint' | 'brush' | 'rig' | 'animation' | 'uv';
export type RigMode = 'edit' | 'pose' | 'skin';

export type PrimitiveType =
  | 'cube'
  | 'pyramid'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'ramp'
  | 'sphere'
  | 'torus'
  | 'torusKnot'
  | 'dodecahedron'
  | 'icosahedron'
  | 'octahedron'
  | 'tetrahedron'
  | 'circle'
  | 'ring'
  | 'tube'
  | 'lathe'
  | 'chest'
  | 'tree'
  | 'car';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface UVCoord {
  u: number;
  v: number;
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
  z: number;
  normal?: Vector3D;
  boneId?: string | null;
}

export interface Edge {
  id: string;
  v1Id: string;
  v2Id: string;
  /** Face IDs sharing this boundary edge (filled on finalize when available). */
  faceIds?: string[];
  sharp?: boolean;
  seam?: boolean;
}

export interface Face {
  id: string;
  /** Logical polygon corners (3=tri, 4=quad, 5+=n-gon). Never store render diagonals as faces. */
  vertexIds: string[];
  /** Per-corner UVs aligned with vertexIds (UV topology / seams). */
  uvs: UVCoord[];
  normal?: Vector3D;
  color?: string;
  textureIndex?: number;
  materialId?: string;
  smoothingGroup?: string | number;
}

export interface MeshTextureAnimFrame {
  id: string;
  name: string;
  durationMs: number;
  /** Composited PNG data URL for this frame. */
  dataUrl: string;
  tags?: string[];
}

export interface MeshTextureAnimClip {
  id: string;
  name: string;
  frameIds: string[];
  loop: boolean;
}

export interface MeshTextureAnimation {
  width: number;
  height: number;
  frames: MeshTextureAnimFrame[];
  clips?: MeshTextureAnimClip[];
  defaultClipId?: string | null;
}

export interface TextureClipKey {
  id: string;
  time: number;
  clipId: string;
  /** If set, clip plays until this time; otherwise plays once from `time`. */
  holdUntil?: number;
}

export interface CADMesh {
  id: string;
  name: string;
  groupId?: string | null;
  boneId?: string | null;
  position: Vector3D;
  rotation: Vector3D;
  scale: Vector3D;
  vertices: Vertex[];
  /** Logical modelling edges only (polygon boundaries). */
  edges: Edge[];
  /** Logical editable polygons (source of truth). */
  faces: Face[];
  textureCanvasDataUrl?: string;
  /**
   * Multi-frame texture strip for Pixel Paint + ANIM-driven animated textures
   * (talking mouths, blinks, etc.).
   */
  textureAnimation?: MeshTextureAnimation;
  visible?: boolean;
  locked?: boolean;
  /** Incremented on topology/position edits for cache invalidation. */
  revision?: number;
  doubleSided?: boolean;
  /** Stable face-corner UV IDs that automatic tools must preserve. */
  uvPinnedVertexIds?: string[];
  /** Optional user-facing labels keyed by a stable island signature. */
  uvIslandNames?: Record<string, string>;
  /** Game-ready normalized bone influences keyed by stable vertex ID. */
  skinWeights?: Record<string, Array<{ boneId: string; weight: number }>>;
  /** Non-destructive Blender-style modifiers (evaluated for display / Apply). */
  modifiers?: MeshModifier[];
}

export type MirrorAxis = 'x' | 'y' | 'z';

export type MeshModifier =
  | {
      id: string;
      type: 'mirror';
      enabled: boolean;
      axis: MirrorAxis;
      /** Delete geometry on the +axis side and merge near the plane (Blender Clip). */
      clip: boolean;
      mergeThreshold: number;
      /** Also mirror linked bones when applying. */
      mirrorBones?: boolean;
    }
  | {
      id: string;
      type: 'subdivision';
      enabled: boolean;
      /** Viewport / interactive levels (Catmull-Clark). */
      levels: number;
      algorithm: 'catmullClark' | 'simple';
    };


export interface BoneConstraint {
  type: 'limit-rotation' | 'copy-rotation' | 'look-at' | 'ik';
  enabled: boolean;
  targetBoneId?: string | null;
  influence?: number;
  min?: Vector3D;
  max?: Vector3D;
  chainLength?: number;
}

export interface CADBone {
  id: string;
  name: string;
  parentId: string | null;
  position: Vector3D;
  rotation: Vector3D;
  scale: Vector3D;
  length: number;
  assignedMeshIds: string[];
  color?: string;
  /** Rest/bind transform used by skinning and animation export. */
  restPosition?: Vector3D;
  restRotation?: Vector3D;
  restScale?: Vector3D;
  deform?: boolean;
  inheritRotation?: boolean;
  visible?: boolean;
  locked?: boolean;
  mirrorBoneId?: string | null;
  constraints?: BoneConstraint[];
}

export interface SceneGroup {
  id: string;
  name: string;
  position: Vector3D;
  rotation: Vector3D;
  visible?: boolean;
  locked?: boolean;
  isCollapsed?: boolean;
}

export interface AnimKeyframe {
  id: string;
  time: number;
  value: Vector3D;
}

export type AnimInterpolation = 'linear' | 'smooth' | 'bounce' | 'elastic';

export interface AnimTrack {
  targetId: string;
  targetName: string;
  targetType: 'mesh' | 'bone' | 'camera' | 'light' | 'weather' | 'particle';
  posKeyframes: AnimKeyframe[];
  rotKeyframes: AnimKeyframe[];
  sclKeyframes: AnimKeyframe[];
  /** Scalar channel for FOV, intensity, density, etc. (x used). */
  scalarKeyframes?: AnimKeyframe[];
  /** Texture frame index channel (x = frame index) for mesh texture strips. */
  texFrameKeyframes?: AnimKeyframe[];
  /** Named texture clip triggers (Talk / Blink / Idle). */
  textureClipKeys?: TextureClipKey[];
}

export interface AnimationClip {
  id: string;
  name: string;
  duration: number;
  fps: number;
  loopMode: 'loop' | 'once' | 'hold';
  tracks: AnimTrack[];
  interpolation?: AnimInterpolation;
}

export type WeatherPreset = 'clear' | 'fog' | 'rain' | 'snow' | 'storm' | 'overcast';

export interface EnvironmentSettings {
  weather: WeatherPreset;
  fogDensity: number;
  fogColor: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: string;
  ambientColor: string;
  skyTopColor: string;
  skyHorizonColor: string;
  windStrength: number;
  /** Flat viewport background vs sky gradient. */
  backgroundMode?: 'sky' | 'solid';
  /** Used when backgroundMode is solid (Lit Preview / cinematic). */
  backgroundColor?: string;
  /** Weather volume helper visibility in the viewport (default hidden). */
  visible?: boolean;
  /** Weather volume center — selectable/transformable like other scene objects. */
  position?: Vector3D;
  rotation?: Vector3D;
  scale?: Vector3D;
}

/** Active selection for meshes / cameras / lights / particles / weather (object mode). */
export type SceneObjectKind = 'mesh' | 'camera' | 'light' | 'particle' | 'weather';

export interface SceneSelection {
  kind: SceneObjectKind;
  /** For weather use the fixed id `environment`. */
  id: string;
}

export interface CADCamera {
  id: string;
  name: string;
  position: Vector3D;
  rotation: Vector3D;
  /** Look-at target in world space (optional; if set, overrides rotation aiming). */
  lookAt?: Vector3D | null;
  fov: number;
  near: number;
  far: number;
  focalLength?: number;
  locked?: boolean;
  visible?: boolean;
}

export type CADLightType = 'ambient' | 'directional' | 'point' | 'spot' | 'area';

export interface CADLight {
  id: string;
  name: string;
  type: CADLightType;
  position: Vector3D;
  rotation: Vector3D;
  /**
   * Gizmo scale. For point/spot, average scale drives distance.
   * For area, x/y drive width/height.
   */
  scale: Vector3D;
  color: string;
  intensity: number;
  /** Point/spot distance falloff. */
  distance: number;
  /** Spot cone angle in radians. */
  angle: number;
  penumbra: number;
  /** Point/spot inverse-square decay (Three.js default 2). */
  decay?: number;
  /** Area light width (world units). */
  width?: number;
  /** Area light height (world units). */
  height?: number;
  castShadow?: boolean;
  visible?: boolean;
  locked?: boolean;
}

export type ParticleShape = 'point' | 'box' | 'sphere' | 'disc';
export type ParticleBillboard = 'camera' | 'velocity' | 'fixed';

export interface ParticleEmitter {
  id: string;
  name: string;
  /** Game-export identifier */
  identifier: string;
  position: Vector3D;
  rotation: Vector3D;
  /** Gizmo scale; shapeSize stays the emission volume in local units. */
  scale?: Vector3D;
  enabled: boolean;
  shape: ParticleShape;
  shapeSize: Vector3D;
  rate: number;
  maxParticles: number;
  lifetime: number;
  lifetimeRandom: number;
  startSpeed: number;
  startSpeedRandom: number;
  gravity: Vector3D;
  drag: number;
  startSize: number;
  endSize: number;
  startColor: string;
  endColor: string;
  startAlpha: number;
  endAlpha: number;
  billboard: ParticleBillboard;
  textureDataUrl?: string | null;
  /** Emit only while cutscene time is in [emitStart, emitEnd] when driven by timeline. */
  emitStart?: number;
  emitEnd?: number;
}

export interface CADScene {
  id: string;
  name: string;
  meshes: CADMesh[];
  groups: SceneGroup[];
  bones: CADBone[];
  clips?: AnimationClip[];
  activeClipId?: string | null;
  cameras?: CADCamera[];
  activeCameraId?: string | null;
  lights?: CADLight[];
  particles?: ParticleEmitter[];
  environment?: EnvironmentSettings;
  /** Premiere-style cutscene sequence (multi-track edit). */
  /** Premiere-style cutscene sequence (multi-track edit). */
  sequence?: import('./sequence').CutsceneSequence | null;
}

export type PaintTool =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'dither'
  | 'line'
  | 'rect'
  | 'rectangle'
  | 'ellipse'
  | 'spray'
  | 'hand'
  | 'select'
  | 'wand'
  | 'move'
  | 'shade'
  | 'lighten'
  | 'noise';

export interface ToolState {
  editMode: EditMode;
  transformMode: TransformMode;
  isPainting3D: boolean;
  isCadDrawing: boolean;
  cadDrawPrimitive: PrimitiveType | null;
  gridSnap: number;
  angleSnap: number;
  activePrimitive: PrimitiveType;
  viewMode: ViewMode;
  viewportLayout: 'single' | 'quad';
  activeColor: string;
  brushSize: number;
  drawTool: PaintTool;
  paintOpacity: number;
  paintSpacing: number;
  paintMirrorU: boolean;
  uvSnapToPixel: boolean;
  /** Instant place: next click in any viewport drops activePrimitive. */
  placeOnClick?: boolean;
  /** Debug: show render triangulation diagonals in viewport / UV editor. */
  showTriangulation?: boolean;
  /** Edit changes the bind skeleton; Pose changes animation transforms; Skin edits weights. */
  rigMode?: RigMode;
  /** Weight paint brush mode when rigMode is skin. Shift/Alt still override temporarily. */
  weightPaintMode?: 'add' | 'subtract' | 'smooth' | 'replace';
  /** Explicit toggle for showing bones overlay in 3D viewport (defaults to auto based on active mode). */
  showBones?: boolean;
  /** Look through the active scene camera instead of the free orbit camera. */
  cameraViewActive?: boolean;
  /** Selected scene camera for tools / look-through. */
  selectedCameraId?: string | null;
  /**
   * Blender-style modal transform (G/R/S).
   * While set, mouse move applies the transform; LMB confirms; Esc/RMB cancels.
   */
  modalTransform?: 'translate' | 'rotate' | 'scale' | null;
  /**
   * Blender-style modal mesh operator (E/I/Ctrl+B/Ctrl+R/K).
   * Extrude/inset/bevel: mouse move sets amount; LMB confirms; Esc/RMB cancels.
   * Loop cut / knife: interactive pick + preview in viewport; LMB/Enter confirms.
   */
  modalMeshOp?: 'extrude' | 'inset' | 'bevel' | 'loopCut' | 'knife' | null;
  /** Live X/Y/Z mirror while editing (pairs verts across the plane). */
  liveMirror?: boolean;
  mirrorAxis?: MirrorAxis;
  mirrorClip?: boolean;
  mirrorMergeThreshold?: number;
  /** When mirroring / live mirror, also affect bones. */
  mirrorBones?: boolean;
}

export interface RenderSettings {
  pixelScale: number;
  dither: boolean;
  bloom: boolean;
  ssao: boolean;
  ambientIntensity: number;
  lightIntensity: number;
  wireframeColor: string;
  bgColor: string;
  turntableSpeed: number;
  isTurntablePlaying: boolean;
  weather?: WeatherPreset;
  fogDensity?: number;
  fogColor?: string;
  sunElevation?: number;
  sunAzimuth?: number;
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

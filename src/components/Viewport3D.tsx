import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { applyStandardOrbitMouseButtons, applyPaintOrbitMouseButtons, applyDrawToolOrbitMouseButtons, bindBlockbenchOrbitModifiers, STANDARD_NAV_HINT, PAINT_NAV_HINT } from '../utils/viewportNav';
import { applyThemedTransformGizmo, VIEWPORT_THEME } from '../utils/viewportTheme';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CADMesh, CADBone, CADCamera, CADLight, ParticleEmitter, EnvironmentSettings, ToolState, RenderSettings, PrimitiveType, SceneSelection, Vector3D, WorkspaceMode } from '../types/cad';
import { buildThreeGeometry, generatePrimitive, snapToGrid } from '../utils/meshUtils';
import {
  beginModalMeshOp,
  applyModalAmount,
  type ModalMeshSession,
} from '../utils/modalMeshOps';
import { evaluateMeshModifiers, syncMirroredBonePose, syncSymmetricalVertices } from '../utils/mirrorModeling';
import { buildLogicalEdgeGeometry, buildTriangulationDebugGeometry } from '../utils/topology/edgeOverlay';
import {
  findEdgeLoop,
  getLoopCutPreviewPolylines,
  loopCutFactors,
  type KnifeHit,
} from '../utils/meshCutTools';
import { pickPaintUv, samplePaintStrokeUvs, setRayFromPointer } from '../utils/bvh/picking';
import { subscribeTexturePreview, cancelTexturePreviewNotify } from '../utils/texturePreviewBus';
import { LightwaveNavToolbar } from './LightwaveNavToolbar';
import { deformMeshWithBones, getBoneWorldMatrices, paintVertexWeight } from '../utils/rigging';
import { evaluateConstraints } from '../utils/ik';
import {
  createCameraHelper,
  createLightHelper,
  createParticleHelper,
  createWeatherHelper,
  disposeObject3D,
  clearAndDisposeGroup,
  lightDistanceFromScale,
  readObjectPRS,
} from '../utils/sceneHelpers';
import { VectorOverlay } from './VectorOverlay';
import { BlockoutRefToolbar } from './BlockoutRefToolbar';
import { BlockoutSilhouetteToolbar } from './BlockoutSilhouetteToolbar';
import {
  registerVectorViewport,
  unregisterVectorViewport,
  type VectorViewportKind,
} from '../utils/vectorViewportRegistry';
import { useVectorStore } from '../store/useVectorStore';
import {
  combineVectorMeshes,
  vectorPathsToMesh,
  vectorSnapshotToCADMesh,
} from '../utils/vectorBlockout';
import {
  applyVectorRefTransform,
  createVectorRefMesh,
  setVectorRefActive,
  type VectorRefPlaneId,
} from '../utils/vectorRefPlanes';

interface Viewport3DProps {
  meshes: CADMesh[];
  bones?: CADBone[];
  setBones?: React.Dispatch<React.SetStateAction<CADBone[]>>;
  selectedBoneId?: string;
  setSelectedBoneId?: (id: string) => void;
  activeMeshId: string;
  setActiveMeshId: (id: string) => void;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  renderSettings: RenderSettings;
  textureCanvas: HTMLCanvasElement | null;
  textureRevision?: number;
  cameraType?: 'perspective' | 'top' | 'front' | 'side';
  selectedVertexIds: string[];
  setSelectedVertexIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeIds?: string[];
  setSelectedEdgeIds?: React.Dispatch<React.SetStateAction<string[]>>;
  selectedFaceIds: string[];
  setSelectedFaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedMeshIds?: string[];
  setSelectedMeshIds?: React.Dispatch<React.SetStateAction<string[]>>;
  activeWorkspaceMode?: WorkspaceMode;
  activeRightTab?: string;
  onDirect3DPaintPixel?: (uvU: number, uvV: number, isFinal?: boolean, faceId?: string | null) => void;
  onSpawnDrawnPrimitive?: (newMesh: CADMesh) => void;
  onOpenUVModal?: () => void;
  isQuadSubViewport?: boolean;
  onModalMeshPreview?: (amount: number) => void;
  onModalMeshConfirm?: () => void;
  onModalMeshCancel?: () => void;
  onModalLoopCutConfirm?: (loopEdgeIds: string[], factors: number[]) => void;
  onModalKnifeConfirm?: (hits: KnifeHit[]) => void;
  onBeginHistory?: () => void;
  cameras?: CADCamera[];
  lights?: CADLight[];
  particles?: ParticleEmitter[];
  environment?: EnvironmentSettings;
  setCameras?: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  setLights?: React.Dispatch<React.SetStateAction<CADLight[]>>;
  setParticles?: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  setEnvironment?: (env: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => void;
  sceneSelection?: SceneSelection | null;
  setSceneSelection?: (sel: SceneSelection | null) => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  meshes,
  bones = [],
  setBones,
  selectedBoneId = '',
  setSelectedBoneId,
  activeMeshId,
  setActiveMeshId,
  setMesh,
  toolState,
  setToolState,
  renderSettings,
  textureCanvas,
  textureRevision = 0,
  cameraType = 'perspective',
  selectedVertexIds,
  setSelectedVertexIds,
  selectedEdgeIds = [],
  setSelectedEdgeIds,
  selectedFaceIds,
  setSelectedFaceIds,
  selectedMeshIds = [],
  setSelectedMeshIds,
  activeWorkspaceMode = 'modeling',
  activeRightTab = 'outliner',
  onDirect3DPaintPixel,
  onSpawnDrawnPrimitive,
  onOpenUVModal,
  isQuadSubViewport = false,
  onModalMeshPreview,
  onModalMeshConfirm,
  onModalMeshCancel,
  onModalLoopCutConfirm,
  onModalKnifeConfirm,
  onBeginHistory,
  cameras = [],
  lights = [],
  particles = [],
  environment,
  setCameras,
  setLights,
  setParticles,
  setEnvironment,
  sceneSelection = null,
  setSceneSelection,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const dummyTargetRef = useRef<THREE.Object3D | null>(null);

  const meshesGroupRef = useRef<THREE.Group | null>(null);
  const bonesGroupRef = useRef<THREE.Group | null>(null);
  const sceneHelpersGroupRef = useRef<THREE.Group | null>(null);
  const activeMeshObjectRef = useRef<THREE.Mesh | null>(null);
  const verticesGroupRef = useRef<THREE.Group | null>(null);
  const edgesGroupRef = useRef<THREE.Group | null>(null);
  const facesHighlightGroupRef = useRef<THREE.Group | null>(null);
  const hoverHighlightGroupRef = useRef<THREE.Group | null>(null);
  const cutPreviewGroupRef = useRef<THREE.Group | null>(null);
  const vectorGhostRef = useRef<THREE.Group | null>(null);
  const vectorRefGroupRef = useRef<THREE.Group | null>(null);
  const vectorRefTexturesRef = useRef<Map<string, THREE.Texture>>(new Map());
  /** Per-mesh textures — never share one CanvasTexture across all objects. */
  const meshTexturesRef = useRef<Map<string, { key: string; texture: THREE.Texture }>>(new Map());
  const [meshTextureTick, setMeshTextureTick] = useState(0);
  /** Hemisphere fill — OutlineForge-style soft ambient (sky / ground). */
  const ambientLightRef = useRef<THREE.HemisphereLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);

  const previousGizmoPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const dragStartGizmoPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const initialVertsMapRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  const modalActiveRef = useRef(false);
  /** Frozen pre-op mesh for extrude/inset/bevel — survives Strict Mode remounts. */
  const meshOpFreezeRef = useRef<{
    op: 'extrude' | 'inset' | 'bevel';
    mesh: CADMesh;
    faceIds: string[];
    edgeIds: string[];
  } | null>(null);
  const meshSnapshotRef = useRef<CADMesh | null>(null);
  const pendingComponentVertsRef = useRef<CADMesh['vertices'] | null>(null);
  const transformSnapshotRef = useRef<{
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  } | null>(null);
  /** Always-current refs so modal G/R/S does not rebind on every mesh frame. */
  const activeMeshRef = useRef<CADMesh | undefined>(undefined);
  const toolStateRef = useRef(toolState);
  const selectedVertexIdsRef = useRef(selectedVertexIds);
  const selectedEdgeIdsRef = useRef(selectedEdgeIds);
  const selectedFaceIdsRef = useRef(selectedFaceIds);
  const selectedMeshIdsRef = useRef(selectedMeshIds);
  const bonesRef = useRef(bones);
  const selectedBoneIdRef = useRef(selectedBoneId);
  const sceneSelectionRef = useRef(sceneSelection);
  const camerasRef = useRef(cameras);
  const lightsRef = useRef(lights);
  const particlesRef = useRef(particles);
  const environmentRef = useRef(environment);
  const onBeginHistoryRef = useRef(onBeginHistory);
  onBeginHistoryRef.current = onBeginHistory;
  const setMeshRef = useRef(setMesh);
  setMeshRef.current = setMesh;
  const setBonesRef = useRef(setBones);
  setBonesRef.current = setBones;
  const setCamerasRef = useRef(setCameras);
  setCamerasRef.current = setCameras;
  const setLightsRef = useRef(setLights);
  setLightsRef.current = setLights;
  const setParticlesRef = useRef(setParticles);
  setParticlesRef.current = setParticles;
  const setEnvironmentRef = useRef(setEnvironment);
  setEnvironmentRef.current = setEnvironment;
  const setToolStateRef = useRef(setToolState);
  setToolStateRef.current = setToolState;
  const onModalMeshConfirmRef = useRef(onModalMeshConfirm);
  onModalMeshConfirmRef.current = onModalMeshConfirm;
  const onModalMeshCancelRef = useRef(onModalMeshCancel);
  onModalMeshCancelRef.current = onModalMeshCancel;

  /** Local → world matrix for a CAD mesh (position/rotation/scale). */
  const getMeshWorldMatrix = (mesh: CADMesh) => {
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, 'XYZ')),
      new THREE.Vector3(mesh.scale.x, mesh.scale.y, mesh.scale.z),
    );
    return m;
  };

  const localToWorld = (mesh: CADMesh, x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z);
    v.applyMatrix4(getMeshWorldMatrix(mesh));
    return v;
  };

  const worldDeltaToLocal = (mesh: CADMesh, dx: number, dy: number, dz: number) => {
    const inv = getMeshWorldMatrix(mesh).invert();
    // Transform delta as direction (w=0): apply only rotation+scale
    const rotScale = new THREE.Matrix3().setFromMatrix4(inv);
    const d = new THREE.Vector3(dx, dy, dz).applyMatrix3(rotScale);
    return d;
  };

  const collectEditVertIds = (mesh: CADMesh): string[] => {
    if (toolState.editMode === 'vertex') return [...selectedVertexIds];
    if (toolState.editMode === 'edge') {
      const ids = new Set<string>();
      mesh.edges.forEach((e) => {
        if (selectedEdgeIds.includes(e.id)) {
          ids.add(e.v1Id);
          ids.add(e.v2Id);
        }
      });
      return [...ids];
    }
    if (toolState.editMode === 'face') {
      const ids = new Set<string>();
      mesh.faces.forEach((f) => {
        if (selectedFaceIds.includes(f.id)) f.vertexIds.forEach((id) => ids.add(id));
      });
      return [...ids];
    }
    return [];
  };

  /** Screen-space edge picker — reliable at any zoom (unlike thin Line raycasts). */
  const pickClosestEdgeId = (
    clientX: number,
    clientY: number,
    mesh: CADMesh | undefined = activeMeshRef.current,
    pixelThreshold = 14,
  ): string | null => {
    const cam = cameraRef.current;
    const el = containerRef.current;
    if (!mesh || !cam || !el) return null;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
    let bestId: string | null = null;
    let bestDist = pixelThreshold;

    const toScreen = (x: number, y: number, z: number) => {
      const w = localToWorld(mesh, x, y, z);
      w.project(cam);
      return {
        x: ((w.x + 1) / 2) * rect.width,
        y: ((-w.y + 1) / 2) * rect.height,
        behind: w.z > 1,
      };
    };

    const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      if (len2 < 1e-8) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * abx + (py - ay) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    };

    mesh.edges.forEach((edge) => {
      const a = vertMap.get(edge.v1Id);
      const b = vertMap.get(edge.v2Id);
      if (!a || !b) return;
      const sa = toScreen(a.x, a.y, a.z);
      const sb = toScreen(b.x, b.y, b.z);
      if (sa.behind && sb.behind) return;
      const d = distToSeg(mx, my, sa.x, sa.y, sb.x, sb.y);
      if (d < bestDist) {
        bestDist = d;
        bestId = edge.id;
      }
    });
    return bestId;
  };

  const computeSelectionWorldCentroid = (mesh: CADMesh): THREE.Vector3 | null => {
    if (toolState.editMode === 'object') {
      const selected = meshes.filter((m) => selectedMeshIds.includes(m.id));
      if (!selected.length) return null;
      const primary = selected.find((m) => m.id === activeMeshId) || selected[0];
      return new THREE.Vector3(primary.position.x, primary.position.y, primary.position.z);
    }
    const ids = collectEditVertIds(mesh);
    if (!ids.length) return null;
    const idSet = new Set(ids);
    const verts = mesh.vertices.filter((v) => idSet.has(v.id));
    if (!verts.length) return null;
    const c = new THREE.Vector3();
    verts.forEach((v) => c.add(localToWorld(mesh, v.x, v.y, v.z)));
    c.divideScalar(verts.length);
    return c;
  };

  const pickClosestEdgeIdRef = useRef(pickClosestEdgeId);
  pickClosestEdgeIdRef.current = pickClosestEdgeId;

  const [cadStep, setCadStep] = useState<0 | 1 | 2>(0);
  const [placementHoverPos, setPlacementHoverPos] = useState<THREE.Vector3 | null>(null);
  const [isPainting3DActive, setIsPainting3DActive] = useState<boolean>(false);
  /** Immediate gesture state; React state can lag behind the first pointermove after pointerdown. */
  const isPainting3DActiveRef = useRef(false);
  const paintPointerIdRef = useRef<number | null>(null);
  const lastPaintClientRef = useRef<{ x: number; y: number } | null>(null);
  const [paintCursor, setPaintCursor] = useState<{ x: number; y: number; u: number; v: number } | null>(null);
  const paintCursorRafRef = useRef(0);
  const pendingPaintCursorRef = useRef<{ x: number; y: number; u: number; v: number } | null>(null);

  const schedulePaintCursor = (next: { x: number; y: number; u: number; v: number } | null) => {
    pendingPaintCursorRef.current = next;
    if (paintCursorRafRef.current) return;
    paintCursorRafRef.current = requestAnimationFrame(() => {
      paintCursorRafRef.current = 0;
      setPaintCursor(pendingPaintCursorRef.current);
    });
  };
  const [hoveredVertexId, setHoveredVertexId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);

  const [drawBaseStart, setDrawBaseStart] = useState<THREE.Vector3 | null>(null);
  const [drawBaseEnd, setDrawBaseEnd] = useState<THREE.Vector3 | null>(null);
  const [drawHeight, setDrawHeight] = useState<number>(1.0);

  const [marqueeBox, setMarqueeBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMarqueeDraggingRef = useRef<boolean>(false);
  const isWeightPaintingRef = useRef<boolean>(false);

  const activeMesh = meshes.find((m) => m.id === activeMeshId) || meshes[0];
  activeMeshRef.current = activeMesh;
  toolStateRef.current = toolState;
  selectedVertexIdsRef.current = selectedVertexIds;
  selectedEdgeIdsRef.current = selectedEdgeIds;
  selectedFaceIdsRef.current = selectedFaceIds;
  selectedMeshIdsRef.current = selectedMeshIds;
  bonesRef.current = bones;
  selectedBoneIdRef.current = selectedBoneId;
  sceneSelectionRef.current = sceneSelection;
  camerasRef.current = cameras;
  lightsRef.current = lights;
  particlesRef.current = particles;
  environmentRef.current = environment;

  const isBoneEditMode = toolState.editMode === 'bone';
  const isRigOrAnimTab = activeRightTab === 'rig' || activeRightTab === 'anim';
  const isAnimWorkspace = activeWorkspaceMode === 'animation';
  const isRigWorkspace = activeWorkspaceMode === 'rigging';
  const shouldShowBones = toolState.showBones !== undefined
    ? toolState.showBones
    : (isBoneEditMode || isRigOrAnimTab || isAnimWorkspace || isRigWorkspace);

  const is2DPrimitive = (type: PrimitiveType | null): boolean => {
    return type === 'plane' || type === 'circle' || type === 'ring';
  };

  const vectorMode = useVectorStore((s) => s.mode);
  const vectorRefTool = useVectorStore((s) => s.refTool);

  useEffect(() => {
    if (!controlsRef.current) return;
    const blocked =
      toolState.isCadDrawing ||
      toolState.placeOnClick ||
      Boolean(toolState.modalTransform) ||
      Boolean(toolState.modalMeshOp) ||
      modalActiveRef.current ||
      isPainting3DActive;
    controlsRef.current.enabled = !blocked;
    applyStandardOrbitMouseButtons(controlsRef.current);

    // 3D paint: keep default LMB orbit (empty space). Mesh hits steal LMB in the pointer handler.
    // Blockout pen: LMB is always for drawing — disable orbit on left button.
    const penBlockout = activeWorkspaceMode === 'blockout' && vectorMode === 'pen';
    const refEditing = activeWorkspaceMode === 'blockout' && vectorRefTool !== 'none';
    if (refEditing || penBlockout) {
      // LMB reserved for drawing / reference move-scale.
      applyDrawToolOrbitMouseButtons(controlsRef.current, {
        ortho: cameraType !== 'perspective',
      });
    } else if (toolState.isPainting3D) {
      applyPaintOrbitMouseButtons(controlsRef.current);
    }
  }, [
    toolState.isCadDrawing,
    toolState.placeOnClick,
    toolState.isPainting3D,
    toolState.modalTransform,
    toolState.modalMeshOp,
    isPainting3DActive,
    activeWorkspaceMode,
    cameraType,
    vectorMode,
    vectorRefTool,
  ]);

  // Re-apply orbit buttons when Vector Draw/Edit mode toggles.
  useEffect(() => {
    if (!controlsRef.current || activeWorkspaceMode !== 'blockout') return;
    if (vectorRefTool !== 'none' || vectorMode === 'pen') {
      applyDrawToolOrbitMouseButtons(controlsRef.current, {
        ortho: cameraType !== 'perspective',
      });
    } else {
      applyStandardOrbitMouseButtons(controlsRef.current);
    }
  }, [vectorMode, vectorRefTool, activeWorkspaceMode, cameraType]);

  // Space+drag pans in Blockout Draw (ortho Front/Side muscle memory) without placing points.
  useEffect(() => {
    if (activeWorkspaceMode !== 'blockout' || vectorMode !== 'pen') return;
    const isOrtho = cameraType !== 'perspective';

    const applySpacePan = (spaceDown: boolean) => {
      const controls = controlsRef.current;
      if (!controls) return;
      if (spaceDown) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        };
        controls.enablePan = true;
        controls.screenSpacePanning = true;
      } else {
        applyDrawToolOrbitMouseButtons(controls, { ortho: isOrtho });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      applySpacePan(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      applySpacePan(false);
    };
    const onBlur = () => applySpacePan(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      applySpacePan(false);
    };
  }, [activeWorkspaceMode, vectorMode, cameraType]);

  // Esc / mode switch clears isCadDrawing in App, but CAD step is local — reset it or orbit stays dead.
  useEffect(() => {
    if (toolState.isCadDrawing) return;
    setCadStep(0);
    setDrawBaseStart(null);
    setDrawBaseEnd(null);
    setDrawHeight(1.0);
    if (
      controlsRef.current &&
      !toolState.placeOnClick &&
      !toolState.modalTransform &&
      !toolState.modalMeshOp &&
      !isPainting3DActive
    ) {
      controlsRef.current.enabled = true;
      applyStandardOrbitMouseButtons(controlsRef.current);
    }
  }, [toolState.isCadDrawing, toolState.placeOnClick, toolState.isPainting3D, toolState.modalTransform, toolState.modalMeshOp, isPainting3DActive]);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    // OutlineForge live-view charcoal (soft shadows read better on near-black).
    scene.background = new THREE.Color('#1b1b1b');
    sceneRef.current = scene;

    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const aspect = width / height;

    if (cameraType === 'perspective') {
      // FOV 38 + slightly lower eye matches the OutlineForge “LIVE 3D” framing.
      camera = new THREE.PerspectiveCamera(38, aspect, 0.01, 1000);
      camera.position.set(5.5, 3.5, 8);
    } else {
      const zoom = 4;
      camera = new THREE.OrthographicCamera(-zoom * aspect, zoom * aspect, zoom, -zoom, 0.1, 1000);
      if (cameraType === 'top') camera.position.set(0, 10, 0);
      else if (cameraType === 'front') camera.position.set(0, 0, 10);
      else if (cameraType === 'side') camera.position.set(10, 0, 0);
    }
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // false saves GPU memory per viewport (quad view ×4). Screenshots use separate paths.
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableRotate = cameraType === 'perspective';
    controls.screenSpacePanning = true;
    applyStandardOrbitMouseButtons(controls);
    // Block RMB context menu so pan gestures aren't eaten after 1–2 uses.
    const onCanvasContextMenu = (e: Event) => e.preventDefault();
    renderer.domElement.addEventListener('contextmenu', onCanvasContextMenu);
    const unbindNavMods = bindBlockbenchOrbitModifiers(controls, renderer.domElement);
    controlsRef.current = controls;

    const tControls = new TransformControls(camera, renderer.domElement);
    applyThemedTransformGizmo(tControls);
    scene.add(tControls.getHelper());
    transformControlsRef.current = tControls;

    const dummyTarget = new THREE.Object3D();
    scene.add(dummyTarget);
    dummyTargetRef.current = dummyTarget;
    tControls.attach(dummyTarget);

    tControls.addEventListener('dragging-changed', (event) => {
      const cur = toolStateRef.current;
      const blocked =
        Boolean(event.value) ||
        cur.isCadDrawing ||
        Boolean(cur.placeOnClick) ||
        Boolean(cur.modalTransform) ||
        Boolean(cur.modalMeshOp) ||
        modalActiveRef.current;
      controls.enabled = !blocked;
      if (event.value && dummyTargetRef.current) {
        previousGizmoPosRef.current.copy(dummyTargetRef.current.position);
      }
    });

    if (cameraType === 'perspective') {
      // Charcoal grid + ShadowMaterial catcher — same presentation as OutlineForge LIVE 3D.
      const gridSize = 14;
      const gridHelper = new THREE.GridHelper(
        gridSize,
        28,
        VIEWPORT_THEME.gridMajor,
        VIEWPORT_THEME.gridMinor
      );
      gridHelper.position.y = -0.001;
      scene.add(gridHelper);

      const shadowFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(gridSize, gridSize),
        new THREE.ShadowMaterial({ opacity: 0.18 })
      );
      shadowFloor.rotation.x = -Math.PI / 2;
      shadowFloor.position.y = -0.002;
      shadowFloor.receiveShadow = true;
      shadowFloor.name = 'shadowFloor';
      scene.add(shadowFloor);
    } else {
      // 2D Orthographic Drafting Grid (aligned to the orthographic projection plane)
      const orthoGrid = new THREE.GridHelper(12, 24, VIEWPORT_THEME.gridOrthoMajor, VIEWPORT_THEME.gridOrthoMinor);
      if (cameraType === 'front') {
        orthoGrid.rotation.x = Math.PI / 2;
      } else if (cameraType === 'side') {
        orthoGrid.rotation.z = Math.PI / 2;
      }
      scene.add(orthoGrid);
    }

    const mGroup = new THREE.Group();
    scene.add(mGroup);
    meshesGroupRef.current = mGroup;

    const helpersGroup = new THREE.Group();
    scene.add(helpersGroup);
    sceneHelpersGroupRef.current = helpersGroup;

    const bGroup = new THREE.Group();
    scene.add(bGroup);
    bonesGroupRef.current = bGroup;

    const vertGroup = new THREE.Group();
    scene.add(vertGroup);
    verticesGroupRef.current = vertGroup;

    const edgeGroup = new THREE.Group();
    scene.add(edgeGroup);
    edgesGroupRef.current = edgeGroup;

    const faceGroup = new THREE.Group();
    scene.add(faceGroup);
    facesHighlightGroupRef.current = faceGroup;

    const hoverGroup = new THREE.Group();
    scene.add(hoverGroup);
    hoverHighlightGroupRef.current = hoverGroup;

    const cutPreviewGroup = new THREE.Group();
    scene.add(cutPreviewGroup);
    cutPreviewGroupRef.current = cutPreviewGroup;

    const vectorGhostGroup = new THREE.Group();
    vectorGhostGroup.name = 'vectorGhost';
    scene.add(vectorGhostGroup);
    vectorGhostRef.current = vectorGhostGroup;

    const vectorRefGroup = new THREE.Group();
    vectorRefGroup.name = 'vectorRefs';
    vectorRefGroup.add(createVectorRefMesh('front'), createVectorRefMesh('side'));
    vectorRefGroup.visible = false;
    scene.add(vectorRefGroup);
    vectorRefGroupRef.current = vectorRefGroup;

    const hemiLight = new THREE.HemisphereLight(
      0xffffff,
      0x242424,
      renderSettings.ambientIntensity ?? 1.45
    );
    ambientLightRef.current = hemiLight;
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, renderSettings.lightIntensity ?? 2.5);
    dirLight.position.set(4, 7, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.bias = -0.0002;
    dirLight.shadow.normalBias = 0.02;
    const shadowSpan = 10;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 40;
    dirLight.shadow.camera.left = -shadowSpan;
    dirLight.shadow.camera.right = shadowSpan;
    dirLight.shadow.camera.top = shadowSpan;
    dirLight.shadow.camera.bottom = -shadowSpan;
    dirLightRef.current = dirLight;
    scene.add(dirLight);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (renderSettings.isTurntablePlaying && cameraType === 'perspective' && meshesGroupRef.current) {
        meshesGroupRef.current.rotation.y += (renderSettings.turntableSpeed || 1) * 0.01;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = Math.max(1, containerRef.current.clientWidth);
      const h = Math.max(1, containerRef.current.clientHeight);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      } else if (camera instanceof THREE.OrthographicCamera) {
        const verticalSpan = camera.top - camera.bottom;
        const halfWidth = (verticalSpan * (w / h)) / 2;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.updateProjectionMatrix();
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    window.addEventListener('resize', handleResize);
    handleResize();

    const vectorKind = cameraType as VectorViewportKind;
    registerVectorViewport({
      kind: vectorKind,
      camera,
      container: containerRef.current,
    });

    return () => {
      unregisterVectorViewport(vectorKind);
      unbindNavMods();
      renderer.domElement.removeEventListener('contextmenu', onCanvasContextMenu);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      tControls.dispose();
      controls.dispose();
      clearAndDisposeGroup(meshesGroupRef.current);
      clearAndDisposeGroup(verticesGroupRef.current);
      clearAndDisposeGroup(edgesGroupRef.current);
      clearAndDisposeGroup(bonesGroupRef.current);
      clearAndDisposeGroup(facesHighlightGroupRef.current);
      clearAndDisposeGroup(hoverHighlightGroupRef.current);
      clearAndDisposeGroup(vectorGhostRef.current);
      if (vectorRefGroupRef.current) {
        vectorRefGroupRef.current.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
            if (mat?.map) mat.map = null;
          }
        });
        scene.remove(vectorRefGroupRef.current);
        disposeObject3D(vectorRefGroupRef.current, { disposeTextures: false });
        vectorRefGroupRef.current = null;
      }
      vectorRefTexturesRef.current.forEach((tex) => tex.dispose());
      vectorRefTexturesRef.current.clear();
      meshTexturesRef.current.forEach((entry) => entry.texture.dispose());
      meshTexturesRef.current.clear();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [cameraType]);

  // Live translucent vector blockout preview (updates as silhouettes close / edit)
  const vectorRevision = useVectorStore((s) => s.revision);
  const vectorBuiltRevision = useVectorStore((s) => s.builtRevision);
  useEffect(() => {
    const group = vectorGhostRef.current;
    if (!group) return;

    let cancelled = false;
    let raf = 0;

    const rebuild = () => {
      if (cancelled || !vectorGhostRef.current) return;
      const g = vectorGhostRef.current;

      if (activeWorkspaceMode !== 'blockout') {
        while (g.children.length) {
          const child = g.children[0];
          g.remove(child);
          disposeObject3D(child);
        }
        g.visible = false;
        return;
      }

      const store = useVectorStore.getState();
      const hasClosed = store.parts.some((part) => {
        const paths = part.id === store.activePartId ? store.paths : part.paths;
        return paths.front.closed || paths.side.closed || paths.top.closed;
      });

      // Drawing open curves: skip clear/rebuild thrash on every pointer move.
      if (!hasClosed) {
        if (g.children.length === 0) {
          g.visible = false;
          return;
        }
        while (g.children.length) {
          const child = g.children[0];
          g.remove(child);
          disposeObject3D(child);
        }
        g.visible = false;
        return;
      }

      // Solid mesh already matches current curves — don't double-draw ghost.
      if (store.builtRevision === store.revision) {
        while (g.children.length) {
          const child = g.children[0];
          g.remove(child);
          disposeObject3D(child);
        }
        g.visible = false;
        return;
      }

      const buildParts = store.parts.map((part) =>
        part.id === store.activePartId ? { ...part, paths: store.paths } : part
      );
      const generated = buildParts
        .map((part) =>
          vectorPathsToMesh(
            part.paths.front.closed ? part.paths.front : null,
            part.paths.side.closed ? part.paths.side : null,
            store.verticalSegments,
            store.radialSegments,
            part.paths.top.closed ? part.paths.top : null,
            { thickness: store.thickness, gameTopology: true, capStyle: store.capStyle, taperThickness: true, roundness: store.roundness }
          )
        )
        .filter((mesh): mesh is NonNullable<typeof mesh> => !!mesh);

      while (g.children.length) {
        const child = g.children[0];
        g.remove(child);
        disposeObject3D(child);
      }

      if (!generated.length) {
        g.visible = false;
        return;
      }

      const snapshot =
        generated.length === 1 ? generated[0] : combineVectorMeshes(generated);
      const cad = vectorSnapshotToCADMesh(snapshot, 'Vector Ghost');
      const geo = buildThreeGeometry(cad);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd2b48c,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        flatShading: true,
        roughness: 0.82,
        metalness: 0.04,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      g.add(mesh);

      const wireMat = new THREE.LineBasicMaterial({
        color: 0xe8d090,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const wire = new THREE.LineSegments(buildLogicalEdgeGeometry(cad), wireMat);
      wire.renderOrder = 2;
      g.add(wire);
      g.visible = true;
    };

    // Coalesce rapid revision bumps (handle drag) to one rebuild per frame.
    raf = requestAnimationFrame(rebuild);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [activeWorkspaceMode, vectorRevision, vectorBuiltRevision]);

  // Front + Side reference planes (3D sheets, same UVs both sides) in every blockout view.
  const vectorRefFront = useVectorStore((s) => s.refImages.front);
  const vectorRefSide = useVectorStore((s) => s.refImages.side);
  const vectorRefEditPlane = useVectorStore((s) => s.refEditPlane);
  useEffect(() => {
    const group = vectorRefGroupRef.current;
    if (!group) return;

    if (activeWorkspaceMode !== 'blockout') {
      group.visible = false;
      return;
    }
    group.visible = true;

    const syncPlane = (plane: VectorRefPlaneId, ref: typeof vectorRefFront) => {
      const mesh = group.getObjectByName(`vectorRef-${plane}`) as THREE.Mesh | undefined;
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (!ref?.dataUrl) {
        mesh.visible = false;
        if (mat.map) {
          mat.map = null;
          mat.needsUpdate = true;
        }
        return;
      }

      applyVectorRefTransform(mesh, plane, ref);
      setVectorRefActive(
        mesh,
        vectorRefEditPlane === plane && vectorRefTool !== 'none' && !ref.locked
      );

      const cacheKey = `${plane}:${ref.dataUrl}`;
      const cached = vectorRefTexturesRef.current.get(cacheKey);
      if (cached) {
        if (mat.map !== cached) {
          mat.map = cached;
          mat.needsUpdate = true;
        }
        return;
      }

      let cancelled = false;
      const loader = new THREE.TextureLoader();
      loader.load(
        ref.dataUrl,
        (texture) => {
          if (cancelled || !vectorRefGroupRef.current) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          // Drop previous textures for this plane only.
          for (const [key, tex] of [...vectorRefTexturesRef.current.entries()]) {
            if (key.startsWith(`${plane}:`) && key !== cacheKey) {
              tex.dispose();
              vectorRefTexturesRef.current.delete(key);
            }
          }
          vectorRefTexturesRef.current.set(cacheKey, texture);
          mat.map = texture;
          mat.needsUpdate = true;
        },
        undefined,
        () => {
          mesh.visible = false;
        }
      );
      return () => {
        cancelled = true;
      };
    };

    const cleanFront = syncPlane('front', vectorRefFront);
    const cleanSide = syncPlane('side', vectorRefSide);
    return () => {
      cleanFront?.();
      cleanSide?.();
    };
  }, [
    activeWorkspaceMode,
    vectorRefFront,
    vectorRefSide,
    vectorRefTool,
    vectorRefEditPlane,
  ]);

  // Move / scale the active reference plane with LMB drag (scroll scales in Scale mode).
  useEffect(() => {
    if (activeWorkspaceMode !== 'blockout') return;
    if (vectorRefTool === 'none' || !vectorRefEditPlane) return;
    // Only the matching Front/Side viewport owns the gesture (avoids triple-listeners).
    if (cameraType !== vectorRefEditPlane) return;

    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera) return;

    const planeId = vectorRefEditPlane;
    const scratchHit = new THREE.Vector3();
    const scratchNdc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const worldPlane =
      planeId === 'front'
        ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.02)
        : new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.02);

    const hitUV = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      scratchNdc.set(
        ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
        -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1)
      );
      raycaster.setFromCamera(scratchNdc, camera);
      if (!raycaster.ray.intersectPlane(worldPlane, scratchHit)) return null;
      return planeId === 'front'
        ? { u: scratchHit.x, v: scratchHit.y }
        : { u: scratchHit.z, v: scratchHit.y };
    };

    type DragState =
      | { mode: 'move'; startU: number; startV: number; originU: number; originV: number }
      | { mode: 'scale'; startClientY: number; originScale: number };

    let drag: DragState | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const store = useVectorStore.getState();
      if (store.refTool === 'none' || store.refEditPlane !== planeId) return;
      const ref = store.refImages[planeId];
      if (!ref || ref.locked) return;
      if ((e.target as HTMLElement | null)?.closest?.('.blockout-ref-toolbar')) return;

      e.preventDefault();
      e.stopPropagation();

      if (store.refTool === 'move') {
        const uv = hitUV(e.clientX, e.clientY);
        if (!uv) return;
        drag = {
          mode: 'move',
          startU: uv.u,
          startV: uv.v,
          originU: ref.offsetU,
          originV: ref.offsetV,
        };
      } else {
        drag = {
          mode: 'scale',
          startClientY: e.clientY,
          originScale: ref.scale,
        };
      }
      try {
        container.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const store = useVectorStore.getState();
      if (drag.mode === 'move') {
        const uv = hitUV(e.clientX, e.clientY);
        if (!uv) return;
        store.patchRefImage(planeId, {
          offsetU: drag.originU + (uv.u - drag.startU),
          offsetV: drag.originV + (uv.v - drag.startV),
        });
      } else {
        const factor = Math.exp((drag.startClientY - e.clientY) * 0.01);
        store.patchRefImage(planeId, {
          scale: Math.max(0.25, Math.min(40, drag.originScale * factor)),
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      try {
        container.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onWheel = (e: WheelEvent) => {
      const store = useVectorStore.getState();
      if (store.refTool !== 'scale' || store.refEditPlane !== planeId) return;
      const ref = store.refImages[planeId];
      if (!ref || ref.locked) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.94 : 1.06;
      store.patchRefImage(planeId, {
        scale: Math.max(0.25, Math.min(40, ref.scale * factor)),
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useVectorStore.getState().setRefTool('none');
      }
    };

    container.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);

    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [activeWorkspaceMode, vectorRefTool, vectorRefEditPlane, cameraType]);

  // Per-mesh nearest-filter textures (active mesh uses live paint canvas)
  useEffect(() => {
    let cancelled = false;
    const map = meshTexturesRef.current;
    const keep = new Set<string>();

    const styleTexture = (texture: THREE.Texture) => {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      // Keep flipY=false so imported atlases match the UV editor (canvas top = upright image).
      // CAD face UVs typically have v=0 on the "top" of a face, which lines up with canvas y=0.
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    };

    meshes.forEach((m) => {
      keep.add(m.id);

      if (m.id === activeMeshId && textureCanvas && textureCanvas.width > 0 && textureCanvas.height > 0) {
        const key = `live:${textureRevision}:${textureCanvas.width}x${textureCanvas.height}`;
        const prev = map.get(m.id);
        if (
          prev &&
          prev.key.startsWith('live:') &&
          (prev.texture as THREE.CanvasTexture).image === textureCanvas
        ) {
          prev.key = key;
          prev.texture.needsUpdate = true;
          return;
        }
        prev?.texture.dispose();
        const texture = styleTexture(new THREE.CanvasTexture(textureCanvas));
        map.set(m.id, { key, texture });
        // New texture object — rebuild materials once. Do NOT tie mesh rebuild to
        // every live paint stamp (textureRevision); that caused mid-stroke jitter
        // and a second offset pen.
        setMeshTextureTick((t) => t + 1);
        return;
      }

      const url = m.textureCanvasDataUrl;
      if (!url) {
        const prev = map.get(m.id);
        if (prev) {
          prev.texture.dispose();
          map.delete(m.id);
        }
        return;
      }

      const existing = map.get(m.id);
      if (existing?.key === url) return;

      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const still = meshes.find((x) => x.id === m.id)?.textureCanvasDataUrl;
        if (still !== url) return;
        map.get(m.id)?.texture.dispose();
        const texture = styleTexture(new THREE.Texture(img));
        map.set(m.id, { key: url, texture });
        setMeshTextureTick((t) => t + 1);
      };
      img.src = url;
    });

    [...map.keys()].forEach((id) => {
      if (!keep.has(id)) {
        map.get(id)?.texture.dispose();
        map.delete(id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [meshes, activeMeshId, textureCanvas, textureRevision]);

  // Live paint stamps: needsUpdate only — no App setState / effect re-walk.
  useEffect(() => {
    return () => {
      cancelTexturePreviewNotify();
    };
  }, []);

  useEffect(() => {
    return subscribeTexturePreview(() => {
      const entry = meshTexturesRef.current.get(activeMeshId);
      if (!entry) return;
      const image = entry.texture.image as { width?: number; height?: number } | undefined;
      if (!image || !image.width || !image.height) return;
      // Only refresh GPU upload — never reassign image to a stale React prop mid-stroke
      // (that stole the live composite and made 3D paint look dead).
      entry.texture.needsUpdate = true;
    });
  }, [activeMeshId]);

  // Live lighting, fog, and background from render settings / weather
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = renderSettings.ambientIntensity ?? 1.45;
    }
    if (dirLightRef.current) {
      dirLightRef.current.intensity = renderSettings.lightIntensity ?? 2.5;
      const elev = renderSettings.sunElevation ?? 48;
      const az = renderSettings.sunAzimuth ?? 39;
      const el = (elev * Math.PI) / 180;
      const azr = (az * Math.PI) / 180;
      dirLightRef.current.position.set(
        Math.cos(el) * Math.sin(azr) * 20,
        Math.sin(el) * 20,
        Math.cos(el) * Math.cos(azr) * 20,
      );
    }
    scene.background = new THREE.Color(renderSettings.bgColor || '#1b1b1b');
    const fogDensity = renderSettings.fogDensity ?? 0;
    if (fogDensity > 0.001) {
      scene.fog = new THREE.FogExp2(renderSettings.fogColor || '#a8b4c4', fogDensity);
    } else {
      scene.fog = null;
    }
  }, [
    renderSettings.ambientIntensity,
    renderSettings.lightIntensity,
    renderSettings.bgColor,
    renderSettings.fogDensity,
    renderSettings.fogColor,
    renderSettings.sunElevation,
    renderSettings.sunAzimuth,
  ]);

  // Full 3D Rotation Gizmo & Mode Switcher
  useEffect(() => {
    if (!transformControlsRef.current || !dummyTargetRef.current) return;
    const tControls = transformControlsRef.current;
    const dummy = dummyTargetRef.current;

    if (toolState.transformMode === 'rotate') {
      tControls.setMode('rotate');
    } else if (toolState.transformMode === 'scale') {
      tControls.setMode('scale');
    } else {
      tControls.setMode('translate');
    }

    // TransformControls inherits object scale — leftover S-mode scale inflates the
    // orange plane helpers and makes translate/rotate feel broken.
    dummy.scale.set(1, 1, 1);
    if (toolState.editMode === 'vertex' || toolState.editMode === 'edge' || toolState.editMode === 'face') {
      dummy.rotation.set(0, 0, 0);
      dummy.quaternion.identity();
    }
  }, [toolState.transformMode, toolState.editMode]);

  // Cameras / lights / particles / weather helpers (selectable scene objects)
  // Hidden entirely in Model view — ANIM workspace owns these scene objects.
  useEffect(() => {
    if (modalActiveRef.current) return;
    if (transformControlsRef.current?.dragging) return;
    const group = sceneHelpersGroupRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }

    // Viewport3D is used for Model / Paint — scene helpers live in ANIM (CutsceneStudio).
    if (activeWorkspaceMode !== 'animation') return;

    const sel = sceneSelection;
    cameras.forEach((cam) => {
      group.add(createCameraHelper(cam, sel?.kind === 'camera' && sel.id === cam.id));
    });
    lights.forEach((L) => {
      group.add(createLightHelper(L, sel?.kind === 'light' && sel.id === L.id));
    });
    particles.forEach((p) => {
      group.add(createParticleHelper(p, sel?.kind === 'particle' && sel.id === p.id));
    });
    if (environment && environment.visible === true) {
      group.add(createWeatherHelper(environment, sel?.kind === 'weather'));
    }
  }, [cameras, lights, particles, environment, sceneSelection, activeWorkspaceMode]);

  // Blender-style modal G/R/S: mouse-move applies transform to mesh; LMB confirms; Esc/RMB cancels.
  // Depends ONLY on modalTransform — any other dep would tear down the grab mid-drag and fight the object.
  useEffect(() => {
    const modal = toolState.modalTransform;
    const meshNow = activeMeshRef.current;
    const sceneSel = sceneSelectionRef.current;
    const isSceneObj = Boolean(sceneSel && sceneSel.kind !== 'mesh');
    if (!modal || !dummyTargetRef.current || (!meshNow && !isSceneObj)) {
      modalActiveRef.current = false;
      return;
    }

    modalActiveRef.current = true;
    onBeginHistoryRef.current?.();

    const dummy = dummyTargetRef.current;
    const ts = toolStateRef.current;
    const baseMesh: CADMesh | null = meshNow ? JSON.parse(JSON.stringify(meshNow)) : null;
    meshSnapshotRef.current = baseMesh;

    const editMode = ts.editMode;
    const gridSnap = ts.gridSnap || 0;
    const boneId = selectedBoneIdRef.current;
    const sceneSelSnap = sceneSel ? { ...sceneSel } : null;

    // Snapshot scene-object PRS for cancel
    let sceneBase: { position: Vector3D; rotation: Vector3D; scale: Vector3D } | null = null;
    if (sceneSelSnap?.kind === 'camera') {
      const cam = camerasRef.current.find((c) => c.id === sceneSelSnap.id);
      if (cam) sceneBase = { position: { ...cam.position }, rotation: { ...cam.rotation }, scale: { x: 1, y: 1, z: 1 } };
    } else if (sceneSelSnap?.kind === 'light') {
      const L = lightsRef.current.find((c) => c.id === sceneSelSnap.id);
      if (L) sceneBase = { position: { ...L.position }, rotation: { ...L.rotation }, scale: { ...L.scale } };
    } else if (sceneSelSnap?.kind === 'particle') {
      const p = particlesRef.current.find((c) => c.id === sceneSelSnap.id);
      if (p) sceneBase = { position: { ...p.position }, rotation: { ...p.rotation }, scale: { ...(p.scale || { x: 1, y: 1, z: 1 }) } };
    } else if (sceneSelSnap?.kind === 'weather' && environmentRef.current) {
      const env = environmentRef.current;
      sceneBase = {
        position: { ...(env.position || { x: 0, y: 2, z: 0 }) },
        rotation: { ...(env.rotation || { x: 0, y: 0, z: 0 }) },
        scale: { ...(env.scale || { x: 1, y: 1, z: 1 }) },
      };
    }

    // Collect edit verts from snapshot + selection at modal start
    let editIds = new Set<string>();
    if (baseMesh && editMode === 'vertex') {
      editIds = new Set(selectedVertexIdsRef.current);
    } else if (baseMesh && editMode === 'edge') {
      baseMesh.edges.forEach((e) => {
        if (selectedEdgeIdsRef.current.includes(e.id)) {
          editIds.add(e.v1Id);
          editIds.add(e.v2Id);
        }
      });
    } else if (baseMesh && editMode === 'face') {
      baseMesh.faces.forEach((f) => {
        if (selectedFaceIdsRef.current.includes(f.id)) f.vertexIds.forEach((id) => editIds.add(id));
      });
    }

    let centroid: THREE.Vector3 | null = null;
    if (sceneBase) {
      centroid = new THREE.Vector3(sceneBase.position.x, sceneBase.position.y, sceneBase.position.z);
      dummy.rotation.set(sceneBase.rotation.x, sceneBase.rotation.y, sceneBase.rotation.z);
      dummy.scale.set(sceneBase.scale.x, sceneBase.scale.y, sceneBase.scale.z);
    } else if (baseMesh && editMode === 'object') {
      centroid = new THREE.Vector3(baseMesh.position.x, baseMesh.position.y, baseMesh.position.z);
      dummy.rotation.set(baseMesh.rotation.x, baseMesh.rotation.y, baseMesh.rotation.z);
      dummy.scale.set(baseMesh.scale.x, baseMesh.scale.y, baseMesh.scale.z);
    } else if (editMode === 'bone' && boneId) {
      const world = getBoneWorldMatrices(bonesRef.current, false).get(boneId);
      if (world) centroid = new THREE.Vector3().setFromMatrixPosition(world);
    } else if (baseMesh && editIds.size) {
      const c = new THREE.Vector3();
      let n = 0;
      baseMesh.vertices.forEach((v) => {
        if (!editIds.has(v.id)) return;
        c.add(localToWorld(baseMesh, v.x, v.y, v.z));
        n++;
      });
      if (n) centroid = c.divideScalar(n);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
    }

    if (centroid) {
      dummy.position.copy(centroid);
      dragStartGizmoPosRef.current.copy(centroid);
    }

    initialVertsMapRef.current.clear();
    baseMesh?.vertices.forEach((v) => {
      initialVertsMapRef.current.set(v.id, { x: v.x, y: v.y, z: v.z });
    });

    const startPos = dummy.position.clone();
    const startRot = dummy.rotation.clone();
    const startScl = dummy.scale.clone();
    let originX = 0;
    let originY = 0;
    let started = false;
    const cam = cameraRef.current;
    const openedAt = performance.now();

    if (controlsRef.current) controlsRef.current.enabled = false;
    // Fully detach TransformControls so it cannot fight free grab.
    const tc = transformControlsRef.current;
    if (tc) {
      tc.enabled = false;
      tc.detach();
      tc.getHelper().visible = false;
    }

    let pendingVerts: CADMesh['vertices'] | null = null;
    let rafId = 0;
    let finished = false;

    const findSceneHelper = () => {
      if (!sceneSelSnap || !sceneHelpersGroupRef.current) return null;
      return (
        sceneHelpersGroupRef.current.children.find(
          (c) => c.userData?.sceneKind === sceneSelSnap.kind && c.userData?.sceneId === sceneSelSnap.id,
        ) || null
      );
    };

    const applyLiveObjectPrs = () => {
      // Never drag the mesh when the modal targets a light/camera/particle/weather.
      const transformingScene = Boolean(sceneSelSnap && sceneSelSnap.kind !== 'mesh');
      if (
        !transformingScene &&
        baseMesh &&
        (editMode === 'object' || (editIds.size === 0 && editMode !== 'bone'))
      ) {
        meshesGroupRef.current?.traverse((obj) => {
          if (obj.userData?.meshId === baseMesh.id) {
            obj.position.copy(dummy.position);
            obj.rotation.copy(dummy.rotation);
            obj.scale.copy(dummy.scale);
          }
        });
        if (activeMeshObjectRef.current && activeMeshObjectRef.current.userData?.meshId === baseMesh.id) {
          activeMeshObjectRef.current.position.copy(dummy.position);
          activeMeshObjectRef.current.rotation.copy(dummy.rotation);
          activeMeshObjectRef.current.scale.copy(dummy.scale);
        }
      }
      const helper = findSceneHelper();
      if (helper) {
        helper.position.copy(dummy.position);
        helper.rotation.copy(dummy.rotation);
        helper.scale.copy(dummy.scale);
      }
    };

    const previewComponentVerts = () => {
      if (!baseMesh || editIds.size === 0) return;
      let dx = dummy.position.x - startPos.x;
      let dy = dummy.position.y - startPos.y;
      let dz = dummy.position.z - startPos.z;
      const localDelta = worldDeltaToLocal(baseMesh, dx, dy, dz);

      if (modal === 'scale') {
        const f = Math.max(0.05, dummy.scale.x / Math.max(0.001, startScl.x));
        const center = new THREE.Vector3();
        let count = 0;
        baseMesh.vertices.forEach((v) => {
          if (!editIds.has(v.id)) return;
          center.add(new THREE.Vector3(v.x, v.y, v.z));
          count++;
        });
        if (count) center.divideScalar(count);
        pendingVerts = baseMesh.vertices.map((v) => {
          if (!editIds.has(v.id)) return v;
          return {
            ...v,
            x: center.x + (v.x - center.x) * f,
            y: center.y + (v.y - center.y) * f,
            z: center.z + (v.z - center.z) * f,
          };
        });
      } else if (modal === 'rotate') {
        const dRot = new THREE.Euler(dummy.rotation.x - startRot.x, dummy.rotation.y - startRot.y, dummy.rotation.z - startRot.z);
        const q = new THREE.Quaternion().setFromEuler(dRot);
        const center = new THREE.Vector3();
        let count = 0;
        baseMesh.vertices.forEach((v) => {
          if (!editIds.has(v.id)) return;
          center.add(new THREE.Vector3(v.x, v.y, v.z));
          count++;
        });
        if (count) center.divideScalar(count);
        pendingVerts = baseMesh.vertices.map((v) => {
          if (!editIds.has(v.id)) return v;
          const p = new THREE.Vector3(v.x - center.x, v.y - center.y, v.z - center.z);
          p.applyQuaternion(q);
          return { ...v, x: center.x + p.x, y: center.y + p.y, z: center.z + p.z };
        });
      } else {
        pendingVerts = baseMesh.vertices.map((v) => {
          if (!editIds.has(v.id)) return v;
          const init = initialVertsMapRef.current.get(v.id) || v;
          return { ...v, x: init.x + localDelta.x, y: init.y + localDelta.y, z: init.z + localDelta.z };
        });
      }

      // Live vertex handle preview + mesh surface — CAD commits on mouse up.
      if (pendingVerts && baseMesh) {
        const byId = new Map(pendingVerts.map((v) => [v.id, v]));
        if (verticesGroupRef.current) {
          verticesGroupRef.current.children.forEach((cube) => {
            const id = cube.userData?.vertexId as string | undefined;
            if (!id || !editIds.has(id)) return;
            const v = byId.get(id);
            if (!v) return;
            cube.position.copy(localToWorld(baseMesh, v.x, v.y, v.z));
          });
        }
        if (edgesGroupRef.current) {
          edgesGroupRef.current.children.forEach((obj) => {
            const edgeId = obj.userData?.edgeId as string | undefined;
            if (!edgeId) return;
            const edge = baseMesh.edges.find((e) => e.id === edgeId);
            if (!edge) return;
            const v1 = byId.get(edge.v1Id);
            const v2 = byId.get(edge.v2Id);
            if (!v1 || !v2) return;
            const line = obj as THREE.Line;
            const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
            pos.setXYZ(0, v1.x, v1.y, v1.z);
            pos.setXYZ(1, v2.x, v2.y, v2.z);
            pos.needsUpdate = true;
          });
        }
        const previewMesh: CADMesh = { ...baseMesh, vertices: pendingVerts };
        meshesGroupRef.current?.children.forEach((obj) => {
          if (obj.userData?.meshId !== baseMesh.id) return;
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.geometry.dispose();
            mesh.geometry = buildThreeGeometry(previewMesh);
          } else if ((obj as THREE.LineSegments).isLineSegments) {
            const lines = obj as THREE.LineSegments;
            lines.geometry.dispose();
            lines.geometry = buildLogicalEdgeGeometry(previewMesh);
          }
        });
      }
    };

    const schedulePreview = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applyLiveObjectPrs();
        if (editMode === 'vertex' || editMode === 'edge' || editMode === 'face') {
          previewComponentVerts();
        }
      });
    };

    const commitFinal = () => {
      const step = gridSnap;
      const snapP = (v: number) => (step > 0 ? snapToGrid(v, step) : v);

      if (sceneSelSnap && sceneBase) {
        const p = {
          x: snapP(dummy.position.x),
          y: snapP(dummy.position.y),
          z: snapP(dummy.position.z),
        };
        const rot = { x: dummy.rotation.x, y: dummy.rotation.y, z: dummy.rotation.z };
        const scl = {
          x: Math.max(0.01, dummy.scale.x),
          y: Math.max(0.01, dummy.scale.y),
          z: Math.max(0.01, dummy.scale.z),
        };
        if (sceneSelSnap.kind === 'camera' && setCamerasRef.current) {
          setCamerasRef.current((prev) => prev.map((c) => (c.id === sceneSelSnap.id ? { ...c, position: p, rotation: rot, lookAt: null } : c)));
        } else if (sceneSelSnap.kind === 'light' && setLightsRef.current) {
          setLightsRef.current((prev) =>
            prev.map((L) =>
              L.id === sceneSelSnap.id
                ? { ...L, position: p, rotation: rot, scale: scl, distance: lightDistanceFromScale(scl, L.type) || L.distance }
                : L,
            ),
          );
        } else if (sceneSelSnap.kind === 'particle' && setParticlesRef.current) {
          setParticlesRef.current((prev) => prev.map((fx) => (fx.id === sceneSelSnap.id ? { ...fx, position: p, rotation: rot, scale: scl } : fx)));
        } else if (sceneSelSnap.kind === 'weather' && setEnvironmentRef.current) {
          setEnvironmentRef.current((prev) => ({ ...prev, position: p, rotation: rot, scale: scl }));
        }
        return;
      }

      if (!baseMesh) return;

      if (editMode === 'bone' && boneId && setBonesRef.current) {
        const bone = bonesRef.current.find((b) => b.id === boneId);
        if (!bone || bone.locked) return;
        const worldMatrix = new THREE.Matrix4().compose(dummy.position.clone(), dummy.quaternion.clone(), dummy.scale.clone());
        const parent = bone.parentId ? bonesRef.current.find((b) => b.id === bone.parentId) : null;
        const parentWorld = parent
          ? getBoneWorldMatrices(bonesRef.current, false).get(parent.id) || new THREE.Matrix4()
          : new THREE.Matrix4();
        const localMatrix = parentWorld.clone().invert().multiply(worldMatrix);
        const localPos = new THREE.Vector3();
        const localQuat = new THREE.Quaternion();
        const localScl = new THREE.Vector3();
        localMatrix.decompose(localPos, localQuat, localScl);
        const localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'XYZ');
        const rigMode = toolStateRef.current.rigMode;
        setBonesRef.current((currentBones) =>
          currentBones.map((b) => {
            if (b.id !== boneId) return b;
            const next = {
              ...b,
              position: { x: snapP(localPos.x), y: snapP(localPos.y), z: snapP(localPos.z) },
              rotation: { x: localEuler.x, y: localEuler.y, z: localEuler.z },
              scale: { x: localScl.x, y: localScl.y, z: localScl.z },
            };
            if (rigMode === 'edit') {
              next.restPosition = { ...next.position };
              next.restRotation = { ...next.rotation };
              next.restScale = { ...next.scale };
            }
            return next;
          }),
        );
        return;
      }

      if (editMode === 'object' || (editIds.size === 0 && editMode !== 'bone')) {
        if (modal === 'rotate') {
          setMeshRef.current({ ...baseMesh, rotation: { x: dummy.rotation.x, y: dummy.rotation.y, z: dummy.rotation.z } });
        } else if (modal === 'scale') {
          setMeshRef.current({
            ...baseMesh,
            scale: {
              x: Math.max(0.01, dummy.scale.x),
              y: Math.max(0.01, dummy.scale.y),
              z: Math.max(0.01, dummy.scale.z),
            },
          });
        } else {
          setMeshRef.current({
            ...baseMesh,
            position: {
              x: snapP(dummy.position.x),
              y: snapP(dummy.position.y),
              z: snapP(dummy.position.z),
            },
          });
        }
        return;
      }

      previewComponentVerts();
      if (pendingVerts) {
        setMeshRef.current({ ...baseMesh, vertices: pendingVerts, revision: (baseMesh.revision || 0) + 1 });
      }
    };

    const restoreGizmo = () => {
      if (!tc || !dummyTargetRef.current) return;
      tc.attach(dummyTargetRef.current);
      tc.enabled = true;
      tc.getHelper().visible = true;
    };

    const applyModal = (clientX: number, clientY: number) => {
      if (!started) {
        originX = clientX;
        originY = clientY;
        started = true;
      }
      const dx = clientX - originX;
      const dy = clientY - originY;
      if (modal === 'translate') {
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3(0, 1, 0);
        if (cam) {
          right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
          up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
        }
        const sens = 0.018;
        dummy.position.copy(startPos).addScaledVector(right, dx * sens).addScaledVector(up, -dy * sens);
      } else if (modal === 'rotate') {
        const sens = 0.014;
        dummy.rotation.set(startRot.x + dy * sens, startRot.y + dx * sens, startRot.z);
      } else {
        const sens = 0.01;
        const f = Math.max(0.05, 1 + dx * sens - dy * sens * 0.35);
        dummy.scale.set(startScl.x * f, startScl.y * f, startScl.z * f);
      }
      schedulePreview();
    };

    const confirm = () => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      commitFinal();
      modalActiveRef.current = false;
      meshSnapshotRef.current = null;
      restoreGizmo();
      setToolStateRef.current((s) => ({ ...s, modalTransform: null }));
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      dummy.position.copy(startPos);
      dummy.rotation.copy(startRot);
      dummy.scale.copy(startScl);
      applyLiveObjectPrs();
      if (baseMesh) setMeshRef.current({ ...baseMesh });
      modalActiveRef.current = false;
      meshSnapshotRef.current = null;
      restoreGizmo();
      setToolStateRef.current((s) => ({ ...s, modalTransform: null }));
    };
    const onMove = (e: PointerEvent) => applyModal(e.clientX, e.clientY);
    const onUp = (e: PointerEvent) => {
      // Ignore the pointerup that may still be in-flight from the click that preceded G,
      // and require a real mouse move before LMB confirms.
      if (performance.now() - openedAt < 120) return;
      if (e.button === 0) {
        if (!started) return;
        confirm();
      } else if (e.button === 2) {
        cancel();
      }
    };
    const onContext = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        confirm();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey, true);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
      const cur = toolStateRef.current;
      // If modal is still active, this cleanup is a remount — keep grab ownership.
      if (cur.modalTransform) {
        modalActiveRef.current = true;
        return;
      }
      modalActiveRef.current = false;
      if (controlsRef.current) {
        controlsRef.current.enabled = !cur.isCadDrawing && !cur.placeOnClick;
      }
      if (!finished) restoreGizmo();
    };
  }, [toolState.modalTransform]);


  // Blender-style modal Extrude / Inset / Bevel — topology once, verts follow mouse (live Three).
  useEffect(() => {
    const op = toolState.modalMeshOp;
    if (!op || op === 'loopCut' || op === 'knife') {
      if (op !== 'loopCut' && op !== 'knife') meshOpFreezeRef.current = null;
      return;
    }
    // In quad view only the perspective pane owns the modal (avoids 4 sessions fighting).
    if (isQuadSubViewport && cameraType !== 'perspective') return;

    const confirmCb = () => onModalMeshConfirmRef.current?.();
    const cancelCb = () => onModalMeshCancelRef.current?.();
    if (!onModalMeshConfirmRef.current || !onModalMeshCancelRef.current) return;

    // Freeze once per op so preview setMesh / Strict Mode remount can't re-bevel a beveled mesh.
    if (!meshOpFreezeRef.current || meshOpFreezeRef.current.op !== op) {
      const src = activeMeshRef.current;
      if (!src) {
        cancelCb();
        return;
      }
      meshOpFreezeRef.current = {
        op,
        mesh: JSON.parse(JSON.stringify(src)) as CADMesh,
        faceIds: [...selectedFaceIdsRef.current],
        edgeIds: [...selectedEdgeIdsRef.current],
      };
    }
    const frozen = meshOpFreezeRef.current;
    const baseMesh = frozen.mesh;
    const faceIds = frozen.faceIds;
    const edgeIds = frozen.edgeIds;

    modalActiveRef.current = true;
    if (facesHighlightGroupRef.current) facesHighlightGroupRef.current.visible = false;
    if (controlsRef.current) controlsRef.current.enabled = false;
    const tc = transformControlsRef.current;
    if (tc) {
      tc.enabled = false;
      tc.detach();
      tc.getHelper().visible = false;
    }

    let segments = 1;
    let session: ModalMeshSession | null = beginModalMeshOp(
      op,
      JSON.parse(JSON.stringify(baseMesh)) as CADMesh,
      faceIds,
      edgeIds,
      segments,
    );
    if (!session) {
      meshOpFreezeRef.current = null;
      modalActiveRef.current = false;
      if (facesHighlightGroupRef.current) facesHighlightGroupRef.current.visible = true;
      cancelCb();
      return;
    }

    // Seed a visible starting amount so Extrude/Inset/Bevel are obvious immediately.
    const initialAmount = op === 'extrude' ? 0 : op === 'bevel' ? 0.12 : 0.15;
    session = applyModalAmount(session, initialAmount);

    const openedAt = performance.now();
    let originX = 0;
    let originY = 0;
    let started = false;
    let finished = false;
    let rafId = 0;
    let pendingAmount: number | null = null;
    let liveMesh = session.mesh;
    const seedAmount = session.amount;
    let modalWire: THREE.LineSegments | null = null;

    const clearModalWire = () => {
      if (!modalWire) return;
      modalWire.parent?.remove(modalWire);
      disposeObject3D(modalWire);
      modalWire = null;
    };

    const setStaticMeshWiresVisible = (visible: boolean) => {
      meshesGroupRef.current?.children.forEach((child) => {
        if (child.userData?.meshId === baseMesh.id && (child as THREE.LineSegments).isLineSegments) {
          child.visible = visible;
        }
      });
    };
    setStaticMeshWiresVisible(false);

    const paintLive = (mesh: CADMesh) => {
      liveMesh = mesh;
      let target: THREE.Mesh | null =
        activeMeshObjectRef.current && activeMeshObjectRef.current.userData?.meshId === baseMesh.id
          ? activeMeshObjectRef.current
          : null;
      if (!target && meshesGroupRef.current) {
        const found = meshesGroupRef.current.children.find(
          (c) => c instanceof THREE.Mesh && c.userData?.meshId === baseMesh.id,
        );
        if (found instanceof THREE.Mesh) target = found;
      }
      if (target) {
        const old = target.geometry;
        target.geometry = buildThreeGeometry(mesh);
        old.dispose();
        activeMeshObjectRef.current = target;
      }

      clearModalWire();
      if (meshesGroupRef.current) {
        const wireGeo = buildLogicalEdgeGeometry(mesh);
        const wireMat = new THREE.LineBasicMaterial({
          color: 0xed7300,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        modalWire = new THREE.LineSegments(wireGeo, wireMat);
        modalWire.renderOrder = 50;
        modalWire.userData = { modalWire: true, meshId: baseMesh.id };
        if (target) {
          modalWire.position.copy(target.position);
          modalWire.rotation.copy(target.rotation);
          modalWire.scale.copy(target.scale);
        } else {
          modalWire.position.set(baseMesh.position.x, baseMesh.position.y, baseMesh.position.z);
          modalWire.rotation.set(baseMesh.rotation.x, baseMesh.rotation.y, baseMesh.rotation.z);
          modalWire.scale.set(baseMesh.scale.x, baseMesh.scale.y, baseMesh.scale.z);
        }
        meshesGroupRef.current.add(modalWire);
      }

      // Keep CAD mesh in sync so confirm/cancel and other panes see the preview.
      setMeshRef.current({ ...mesh, id: baseMesh.id, revision: (baseMesh.revision || 0) + 1 });
    };

    paintLive(liveMesh);

    const amountFromDelta = (dx: number, dy: number) => {
      if (op === 'extrude') return (dx - dy) * 0.01;
      const dist = Math.hypot(dx, dy);
      if (op === 'bevel') {
        return Math.max(0.02, Math.min(0.5, seedAmount + dist * 0.008));
      }
      return Math.max(0.02, Math.min(0.92, seedAmount + dist * 0.012));
    };

    const flushPreview = () => {
      rafId = 0;
      if (pendingAmount == null || !session) return;
      const amount = pendingAmount;
      pendingAmount = null;
      session = applyModalAmount(session, amount);
      paintLive(session.mesh);
    };

    const rebuildBevelSegments = (nextSegs: number) => {
      if (op !== 'bevel' || !session) return;
      const amount = session.amount ?? seedAmount;
      segments = Math.max(1, Math.min(8, nextSegs));
      const fresh = beginModalMeshOp(
        'bevel',
        JSON.parse(JSON.stringify(baseMesh)) as CADMesh,
        faceIds,
        edgeIds,
        segments,
      );
      if (!fresh) return;
      session = applyModalAmount(fresh, amount);
      paintLive(session.mesh);
    };

    const confirm = () => {
      if (finished || !session) return;
      finished = true;
      clearModalWire();
      setStaticMeshWiresVisible(true);
      const finalMesh = {
        ...session.mesh,
        id: baseMesh.id,
        revision: (baseMesh.revision || 0) + 1,
      };
      setMeshRef.current(finalMesh);
      if (session.resultFaceIds.length > 0) {
        setSelectedFaceIds(session.resultFaceIds);
        setSelectedEdgeIds?.([]);
        setSelectedVertexIds([]);
        setToolStateRef.current((s) => ({ ...s, editMode: 'face' }));
      }
      meshOpFreezeRef.current = null;
      modalActiveRef.current = false;
      confirmCb();
    };

    const cancel = () => {
      if (finished) return;
      finished = true;
      clearModalWire();
      setStaticMeshWiresVisible(true);
      meshOpFreezeRef.current = null;
      modalActiveRef.current = false;
      cancelCb();
    };

    const onMove = (e: PointerEvent) => {
      if (finished) return;
      if (!started) {
        originX = e.clientX;
        originY = e.clientY;
        started = true;
        pendingAmount = amountFromDelta(0, 0);
        if (!rafId) rafId = requestAnimationFrame(flushPreview);
        return;
      }
      pendingAmount = amountFromDelta(e.clientX - originX, e.clientY - originY);
      if (!rafId) rafId = requestAnimationFrame(flushPreview);
    };
    const onUp = (e: PointerEvent) => {
      if (finished) return;
      // Ignore the pointerup that may still be in-flight from the click that started the op.
      if (performance.now() - openedAt < 160) return;
      if (e.button === 0) confirm();
      else if (e.button === 2) cancel();
    };
    const onContext = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      if (op !== 'bevel' || finished) return;
      e.preventDefault();
      e.stopPropagation();
      rebuildBevelSegments(segments + (e.deltaY < 0 ? 1 : -1));
    };
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        confirm();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      clearModalWire();
      setStaticMeshWiresVisible(true);
      const cur = toolStateRef.current;
      // Strict Mode remount / dep refresh while op still active — keep ownership + freeze.
      if (!finished && (cur.modalMeshOp === 'extrude' || cur.modalMeshOp === 'inset' || cur.modalMeshOp === 'bevel')) {
        modalActiveRef.current = true;
        return;
      }
      if (!finished) {
        meshOpFreezeRef.current = null;
        modalActiveRef.current = false;
      }
      if (facesHighlightGroupRef.current) facesHighlightGroupRef.current.visible = true;
      if (controlsRef.current) {
        controlsRef.current.enabled = !toolStateRef.current.isCadDrawing && !toolStateRef.current.placeOnClick;
      }
    };
  }, [toolState.modalMeshOp, isQuadSubViewport, cameraType, setSelectedFaceIds, setSelectedEdgeIds, setSelectedVertexIds]);

  // Blender-style Loop Cut (Ctrl+R): hover edge → pin → slide / wheel → LMB confirm
  useEffect(() => {
    if (toolState.modalMeshOp !== 'loopCut' || !onModalLoopCutConfirm || !onModalMeshCancel) return;

    if (controlsRef.current) controlsRef.current.enabled = false;

    let phase: 'hover' | 'slide' = 'hover';
    let loopEdgeIds: string[] = [];
    let cutCount = 1;
    let slide = 0.5;
    let pinX = 0;
    let ignoreUp = true;

    const clearPreview = () => {
      const g = cutPreviewGroupRef.current;
      if (!g) return;
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        disposeObject3D(c);
      }
    };

    const factorsNow = () => {
      const base = loopCutFactors(cutCount);
      const offset = slide - 0.5;
      return base.map((f) => Math.max(0.05, Math.min(0.95, f + offset)));
    };

    const drawPreview = (mesh: CADMesh, edges: string[], factors: number[]) => {
      clearPreview();
      const g = cutPreviewGroupRef.current;
      if (!g || edges.length === 0) return;
      const lines = getLoopCutPreviewPolylines(mesh, edges, factors);
      const positions: number[] = [];
      lines.forEach((pts) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = localToWorld(mesh, pts[i].x, pts[i].y, pts[i].z);
          const b = localToWorld(mesh, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      });
      if (!positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffee00,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const segs = new THREE.LineSegments(geo, mat);
      segs.renderOrder = 999;
      g.add(segs);
    };

    const pickEdgeNearPointer = (clientX: number, clientY: number): string | null =>
      pickClosestEdgeIdRef.current(clientX, clientY, activeMeshRef.current);

    const onMove = (e: PointerEvent) => {
      const mesh = activeMeshRef.current;
      if (!mesh) return;
      if (phase === 'hover') {
        const edgeId = pickEdgeNearPointer(e.clientX, e.clientY);
        if (!edgeId) {
          loopEdgeIds = [];
          clearPreview();
          return;
        }
        loopEdgeIds = findEdgeLoop(mesh, edgeId);
        drawPreview(mesh, loopEdgeIds, factorsNow());
      } else {
        slide = Math.max(0.05, Math.min(0.95, 0.5 + (e.clientX - pinX) * 0.0025));
        drawPreview(mesh, loopEdgeIds, factorsNow());
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        clearPreview();
        onModalMeshCancel();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const mesh = activeMeshRef.current;
      if (!mesh) return;
      if (phase === 'hover') {
        if (loopEdgeIds.length === 0) {
          const edgeId = pickEdgeNearPointer(e.clientX, e.clientY);
          if (!edgeId) return;
          loopEdgeIds = findEdgeLoop(mesh, edgeId);
        }
        if (loopEdgeIds.length === 0) return;
        phase = 'slide';
        pinX = e.clientX;
        ignoreUp = true;
        drawPreview(mesh, loopEdgeIds, factorsNow());
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || phase !== 'slide') return;
      if (ignoreUp) {
        ignoreUp = false;
        return;
      }
      clearPreview();
      onModalLoopCutConfirm(loopEdgeIds, factorsNow());
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const mesh = activeMeshRef.current;
      if (!mesh || loopEdgeIds.length === 0) return;
      cutCount = Math.max(1, Math.min(8, cutCount + (e.deltaY < 0 ? 1 : -1)));
      drawPreview(mesh, loopEdgeIds, factorsNow());
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearPreview();
        onModalMeshCancel();
      }
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContext);
    return () => {
      clearPreview();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContext);
      if (controlsRef.current) {
        controlsRef.current.enabled = !toolState.isCadDrawing && !toolState.placeOnClick;
      }
    };
  }, [
    toolState.modalMeshOp,
    onModalLoopCutConfirm,
    onModalMeshCancel,
    toolState.isCadDrawing,
    toolState.placeOnClick,
    toolState.isPainting3D,
  ]);

  // Blender-style Knife (K): click polyline · Z undo · Enter confirm · Esc/RMB cancel
  useEffect(() => {
    if (toolState.modalMeshOp !== 'knife' || !onModalKnifeConfirm || !onModalMeshCancel) return;

    if (controlsRef.current) controlsRef.current.enabled = false;

    const hits: KnifeHit[] = [];
    let ignoreFirstUp = true;

    const clearPreview = () => {
      const g = cutPreviewGroupRef.current;
      if (!g) return;
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        disposeObject3D(c);
      }
    };

    const drawPreview = (mesh: CADMesh) => {
      clearPreview();
      const g = cutPreviewGroupRef.current;
      if (!g || hits.length === 0) return;
      const positions: number[] = [];
      hits.forEach((h, i) => {
        const w = localToWorld(mesh, h.point.x, h.point.y, h.point.z);
        if (i > 0) {
          const prev = hits[i - 1];
          const pw = localToWorld(mesh, prev.point.x, prev.point.y, prev.point.z);
          positions.push(pw.x, pw.y, pw.z, w.x, w.y, w.z);
        }
        const dotGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffee00, depthTest: false });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(w);
        dot.renderOrder = 1000;
        g.add(dot);
      });
      if (positions.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffee00, depthTest: false });
        const segs = new THREE.LineSegments(geo, mat);
        segs.renderOrder = 999;
        g.add(segs);
      }
    };

    const projectT = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a);
      const len2 = ab.lengthSq();
      if (len2 < 1e-12) return 0.5;
      return Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2));
    };

    const pickHit = (clientX: number, clientY: number): KnifeHit | null => {
      const mesh = activeMeshRef.current;
      const cam = cameraRef.current;
      const el = containerRef.current;
      const meshObj = activeMeshObjectRef.current;
      if (!mesh || !cam || !el || !meshObj) return null;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);
      const intersects = raycaster.intersectObject(meshObj);
      if (!intersects.length || intersects[0].faceIndex == null) return null;
      const hit = intersects[0];
      const geo = meshObj.geometry as THREE.BufferGeometry;
      const triToFaceMap = geo.userData.triangleToFaceId as string[] | undefined;
      let faceId =
        triToFaceMap && triToFaceMap[hit.faceIndex]
          ? triToFaceMap[hit.faceIndex]
          : mesh.faces[Math.floor(hit.faceIndex / 2)]?.id;
      if (!faceId) return null;
      const face = mesh.faces.find((f) => f.id === faceId);
      if (!face) return null;

      const inv = meshObj.matrixWorld.clone().invert();
      const localPt = hit.point.clone().applyMatrix4(inv);
      const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
      const n = face.vertexIds.length;
      let bestEdgeId: string | undefined;
      let bestT = 0.5;
      let bestDist = 0.08;
      for (let i = 0; i < n; i++) {
        const va = vertMap.get(face.vertexIds[i]);
        const vb = vertMap.get(face.vertexIds[(i + 1) % n]);
        if (!va || !vb) continue;
        const a = new THREE.Vector3(va.x, va.y, va.z);
        const b = new THREE.Vector3(vb.x, vb.y, vb.z);
        const t = projectT(localPt, a, b);
        const closest = a.clone().lerp(b, t);
        const dist = closest.distanceTo(localPt);
        if (dist < bestDist) {
          bestDist = dist;
          bestT = t;
          const edge = mesh.edges.find(
            (ed) =>
              (ed.v1Id === face.vertexIds[i] && ed.v2Id === face.vertexIds[(i + 1) % n]) ||
              (ed.v2Id === face.vertexIds[i] && ed.v1Id === face.vertexIds[(i + 1) % n]),
          );
          bestEdgeId = edge?.id;
          localPt.copy(closest);
        }
      }
      return {
        faceId,
        edgeId: bestEdgeId,
        t: bestEdgeId ? bestT : undefined,
        point: { x: localPt.x, y: localPt.y, z: localPt.z },
      };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        clearPreview();
        onModalMeshCancel();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const mesh = activeMeshRef.current;
      if (!mesh) return;
      const hit = pickHit(e.clientX, e.clientY);
      if (!hit) return;
      hits.push(hit);
      drawPreview(mesh);
      ignoreFirstUp = false;
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (ignoreFirstUp) {
        ignoreFirstUp = false;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const mesh = activeMeshRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearPreview();
        onModalMeshCancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (hits.length < 2) return;
        clearPreview();
        onModalKnifeConfirm([...hits]);
        return;
      }
      if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hits.pop();
        if (mesh) drawPreview(mesh);
        else clearPreview();
      }
    };
    const onContext = (ev: Event) => ev.preventDefault();

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContext);
    return () => {
      clearPreview();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContext);
      if (controlsRef.current) {
        controlsRef.current.enabled = !toolState.isCadDrawing && !toolState.placeOnClick;
      }
    };
  }, [
    toolState.modalMeshOp,
    onModalKnifeConfirm,
    onModalMeshCancel,
    toolState.isCadDrawing,
    toolState.placeOnClick,
    toolState.isPainting3D,
  ]);

  // LightWave Interactive Drag Navigation Handlers
  const handleLightwaveDragPan = (deltaX: number, deltaY: number) => {
    if (!controlsRef.current || !cameraRef.current) return;
    const factor = 0.01;
    controlsRef.current.target.x -= deltaX * factor;
    controlsRef.current.target.y += deltaY * factor;
    cameraRef.current.position.x -= deltaX * factor;
    cameraRef.current.position.y += deltaY * factor;
    controlsRef.current.update();
  };

  const handleLightwaveDragOrbit = (deltaX: number, deltaY: number) => {
    if (!controlsRef.current || !cameraRef.current || cameraType !== 'perspective') return;
    const factor = 0.005;
    const offset = new THREE.Vector3().subVectors(cameraRef.current.position, controlsRef.current.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * factor;
    spherical.phi -= deltaY * factor;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    offset.setFromSpherical(spherical);
    cameraRef.current.position.copy(controlsRef.current.target).add(offset);
    cameraRef.current.lookAt(controlsRef.current.target);
    controlsRef.current.update();
  };

  const handleLightwaveDragZoom = (deltaX: number, deltaY: number) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    const delta = -(deltaX + deltaY) * 0.01;

    if (camera instanceof THREE.OrthographicCamera) {
      const zoomFactor = Math.pow(0.96, delta);
      camera.zoom = Math.max(0.05, Math.min(100, camera.zoom * zoomFactor));
      camera.updateProjectionMatrix();
    } else {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      camera.position.addScaledVector(dir, delta * 0.5);
    }
    controlsRef.current.update();
  };

  // Real-Time Mesh, Vertex, Edge, Face, CAD Ghost Preview, & Interactive Placement Ghost Renderer
  useEffect(() => {
    // Modal G/R/S / Extrude·Inset·Bevel owner sets modalActiveRef and owns live Three.js geometry.
    // Scene-object (light/camera/…) drags must still allow mesh rebuild so meshes don't stick to the gizmo.
    const meshOp = toolStateRef.current.modalMeshOp;
    const interactiveMeshOp = meshOp === 'extrude' || meshOp === 'inset' || meshOp === 'bevel';
    if (modalActiveRef.current || toolStateRef.current.modalTransform || interactiveMeshOp) return;
    const sceneSelNow = sceneSelectionRef.current;
    const draggingSceneObj =
      Boolean(transformControlsRef.current?.dragging) &&
      Boolean(sceneSelNow && sceneSelNow.kind !== 'mesh');
    if (
      transformControlsRef.current?.dragging &&
      (toolStateRef.current.editMode === 'object' ||
        toolStateRef.current.editMode === 'vertex' ||
        toolStateRef.current.editMode === 'edge' ||
        toolStateRef.current.editMode === 'face') &&
      !draggingSceneObj
    ) {
      return;
    }
    if (!meshesGroupRef.current) return;
    const mGroup = meshesGroupRef.current;

    while (mGroup.children.length > 0) {
      const child = mGroup.children[0];
      mGroup.remove(child);
      disposeObject3D(child);
    }

    clearAndDisposeGroup(verticesGroupRef.current);
    clearAndDisposeGroup(edgesGroupRef.current);

    if (bonesGroupRef.current) {
      while (bonesGroupRef.current.children.length > 0) {
        const child = bonesGroupRef.current.children[0];
        bonesGroupRef.current.remove(child);
        disposeObject3D(child);
      }
    }

    clearAndDisposeGroup(facesHighlightGroupRef.current);
    clearAndDisposeGroup(hoverHighlightGroupRef.current);

    const showTrianglesDebug = !!toolState.showTriangulation;
    const isWireframe = toolState.viewMode === 'wireframe' || showTrianglesDebug;

    // Interactive Primitive Placement Ghost Preview (Logical Edge Overlay)
    if (toolState.placeOnClick && placementHoverPos && hoverHighlightGroupRef.current) {
      const primType = toolState.activePrimitive || 'cube';
      const is2D = is2DPrimitive(primType);

      const ghostCADMesh = generatePrimitive(primType);
      const ghostGeo = buildThreeGeometry(ghostCADMesh);

      const ghostMat = new THREE.MeshStandardMaterial({
        color: VIEWPORT_THEME.ghostFill,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.2,
        metalness: 0.1,
      });

      const cy = is2D ? 0.0025 : ghostCADMesh.scale.y / 2;
      const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
      ghostMesh.position.set(placementHoverPos.x, cy, placementHoverPos.z);
      hoverHighlightGroupRef.current.add(ghostMesh);

      // Clean Logical Edge Wireframe Overlay (No Triangulation Diagonals)
      const ghostWireMat = new THREE.LineBasicMaterial({
        color: VIEWPORT_THEME.ghostWire,
        linewidth: 2.5,
      });
      const ghostWireGeo = buildLogicalEdgeGeometry(ghostCADMesh);
      const ghostWireframe = new THREE.LineSegments(ghostWireGeo, ghostWireMat);
      ghostWireframe.position.set(placementHoverPos.x, cy, placementHoverPos.z);
      hoverHighlightGroupRef.current.add(ghostWireframe);

      // Placement Target Ring
      const ringGeo = new THREE.RingGeometry(0.1, 0.4, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: VIEWPORT_THEME.ghostRing, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(placementHoverPos.x, 0.003, placementHoverPos.z);
      hoverHighlightGroupRef.current.add(ringMesh);
    }

    // 2-Step CAD Ghost Primitive Preview: Part 1 (Flat Footprint) & Part 2 (3D Height Extrusion)
    if (toolState.isCadDrawing && drawBaseStart && drawBaseEnd && hoverHighlightGroupRef.current) {
      const primitiveType = toolState.cadDrawPrimitive || 'cube';
      const is2D = is2DPrimitive(primitiveType);

      const sx = Math.max(0.05, Math.abs(drawBaseEnd.x - drawBaseStart.x));
      const sz = Math.max(0.05, Math.abs(drawBaseEnd.z - drawBaseStart.z));
      const sy = cadStep === 1 || is2D ? 0.005 : Math.max(0.05, drawHeight);

      const cx = (drawBaseStart.x + drawBaseEnd.x) / 2;
      const cz = (drawBaseStart.z + drawBaseEnd.z) / 2;
      const cy = cadStep === 1 || is2D ? 0.0025 : sy / 2;

      const ghostCADMesh = generatePrimitive(primitiveType, { x: sx, y: sy, z: sz });
      const ghostGeo = buildThreeGeometry(ghostCADMesh);

      const ghostMat = new THREE.MeshStandardMaterial({
        color: cadStep === 1 ? VIEWPORT_THEME.ghostFill : VIEWPORT_THEME.warning,
        transparent: true,
        opacity: cadStep === 1 ? 0.55 : 0.45,
        side: THREE.DoubleSide,
        roughness: 0.2,
        metalness: 0.1,
      });

      const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
      ghostMesh.position.set(cx, cy, cz);
      hoverHighlightGroupRef.current.add(ghostMesh);

      // Clean Logical Edge Overlay for CAD Ghost
      const ghostWireMat = new THREE.LineBasicMaterial({
        color: cadStep === 1 ? VIEWPORT_THEME.ghostWire : VIEWPORT_THEME.accentSoft,
        linewidth: 2,
      });
      const ghostWireGeo = buildLogicalEdgeGeometry(ghostCADMesh);
      const ghostWireframe = new THREE.LineSegments(ghostWireGeo, ghostWireMat);
      ghostWireframe.position.set(cx, cy, cz);
      hoverHighlightGroupRef.current.add(ghostWireframe);

      const footprintPositions = [
        drawBaseStart.x, 0.002, drawBaseStart.z,
        drawBaseEnd.x, 0.002, drawBaseStart.z,
        drawBaseEnd.x, 0.002, drawBaseEnd.z,
        drawBaseStart.x, 0.002, drawBaseEnd.z,
        drawBaseStart.x, 0.002, drawBaseStart.z,
      ];
      const footprintGeo = new THREE.BufferGeometry();
      footprintGeo.setAttribute('position', new THREE.Float32BufferAttribute(footprintPositions, 3));
      const footprintMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 3 });
      const footprintLine = new THREE.Line(footprintGeo, footprintMat);
      hoverHighlightGroupRef.current.add(footprintLine);
    }

    meshes.forEach((m) => {
      if (m.visible === false) return;
      // Blockout: hide scene meshes until Build (or while curves changed since Build).
      // Keeps Front/Side/Persp clean like the reference — ghost preview only while drawing.
      if (activeWorkspaceMode === 'blockout') {
        const vs = useVectorStore.getState();
        if (vs.builtRevision === null || vs.builtRevision !== vs.revision) return;
      }

      const evaluated = evaluateMeshModifiers(
        toolState.isPainting3D && (m.modifiers || []).some((mod) => mod.type === 'mirror' && mod.enabled)
          ? // Mirror modifier duplicates faces with shared UVs — one stamp shows on both
            // halves ("two pens"). Paint against the source cage instead.
            { ...m, modifiers: (m.modifiers || []).filter((mod) => mod.type !== 'mirror') }
          : m,
        2,
      );
      const displayMesh = deformMeshWithBones(evaluated, bones);
      const geometry = buildThreeGeometry(displayMesh);
      let material: THREE.Material;

      const isHovered = m.id === hoveredMeshId;
      const isSelected =
        toolState.editMode === 'object' ? selectedMeshIds.includes(m.id) : m.id === activeMeshId;
      const isSkinView = toolState.rigMode === 'skin' && !!selectedBoneId && m.id === activeMeshId;

      if (isSkinView) {
        const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        const mappings = geometry.userData.triangleMappings as
          | Array<{ faceId: string; faceCornerIndices: [number, number, number] }>
          | undefined;
        if (colorAttr && mappings) {
          const faceMap = new Map(displayMesh.faces.map((face) => [face.id, face]));
          const weightOf = (vertexId: string) => {
            const influence = (m.skinWeights?.[vertexId] || []).find((w) => w.boneId === selectedBoneId);
            if (influence) return influence.weight;
            return m.boneId === selectedBoneId ? 1 : 0;
          };
          const toColor = (w: number): [number, number, number] => {
            if (w > 0.8) return [0.93, 0.36, 0.38];
            if (w > 0.4) return [0.96, 0.62, 0.04];
            if (w > 0.05) return [0.18, 0.62, 0.47];
            return [0.15, 0.5, 0.92];
          };
          mappings.forEach((map, triIdx) => {
            const face = faceMap.get(map.faceId);
            if (!face) return;
            map.faceCornerIndices.forEach((corner, c) => {
              const vertexId = face.vertexIds[corner];
              if (!vertexId) return;
              const [r, g, b] = toColor(weightOf(vertexId));
              colorAttr.setXYZ(triIdx * 3 + c, r, g, b);
            });
          });
          colorAttr.needsUpdate = true;
        }
      }

      const meshTexture = meshTexturesRef.current.get(m.id)?.texture;
      if (meshTexture) meshTexture.needsUpdate = true;

      if (isSkinView) {
        material = new THREE.MeshBasicMaterial({
          vertexColors: true,
          wireframe: isWireframe,
          side: THREE.DoubleSide,
        });
      } else if (toolState.viewMode === 'textured' && meshTexture) {
        // Unlit textured — paint / UV preview must show the atlas even if lights are dim.
        material = new THREE.MeshBasicMaterial({
          map: meshTexture,
          color: 0xffffff,
          toneMapped: false,
          wireframe: isWireframe,
          side: THREE.DoubleSide,
        });
      } else if (toolState.viewMode === 'flat') {
        material = new THREE.MeshBasicMaterial({
          map: meshTexture || null,
          vertexColors: !meshTexture,
          wireframe: isWireframe,
          side: THREE.DoubleSide,
        });
      } else if (activeWorkspaceMode === 'blockout') {
        // Clay flat-shaded look matching Vector Blockout reference.
        material = new THREE.MeshStandardMaterial({
          map: meshTexture || null,
          color: meshTexture ? 0xffffff : 0xd2b48c,
          vertexColors: false,
          roughness: 0.82,
          metalness: 0.04,
          flatShading: true,
          wireframe: isWireframe,
          side: THREE.DoubleSide,
        });
      } else {
        // OutlineForge-style clay solid when untextured (soft key + soft contact shadow).
        material = new THREE.MeshStandardMaterial({
          map: meshTexture || null,
          color: meshTexture ? 0xffffff : 0xa5a6a8,
          vertexColors: false,
          roughness: 0.64,
          metalness: 0.08,
          wireframe: isWireframe,
          side: THREE.DoubleSide,
        });
      }

      // Blender-style X-Ray: translucent surfaces so you can select / see through the mesh.
      if (toolState.xray && !isWireframe) {
        material.transparent = true;
        material.opacity = 0.38;
        material.depthWrite = false;
      }

      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.castShadow = !isWireframe;
      meshObj.receiveShadow = true;

      let posX = m.position.x;
      let posY = m.position.y;
      let posZ = m.position.z;

      if (m.boneId && !m.skinWeights) {
        const boundBone = bones.find((b) => b.id === m.boneId);
        if (boundBone) {
          posX += boundBone.position.x;
          posY += boundBone.position.y;
          posZ += boundBone.position.z;
        }
      }

      meshObj.position.set(posX, posY, posZ);
      meshObj.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
      meshObj.scale.set(m.scale.x, m.scale.y, m.scale.z);
      meshObj.userData = { meshId: m.id };

      mGroup.add(meshObj);

      if (m.id === activeMeshId) {
        activeMeshObjectRef.current = meshObj;
      }

      // AAA Clean Logical Edge Wireframe Overlay for Selected/Hovered Mesh (No Triangulation Diagonals!)
      // Blockout always shows cream edge wire like the reference Vector Blockout tool.
      // X-Ray also draws edges so the silhouette stays readable through the transparent surface.
      if (activeWorkspaceMode === 'blockout' || isSelected || isHovered || toolState.xray) {
        const outlineMat = new THREE.LineBasicMaterial({
          color:
            activeWorkspaceMode === 'blockout'
              ? 0xe8d090
              : isHovered
                ? VIEWPORT_THEME.hover
                : isSelected
                  ? VIEWPORT_THEME.idleHandle
                  : toolState.xray
                    ? 0x9a9a9a
                    : VIEWPORT_THEME.idleHandle,
          transparent: activeWorkspaceMode === 'blockout' || (!!toolState.xray && !isSelected && !isHovered),
          opacity:
            activeWorkspaceMode === 'blockout'
              ? 0.75
              : toolState.xray && !isSelected && !isHovered
                ? 0.55
                : 1,
          linewidth: isHovered && activeWorkspaceMode !== 'blockout' ? 3 : 2,
          depthTest: !toolState.xray,
        });
        const wireGeo = buildLogicalEdgeGeometry(displayMesh);
        const wireframe = new THREE.LineSegments(wireGeo, outlineMat);
        wireframe.position.copy(meshObj.position);
        wireframe.rotation.copy(meshObj.rotation);
        wireframe.scale.copy(meshObj.scale);
        wireframe.userData = { meshId: m.id };
        mGroup.add(wireframe);

        // Optional Debug Overlay for Render Triangulation if explicitly requested
        if (showTrianglesDebug) {
          const debugTriGeo = buildTriangulationDebugGeometry(m);
          const debugMat = new THREE.LineBasicMaterial({ color: 0x555555, linewidth: 1 });
          const debugWireframe = new THREE.LineSegments(debugTriGeo, debugMat);
          debugWireframe.position.copy(meshObj.position);
          debugWireframe.rotation.copy(meshObj.rotation);
          debugWireframe.scale.copy(meshObj.scale);
          mGroup.add(debugWireframe);
        }
      }

      // Vertex handles — screen-stable size (world boxes look enormous when zoomed in).
      if (isSelected && (toolState.editMode === 'vertex' || toolState.rigMode === 'skin') && verticesGroupRef.current) {
        const cam = cameraRef.current;
        displayMesh.vertices.forEach((v) => {
          const isVertSelected = selectedVertexIds.includes(v.id);
          const isVertHovered = hoveredVertexId === v.id;

          let vertColor = isVertHovered ? VIEWPORT_THEME.hover : isVertSelected ? VIEWPORT_THEME.selection : VIEWPORT_THEME.idleHandle;

          if (toolState.rigMode === 'skin' && selectedBoneId) {
            const weights = activeMesh.skinWeights?.[v.id] || [];
            const influence = weights.find((w) => w.boneId === selectedBoneId);
            const weightVal = influence ? influence.weight : (activeMesh.boneId === selectedBoneId ? 1 : 0);
            if (weightVal > 0.8) vertColor = 0xec5b62; // High weight: Red
            else if (weightVal > 0.4) vertColor = 0xf59e0b; // Medium weight: Yellow
            else if (weightVal > 0.05) vertColor = 0x2d9d78; // Low weight: Green
            else vertColor = VIEWPORT_THEME.weightZero; // Zero weight: cool idle
          }

          const world = localToWorld(m, v.x, v.y, v.z);
          const dist = cam ? cam.position.distanceTo(world) : 4;
          const base = Math.max(0.018, Math.min(0.08, dist * 0.01));
          const size = isVertHovered ? base * 1.35 : isVertSelected ? base * 1.2 : base;
          const vertGeo = new THREE.BoxGeometry(size, size, size);
          const vertMat = new THREE.MeshBasicMaterial({
            color: vertColor,
            depthTest: false,
            transparent: true,
            opacity: isVertSelected || isVertHovered ? 1 : 0.92,
          });
          const cube = new THREE.Mesh(vertGeo, vertMat);
          cube.position.copy(world);
          cube.renderOrder = 40;
          cube.userData = { vertexId: v.id, meshId: m.id };
          verticesGroupRef.current?.add(cube);
        });
      }

      // Render Edge mode handles from SOURCE mesh (not modifier display) so ids match edits
      if (isSelected && toolState.editMode === 'edge' && edgesGroupRef.current) {
        const vertMap = new Map(m.vertices.map((v) => [v.id, v]));

        m.edges.forEach((edge) => {
          const v1 = vertMap.get(edge.v1Id);
          const v2 = vertMap.get(edge.v2Id);
          if (!v1 || !v2) return;

          const isEdgeSelected = selectedEdgeIds.includes(edge.id);

          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(
              [v1.x, v1.y, v1.z, v2.x, v2.y, v2.z],
              3
            )
          );

          const edgeMat = new THREE.LineBasicMaterial({
            color: isEdgeSelected ? VIEWPORT_THEME.selection : VIEWPORT_THEME.idleHandle,
            depthTest: false,
          });

          const line = new THREE.Line(edgeGeo, edgeMat);
          line.position.set(posX, posY, posZ);
          line.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
          line.scale.set(m.scale.x, m.scale.y, m.scale.z);
          line.renderOrder = 30;
          line.userData = { edgeId: edge.id, meshId: m.id };
          edgesGroupRef.current?.add(line);
        });
      }

      // Render Selected/Hovered Face Overlay Polygons in Face Mode
      if (isSelected && toolState.editMode === 'face' && facesHighlightGroupRef.current) {
        const vertMap = new Map(displayMesh.vertices.map((v) => [v.id, v]));

        m.faces.forEach((f) => {
          const isFaceSelected = selectedFaceIds.includes(f.id);
          const isFaceHovered = hoveredFaceId === f.id;

          if (!isFaceSelected && !isFaceHovered) return;

          const fVerts = f.vertexIds.map((vId) => vertMap.get(vId)!).filter(Boolean);
          if (fVerts.length < 3) return;

          const positions: number[] = [];
          for (let i = 1; i < fVerts.length - 1; i++) {
            const p0 = fVerts[0];
            const p1 = fVerts[i];
            const p2 = fVerts[i + 1];
            positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          }

          const faceGeo = new THREE.BufferGeometry();
          faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          faceGeo.computeVertexNormals();

          const faceMat = new THREE.MeshBasicMaterial({
            color: isFaceHovered ? VIEWPORT_THEME.hover : VIEWPORT_THEME.selection,
            transparent: true,
            opacity: isFaceHovered ? 0.22 : 0.12,
            side: THREE.DoubleSide,
            depthTest: false,
          });

          const faceMesh = new THREE.Mesh(faceGeo, faceMat);
          faceMesh.position.set(posX, posY, posZ);
          faceMesh.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
          faceMesh.scale.set(m.scale.x, m.scale.y, m.scale.z);
          facesHighlightGroupRef.current?.add(faceMesh);

          // Boundary outline
          const edgePositions: number[] = [];
          for (let i = 0; i < fVerts.length; i++) {
            const v1 = fVerts[i];
            const v2 = fVerts[(i + 1) % fVerts.length];
            edgePositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
          }
          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
          const edgeMat = new THREE.LineBasicMaterial({
            color: isFaceHovered ? VIEWPORT_THEME.hover : VIEWPORT_THEME.accentSoft,
            transparent: true,
            opacity: 0.85,
            linewidth: 2,
            depthTest: false,
          });
          const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
          edgeLines.position.set(posX, posY, posZ);
          edgeLines.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
          edgeLines.scale.set(m.scale.x, m.scale.y, m.scale.z);
          facesHighlightGroupRef.current?.add(edgeLines);
        });
      }
    });

    // Game-rig skeleton overlay: hierarchy-aware joints, 3D octahedron bones, and parent links.
    if (bonesGroupRef.current && shouldShowBones) {
      const worldMatrices = new Map<string, THREE.Matrix4>();
      const resolveWorld = (bone: CADBone, stack = new Set<string>()): THREE.Matrix4 => {
        const cached = worldMatrices.get(bone.id);
        if (cached) return cached;
        if (stack.has(bone.id)) return new THREE.Matrix4();
        stack.add(bone.id);
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(bone.position.x, bone.position.y, bone.position.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(bone.rotation.x, bone.rotation.y, bone.rotation.z)),
          new THREE.Vector3(bone.scale.x, bone.scale.y, bone.scale.z),
        );
        const parent = bone.parentId ? bones.find((candidate) => candidate.id === bone.parentId) : null;
        const world = parent ? resolveWorld(parent, stack).clone().multiply(local) : local;
        worldMatrices.set(bone.id, world);
        return world;
      };

      bones.filter((bone) => bone.visible !== false).forEach((bone) => {
        const world = resolveWorld(bone);
        const start = new THREE.Vector3().setFromMatrixPosition(world);
        const end = new THREE.Vector3(0, bone.length, 0).applyMatrix4(world);
        const direction = end.clone().sub(start);
        const length = Math.max(.04, direction.length());
        const selected = bone.id === selectedBoneId;
        const color = new THREE.Color(selected ? '#ff9a3c' : bone.color || '#ed7300');

        // Octahedral 3D bone geometry (tapered diamond shape)
        const radius = Math.max(0.04, length * 0.12);
        const midIndent = length * 0.2;
        const vertices = new Float32Array([
          0, 0, 0,
          0, length, 0,
          radius, midIndent, 0,
          0, midIndent, radius,
          -radius, midIndent, 0,
          0, midIndent, -radius,
        ]);
        const indices = new Uint16Array([
          0, 2, 3,  0, 3, 4,  0, 4, 5,  0, 5, 2,
          1, 3, 2,  1, 4, 3,  1, 5, 4,  1, 2, 5,
        ]);
        const shaftGeometry = new THREE.BufferGeometry();
        shaftGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        shaftGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
        shaftGeometry.computeVertexNormals();

        const shaftMaterial = new THREE.MeshBasicMaterial({
          color: selected ? VIEWPORT_THEME.boneSelected : color,
          transparent: true,
          opacity: selected ? 0.95 : isBoneEditMode ? 0.85 : 0.6,
          depthTest: false,
        });
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.position.copy(start);
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
        shaft.userData = { boneId: bone.id, rigPart: 'bone' };
        shaft.renderOrder = 20;
        bonesGroupRef.current?.add(shaft);

        const jointGeometry = new THREE.SphereGeometry(selected ? .11 : .075, 12, 8);
        const jointMaterial = new THREE.MeshBasicMaterial({
          color: selected ? 0xffffff : color, depthTest: false,
        });
        const joint = new THREE.Mesh(jointGeometry, jointMaterial);
        joint.position.copy(start);
        joint.userData = { boneId: bone.id, rigPart: 'joint' };
        joint.renderOrder = 21;
        bonesGroupRef.current?.add(joint);

        if (!bone.parentId) {
          const rootRing = new THREE.Mesh(
            new THREE.TorusGeometry(.14, .018, 6, 20),
            new THREE.MeshBasicMaterial({ color: selected ? VIEWPORT_THEME.boneSelected : color, depthTest: false }),
          );
          rootRing.position.copy(start);
          rootRing.rotation.x = Math.PI / 2;
          rootRing.userData = { boneId: bone.id, rigPart: 'root' };
          rootRing.renderOrder = 21;
          bonesGroupRef.current?.add(rootRing);
        }
      });
    }

    // Keep TransformControls on the selection centroid (skip while dragging / modal GRS)
    if (dummyTargetRef.current && transformControlsRef.current) {
      let centroid: THREE.Vector3 | null = null;
      let hasSelection = false;
      let sceneRot: Vector3D | null = null;
      let sceneScl: Vector3D | null = null;

      const sceneSel = sceneSelection;
      if (sceneSel && sceneSel.kind !== 'mesh' && toolState.editMode === 'object') {
        if (sceneSel.kind === 'camera') {
          const cam = cameras.find((c) => c.id === sceneSel.id);
          if (cam && !cam.locked) {
            centroid = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z);
            sceneRot = cam.rotation;
            sceneScl = { x: 1, y: 1, z: 1 };
            hasSelection = true;
          }
        } else if (sceneSel.kind === 'light') {
          const L = lights.find((c) => c.id === sceneSel.id);
          if (L && !L.locked) {
            centroid = new THREE.Vector3(L.position.x, L.position.y, L.position.z);
            sceneRot = L.rotation;
            sceneScl = L.scale;
            hasSelection = true;
          }
        } else if (sceneSel.kind === 'particle') {
          const p = particles.find((c) => c.id === sceneSel.id);
          if (p) {
            const scl = p.scale || { x: 1, y: 1, z: 1 };
            centroid = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
            sceneRot = p.rotation;
            sceneScl = scl;
            hasSelection = true;
          }
        } else if (sceneSel.kind === 'weather' && environment) {
          const pos = environment.position || { x: 0, y: 2, z: 0 };
          centroid = new THREE.Vector3(pos.x, pos.y, pos.z);
          sceneRot = environment.rotation || { x: 0, y: 0, z: 0 };
          sceneScl = environment.scale || { x: 1, y: 1, z: 1 };
          hasSelection = true;
        }
      } else if (activeMesh) {
        if (toolState.editMode === 'bone' && selectedBoneId && toolState.rigMode !== 'skin') {
          const targetBone = bones.find((b) => b.id === selectedBoneId);
          if (targetBone && !targetBone.locked) {
            const world = getBoneWorldMatrices(bones, false).get(selectedBoneId);
            if (world) {
              centroid = new THREE.Vector3().setFromMatrixPosition(world);
              hasSelection = true;
            }
          }
        } else if (toolState.editMode === 'object') {
          // Only when something is actually selected — empty click-off clears gizmo.
          if (selectedMeshIds.length > 0) {
            centroid = computeSelectionWorldCentroid(activeMesh);
            hasSelection = Boolean(centroid);
          }
        } else {
          centroid = computeSelectionWorldCentroid(activeMesh);
          hasSelection = Boolean(centroid);
        }
      }

      const gizmoBusy = transformControlsRef.current.dragging || modalActiveRef.current;

      if (
        hasSelection &&
        centroid &&
        !toolState.isCadDrawing &&
        !toolState.placeOnClick &&
        !toolState.isPainting3D &&
        toolState.rigMode !== 'skin'
      ) {
        if (!gizmoBusy) {
          dummyTargetRef.current.position.copy(centroid);
          if (sceneRot && sceneScl) {
            dummyTargetRef.current.rotation.set(sceneRot.x, sceneRot.y, sceneRot.z);
            dummyTargetRef.current.scale.set(sceneScl.x, sceneScl.y, sceneScl.z);
          } else if (toolState.editMode === 'bone' && selectedBoneId) {
            const world = getBoneWorldMatrices(bones, false).get(selectedBoneId);
            if (world) {
              const pos = new THREE.Vector3();
              const quat = new THREE.Quaternion();
              const scl = new THREE.Vector3();
              world.decompose(pos, quat, scl);
              dummyTargetRef.current.position.copy(pos);
              dummyTargetRef.current.quaternion.copy(quat);
              dummyTargetRef.current.scale.copy(scl);
            }
          } else if (toolState.editMode === 'object' && activeMesh) {
            dummyTargetRef.current.rotation.set(activeMesh.rotation.x, activeMesh.rotation.y, activeMesh.rotation.z);
            dummyTargetRef.current.scale.set(activeMesh.scale.x, activeMesh.scale.y, activeMesh.scale.z);
          } else {
            // Component modes: keep gizmo axes world-aligned for clearer edit feedback
            dummyTargetRef.current.rotation.set(0, 0, 0);
            dummyTargetRef.current.scale.set(1, 1, 1);
          }
          previousGizmoPosRef.current.copy(centroid);
        }
        // Modal G/R/S: hide gizmo entirely for free mouse grab.
        // Blockout is silhouette-driven — hide transform gizmo clutter.
        if (modalActiveRef.current || activeWorkspaceMode === 'blockout') {
          transformControlsRef.current.enabled = false;
          transformControlsRef.current.getHelper().visible = false;
        } else {
          transformControlsRef.current.enabled = true;
          transformControlsRef.current.getHelper().visible = true;
          // Smaller gizmo in component modes so it doesn't swallow the vertex handle.
          transformControlsRef.current.setSize(toolState.editMode === 'object' ? 1.0 : 0.65);
          transformControlsRef.current.setSpace(
            toolState.editMode === 'object' || toolState.editMode === 'bone' || (sceneSel && sceneSel.kind !== 'mesh')
              ? 'local'
              : 'world',
          );
        }
      } else if (!gizmoBusy) {
        transformControlsRef.current.enabled = false;
        transformControlsRef.current.getHelper().visible = false;
      }
    }
  }, [meshes, bones, selectedBoneId, activeMeshId, hoveredMeshId, hoveredVertexId, hoveredFaceId, toolState.viewMode, toolState.editMode, toolState.rigMode, toolState.isCadDrawing, toolState.cadDrawPrimitive, toolState.placeOnClick, toolState.activePrimitive, toolState.showTriangulation, toolState.isPainting3D, toolState.xray, placementHoverPos, cadStep, drawBaseStart, drawBaseEnd, drawHeight, selectedVertexIds, selectedEdgeIds, selectedFaceIds, selectedMeshIds, renderSettings.wireframeColor, meshTextureTick, cameras, lights, particles, environment, sceneSelection, activeWorkspaceMode, vectorRevision, vectorBuiltRevision]);

  // Update edge hover/selection colors in place — avoid full scene rebuild on every hover
  useEffect(() => {
    if (!edgesGroupRef.current || toolState.editMode !== 'edge') return;
    edgesGroupRef.current.children.forEach((child) => {
      const line = child as THREE.Line;
      const mat = line.material as THREE.LineBasicMaterial;
      if (!mat?.color) return;
      const id = line.userData.edgeId as string | undefined;
      if (!id) return;
      const selected = selectedEdgeIds.includes(id);
      const hovered = hoveredEdgeId === id;
      mat.color.setHex(hovered ? VIEWPORT_THEME.hover : selected ? VIEWPORT_THEME.selection : VIEWPORT_THEME.idleHandle);
      mat.needsUpdate = true;
    });
  }, [hoveredEdgeId, selectedEdgeIds, toolState.editMode, meshes, activeMeshId]);

  // Handle Smooth Real-Time Gizmo Drag Interaction (Absolute Displacement & Zero Jitter)
  useEffect(() => {
    if (!transformControlsRef.current || !activeMesh) return;
    const tControls = transformControlsRef.current;

    const handleDraggingChanged = (event: { value: boolean }) => {
      if (!controlsRef.current) return;
      const cur = toolStateRef.current;
      const blocked =
        Boolean(event.value) ||
        cur.isCadDrawing ||
        Boolean(cur.placeOnClick) ||
        Boolean(cur.modalTransform) ||
        Boolean(cur.modalMeshOp) ||
        modalActiveRef.current;
      controlsRef.current.enabled = !blocked;

      if (event.value) {
        onBeginHistory?.();
        if (dummyTargetRef.current) {
          // Keep gizmo PRS clean so leftover S-mode scale can't inflate the helper.
          const dummy = dummyTargetRef.current;
          if (
            toolState.editMode === 'vertex' ||
            toolState.editMode === 'edge' ||
            toolState.editMode === 'face'
          ) {
            dummy.rotation.set(0, 0, 0);
            dummy.quaternion.identity();
          }
          dummy.scale.set(1, 1, 1);
          dragStartGizmoPosRef.current.copy(dummy.position);
        }
        initialVertsMapRef.current.clear();
        activeMesh.vertices.forEach((v) => {
          initialVertsMapRef.current.set(v.id, { x: v.x, y: v.y, z: v.z });
        });
      } else {
        // Commit live object / scene transform once on release (avoids React rebuild fight while dragging).
        if (dummyTargetRef.current && (toolState.editMode === 'object' || toolState.editMode === 'bone')) {
          const dummy = dummyTargetRef.current;
          const step = toolState.gridSnap || 0;
          const snapP = (v: number) => (step > 0 ? snapToGrid(v, step) : v);
          const sceneSel = sceneSelectionRef.current;
          if (sceneSel && sceneSel.kind !== 'mesh') {
            const p = { x: snapP(dummy.position.x), y: snapP(dummy.position.y), z: snapP(dummy.position.z) };
            const rot = { x: dummy.rotation.x, y: dummy.rotation.y, z: dummy.rotation.z };
            const scl = {
              x: Math.max(0.01, dummy.scale.x),
              y: Math.max(0.01, dummy.scale.y),
              z: Math.max(0.01, dummy.scale.z),
            };
            if (sceneSel.kind === 'camera' && setCameras) {
              setCameras((prev) => prev.map((c) => (c.id === sceneSel.id && !c.locked ? { ...c, position: p, rotation: rot, lookAt: null } : c)));
            } else if (sceneSel.kind === 'light' && setLights) {
              setLights((prev) =>
                prev.map((L) =>
                  L.id === sceneSel.id && !L.locked
                    ? { ...L, position: p, rotation: rot, scale: scl, distance: lightDistanceFromScale(scl, L.type) || L.distance }
                    : L,
                ),
              );
            } else if (sceneSel.kind === 'particle' && setParticles) {
              setParticles((prev) => prev.map((fx) => (fx.id === sceneSel.id ? { ...fx, position: p, rotation: rot, scale: scl } : fx)));
            } else if (sceneSel.kind === 'weather' && setEnvironment) {
              setEnvironment((prev) => ({ ...prev, position: p, rotation: rot, scale: scl }));
            }
          } else if (toolState.editMode === 'object') {
            const mode = toolState.transformMode;
            if (mode === 'rotate') {
              setMesh({ ...activeMesh, rotation: { x: dummy.rotation.x, y: dummy.rotation.y, z: dummy.rotation.z } });
            } else if (mode === 'scale') {
              setMesh({
                ...activeMesh,
                scale: {
                  x: Math.max(0.01, dummy.scale.x),
                  y: Math.max(0.01, dummy.scale.y),
                  z: Math.max(0.01, dummy.scale.z),
                },
              });
            } else {
              setMesh({
                ...activeMesh,
                position: { x: snapP(dummy.position.x), y: snapP(dummy.position.y), z: snapP(dummy.position.z) },
              });
            }
          }
        }
        // Commit component (vertex/edge/face) verts once on release — live preview already updated Three.js.
        if (
          pendingComponentVertsRef.current &&
          (toolState.editMode === 'vertex' || toolState.editMode === 'edge' || toolState.editMode === 'face')
        ) {
          let verts = pendingComponentVertsRef.current;
          const step = toolState.gridSnap || 0;
          // Snap only on commit so live drag doesn't fight the gizmo (jitter).
          if (step > 0 && toolState.transformMode === 'translate') {
            const editIds = new Set(collectEditVertIds(activeMesh));
            verts = verts.map((v) => {
              if (!editIds.has(v.id)) return v;
              return {
                ...v,
                x: snapToGrid(v.x, step),
                y: snapToGrid(v.y, step),
                z: snapToGrid(v.z, step),
              };
            });
          }
          let nextMesh: CADMesh = {
            ...activeMesh,
            vertices: verts,
            revision: (activeMesh.revision || 0) + 1,
          };
          pendingComponentVertsRef.current = null;
          if (toolState.liveMirror) {
            const axis = toolState.mirrorAxis || 'x';
            const ids =
              toolState.editMode === 'vertex'
                ? selectedVertexIds
                : toolState.editMode === 'edge'
                  ? activeMesh.edges.filter((e) => selectedEdgeIds.includes(e.id)).flatMap((e) => [e.v1Id, e.v2Id])
                  : activeMesh.faces.filter((f) => selectedFaceIds.includes(f.id)).flatMap((f) => f.vertexIds);
            if (ids.length) nextMesh = syncSymmetricalVertices(nextMesh, ids, axis);
          }
          setMesh(nextMesh);
          if (dummyTargetRef.current) {
            dummyTargetRef.current.scale.set(1, 1, 1);
            dummyTargetRef.current.rotation.set(0, 0, 0);
            dummyTargetRef.current.quaternion.identity();
          }
        } else if (toolState.liveMirror && (toolState.editMode === 'vertex' || toolState.editMode === 'edge' || toolState.editMode === 'face')) {
          // Live mirror sync on release (Blender X-mirror style)
          const axis = toolState.mirrorAxis || 'x';
          const ids = toolState.editMode === 'vertex'
            ? selectedVertexIds
            : toolState.editMode === 'edge'
              ? activeMesh.edges.filter((e) => selectedEdgeIds.includes(e.id)).flatMap((e) => [e.v1Id, e.v2Id])
              : activeMesh.faces.filter((f) => selectedFaceIds.includes(f.id)).flatMap((f) => f.vertexIds);
          if (ids.length) {
            setMesh(syncSymmetricalVertices(activeMesh, ids, axis));
          }
        }
        if (toolState.liveMirror && toolState.mirrorBones && toolState.editMode === 'bone' && selectedBoneId && setBones) {
          const axis = toolState.mirrorAxis || 'x';
          setBones((prev) => syncMirroredBonePose(prev, selectedBoneId, axis));
        }
        if (dummyTargetRef.current && toolState.transformMode === 'scale') {
          dummyTargetRef.current.scale.set(1, 1, 1);
        }
      }
    };

    const applyLiveObjectFromDummy = () => {
      if (!dummyTargetRef.current) return;
      const dummy = dummyTargetRef.current;
      const sceneSel = sceneSelectionRef.current;
      const transformingScene = Boolean(sceneSel && sceneSel.kind !== 'mesh');

      // Scene-object gizmo must not yank the active mesh to the dummy.
      if (!transformingScene) {
        const meshId = activeMesh.id;
        meshesGroupRef.current?.traverse((obj) => {
          if (obj.userData?.meshId === meshId) {
            obj.position.copy(dummy.position);
            obj.rotation.copy(dummy.rotation);
            obj.scale.copy(dummy.scale);
          }
        });
      }

      if (transformingScene && sceneHelpersGroupRef.current) {
        const helper = sceneHelpersGroupRef.current.children.find(
          (c) => c.userData?.sceneKind === sceneSel!.kind && c.userData?.sceneId === sceneSel!.id,
        );
        if (helper) {
          helper.position.copy(dummy.position);
          helper.rotation.copy(dummy.rotation);
          helper.scale.copy(dummy.scale);
        }
      }
    };

    const applyLiveComponentVerts = (mesh: CADMesh, updatedVerts: CADMesh['vertices']) => {
      pendingComponentVertsRef.current = updatedVerts;
      const preview = { ...mesh, vertices: updatedVerts };
      if (activeMeshObjectRef.current) {
        const oldGeo = activeMeshObjectRef.current.geometry;
        activeMeshObjectRef.current.geometry = buildThreeGeometry(preview);
        oldGeo.dispose();
      }
      const vertMap = new Map(updatedVerts.map((v) => [v.id, v]));
      if (edgesGroupRef.current && toolStateRef.current.editMode === 'edge') {
        edgesGroupRef.current.children.forEach((child) => {
          const line = child as THREE.Line;
          const edge = mesh.edges.find((e) => e.id === line.userData.edgeId);
          if (!edge) return;
          const v1 = vertMap.get(edge.v1Id);
          const v2 = vertMap.get(edge.v2Id);
          if (!v1 || !v2) return;
          const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, v1.x, v1.y, v1.z);
          pos.setXYZ(1, v2.x, v2.y, v2.z);
          pos.needsUpdate = true;
          line.geometry.computeBoundingSphere();
        });
      }
      if (verticesGroupRef.current && toolStateRef.current.editMode === 'vertex') {
        const cam = cameraRef.current;
        verticesGroupRef.current.children.forEach((child) => {
          const v = vertMap.get(child.userData.vertexId);
          if (!v) return;
          const world = localToWorld(mesh, v.x, v.y, v.z);
          child.position.copy(world);
          // Keep handle screen size stable while dragging (rebuild is skipped).
          if (cam && child instanceof THREE.Mesh && child.geometry) {
            const dist = cam.position.distanceTo(world);
            const base = Math.max(0.018, Math.min(0.08, dist * 0.01));
            const selected = selectedVertexIdsRef.current.includes(child.userData.vertexId);
            const size = selected ? base * 1.2 : base;
            const cur = (child.geometry as THREE.BoxGeometry).parameters;
            if (!cur || Math.abs(cur.width - size) > 0.002) {
              child.geometry.dispose();
              child.geometry = new THREE.BoxGeometry(size, size, size);
            }
          }
        });
      }
    };

    const handleGizmoChange = () => {
      if (!tControls.dragging || !dummyTargetRef.current || modalActiveRef.current) return;

      const step = toolState.gridSnap || 0;
      const dummy = dummyTargetRef.current;
      const prs = readObjectPRS(dummy);
      const snapPos = {
        x: step > 0 ? snapToGrid(prs.position.x, step) : prs.position.x,
        y: step > 0 ? snapToGrid(prs.position.y, step) : prs.position.y,
        z: step > 0 ? snapToGrid(prs.position.z, step) : prs.position.z,
      };

      const sceneSel = sceneSelectionRef.current;
      if (sceneSel && sceneSel.kind !== 'mesh' && toolState.editMode === 'object') {
        // Live helper only — CAD commits on pointer-up.
        applyLiveObjectFromDummy();
        return;
      }

      if (toolState.editMode === 'object') {
        // Live mesh only — CAD commits on pointer-up (stops React rebuild fight).
        if (step > 0 && toolState.transformMode === 'translate') {
          dummy.position.set(snapPos.x, snapPos.y, snapPos.z);
        }
        applyLiveObjectFromDummy();
        return;
      }

      const editIds = new Set(collectEditVertIds(activeMesh));
      if (
        editIds.size > 0 &&
        (toolState.editMode === 'vertex' || toolState.editMode === 'edge' || toolState.editMode === 'face')
      ) {
        if (toolState.transformMode === 'scale') {
          const f = Math.max(0.05, dummy.scale.x);
          const center = new THREE.Vector3();
          let count = 0;
          activeMesh.vertices.forEach((v) => {
            if (!editIds.has(v.id)) return;
            const init = initialVertsMapRef.current.get(v.id) || v;
            center.add(new THREE.Vector3(init.x, init.y, init.z));
            count++;
          });
          if (count) center.divideScalar(count);
          const updatedVerts = activeMesh.vertices.map((v) => {
            if (!editIds.has(v.id)) return v;
            const init = initialVertsMapRef.current.get(v.id) || v;
            return {
              ...v,
              x: center.x + (init.x - center.x) * f,
              y: center.y + (init.y - center.y) * f,
              z: center.z + (init.z - center.z) * f,
            };
          });
          applyLiveComponentVerts(activeMesh, updatedVerts);
          return;
        }

        if (toolState.transformMode === 'rotate') {
          const q = dummy.quaternion.clone();
          const center = new THREE.Vector3();
          let count = 0;
          activeMesh.vertices.forEach((v) => {
            if (!editIds.has(v.id)) return;
            const init = initialVertsMapRef.current.get(v.id) || v;
            center.add(new THREE.Vector3(init.x, init.y, init.z));
            count++;
          });
          if (count) center.divideScalar(count);
          const updatedVerts = activeMesh.vertices.map((v) => {
            if (!editIds.has(v.id)) return v;
            const init = initialVertsMapRef.current.get(v.id) || v;
            const p = new THREE.Vector3(init.x - center.x, init.y - center.y, init.z - center.z);
            p.applyQuaternion(q);
            return { ...v, x: center.x + p.x, y: center.y + p.y, z: center.z + p.z };
          });
          applyLiveComponentVerts(activeMesh, updatedVerts);
          return;
        }

        let deltaX = dummy.position.x - dragStartGizmoPosRef.current.x;
        let deltaY = dummy.position.y - dragStartGizmoPosRef.current.y;
        let deltaZ = dummy.position.z - dragStartGizmoPosRef.current.z;
        // Do not snap during the drag — snapping here makes verts jump while the
        // gizmo moves smoothly (looks jittery). Snap is applied on pointer-up.
        const localDelta = worldDeltaToLocal(activeMesh, deltaX, deltaY, deltaZ);
        const updatedVerts = activeMesh.vertices.map((v) => {
          if (!editIds.has(v.id)) return v;
          const init = initialVertsMapRef.current.get(v.id);
          if (!init) return v;
          return {
            ...v,
            x: init.x + localDelta.x,
            y: init.y + localDelta.y,
            z: init.z + localDelta.z,
          };
        });
        applyLiveComponentVerts(activeMesh, updatedVerts);
        return;
      }

      if (toolState.editMode === 'bone' && selectedBoneId && setBones && toolState.rigMode !== 'skin') {
        const bone = bones.find((b) => b.id === selectedBoneId);
        if (!bone || bone.locked) return;

        const worldMatrix = new THREE.Matrix4().compose(
          dummyTargetRef.current.position.clone(),
          dummyTargetRef.current.quaternion.clone(),
          dummyTargetRef.current.scale.clone(),
        );

        const parent = bone.parentId ? bones.find((b) => b.id === bone.parentId) : null;
        const parentWorld = parent
          ? getBoneWorldMatrices(bones, false).get(parent.id) || new THREE.Matrix4()
          : new THREE.Matrix4();
        const localMatrix = parentWorld.clone().invert().multiply(worldMatrix);
        const localPos = new THREE.Vector3();
        const localQuat = new THREE.Quaternion();
        const localScl = new THREE.Vector3();
        localMatrix.decompose(localPos, localQuat, localScl);
        const localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'XYZ');

        const nextPose = {
          position: {
            x: snapToGrid(localPos.x, step),
            y: snapToGrid(localPos.y, step),
            z: snapToGrid(localPos.z, step),
          },
          rotation: { x: localEuler.x, y: localEuler.y, z: localEuler.z },
          scale: { x: localScl.x, y: localScl.y, z: localScl.z },
        };

        setBones((currentBones) => {
          let updated = currentBones.map((b) => {
            if (b.id !== selectedBoneId) return b;
            const next = { ...b, ...nextPose };
            // Edit mode updates bind/rest as well as pose
            if (toolState.rigMode === 'edit') {
              next.restPosition = { ...nextPose.position };
              next.restRotation = { ...nextPose.rotation };
              next.restScale = { ...nextPose.scale };
            }
            return next;
          });
          if (toolState.rigMode === 'pose') {
            updated = evaluateConstraints(updated);
          }
          return updated;
        });
      }
    };

    tControls.addEventListener('dragging-changed', handleDraggingChanged as any);
    tControls.addEventListener('change', handleGizmoChange);
    return () => {
      tControls.removeEventListener('dragging-changed', handleDraggingChanged as any);
      tControls.removeEventListener('change', handleGizmoChange);
    };
  }, [activeMesh, bones, selectedBoneId, setBones, setMesh, setCameras, setLights, setParticles, setEnvironment, toolState.editMode, toolState.rigMode, toolState.transformMode, toolState.gridSnap, toolState.liveMirror, toolState.mirrorAxis, toolState.mirrorBones, selectedVertexIds, selectedEdgeIds, selectedFaceIds, onBeginHistory, sceneSelection]);

  // Focus View Target Callback
  const handleFocusCenter = () => {
    if (!controlsRef.current || !activeMesh) return;
    controlsRef.current.target.set(activeMesh.position.x, activeMesh.position.y, activeMesh.position.z);
    controlsRef.current.update();
  };

  const getGridIntersection = (e: React.PointerEvent<HTMLDivElement>): THREE.Vector3 | null => {
    if (!containerRef.current || !cameraRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (hit) {
      const step = toolState.gridSnap || 0.25;
      return new THREE.Vector3(snapToGrid(hit.x, step), 0, snapToGrid(hit.z, step));
    }
    return null;
  };

  const getVerticalHeightIntersection = (e: React.PointerEvent<HTMLDivElement>, basePoint: THREE.Vector3): number => {
    if (!containerRef.current || !cameraRef.current) return 1.0;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    const camDir = new THREE.Vector3();
    cameraRef.current.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 0.001) camDir.set(0, 0, 1);
    camDir.normalize();

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, basePoint);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);

    const step = toolState.gridSnap || 0.25;
    if (hit) {
      return snapToGrid(Math.max(0.1, Math.abs(hit.y)), step);
    }

    const fallbackY = Math.max(0.1, (rect.height / 2 - (e.clientY - rect.top)) * 0.02);
    return snapToGrid(fallbackY, step);
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (modalActiveRef.current || toolStateRef.current.modalTransform) return;

    const activePaintPointer = paintPointerIdRef.current;
    if (e && activePaintPointer != null && e.pointerId !== activePaintPointer) return;

    if (isPainting3DActiveRef.current && onDirect3DPaintPixel) {
      onDirect3DPaintPixel(0, 0, true);
    }
    isPainting3DActiveRef.current = false;
    paintPointerIdRef.current = null;
    setIsPainting3DActive(false);
    lastPaintClientRef.current = null;
    isWeightPaintingRef.current = false;
    if (paintCursorRafRef.current) {
      cancelAnimationFrame(paintCursorRafRef.current);
      paintCursorRafRef.current = 0;
    }
    pendingPaintCursorRef.current = null;
    if (controlsRef.current) {
      const cur = toolStateRef.current;
      const blocked =
        cur.isCadDrawing ||
        Boolean(cur.placeOnClick) ||
        Boolean(cur.modalTransform) ||
        Boolean(cur.modalMeshOp) ||
        modalActiveRef.current;
      controlsRef.current.enabled = !blocked;
      applyStandardOrbitMouseButtons(controlsRef.current);
      // Stay in paint / blockout-pen button map so the next LMB stroke isn't stolen incorrectly.
      if (activeWorkspaceMode === 'blockout' && useVectorStore.getState().mode === 'pen') {
        applyDrawToolOrbitMouseButtons(controlsRef.current, {
          ortho: cameraType !== 'perspective',
        });
      } else if (cur.isPainting3D) {
        applyPaintOrbitMouseButtons(controlsRef.current);
      }
    }

    // Marquee Selection Box Completion Handler
    if (isMarqueeDraggingRef.current && marqueeStartRef.current && containerRef.current && cameraRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x1 = marqueeStartRef.current.x;
      const y1 = marqueeStartRef.current.y;
      const x2 = marqueeBox?.x2 ?? x1;
      const y2 = marqueeBox?.y2 ?? y1;

      const minX = Math.min(x1, x2) - rect.left;
      const maxX = Math.max(x1, x2) - rect.left;
      const minY = Math.min(y1, y2) - rect.top;
      const maxY = Math.max(y1, y2) - rect.top;

      const width = maxX - minX;
      const height = maxY - minY;

      if (width > 4 || height > 4) {
        const isWorldPointInMarquee = (worldPos: THREE.Vector3) => {
          const proj = worldPos.clone().project(cameraRef.current!);
          const screenX = ((proj.x + 1) / 2) * rect.width;
          const screenY = ((-proj.y + 1) / 2) * rect.height;
          return screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY;
        };

        if (toolState.editMode === 'vertex' && activeMesh) {
          const hitVertIds = activeMesh.vertices
            .filter((v) => isWorldPointInMarquee(localToWorld(activeMesh, v.x, v.y, v.z)))
            .map((v) => v.id);
          setSelectedVertexIds(hitVertIds);
        } else if (toolState.editMode === 'edge' && activeMesh && setSelectedEdgeIds) {
          const vertMap = new Map(activeMesh.vertices.map((v) => [v.id, v]));
          const hitEdgeIds = activeMesh.edges
            .filter((edge) => {
              const v1 = vertMap.get(edge.v1Id);
              const v2 = vertMap.get(edge.v2Id);
              if (!v1 || !v2) return false;
              const mid = localToWorld(
                activeMesh,
                (v1.x + v2.x) / 2,
                (v1.y + v2.y) / 2,
                (v1.z + v2.z) / 2,
              );
              return isWorldPointInMarquee(mid);
            })
            .map((e) => e.id);
          setSelectedEdgeIds(hitEdgeIds);
        } else if (toolState.editMode === 'face' && activeMesh) {
          const vertMap = new Map(activeMesh.vertices.map((v) => [v.id, v]));
          const hitFaceIds = activeMesh.faces
            .filter((face) => {
              let sumX = 0, sumY = 0, sumZ = 0, count = 0;
              face.vertexIds.forEach((vId) => {
                const v = vertMap.get(vId);
                if (v) {
                  sumX += v.x;
                  sumY += v.y;
                  sumZ += v.z;
                  count++;
                }
              });
              if (count === 0) return false;
              return isWorldPointInMarquee(localToWorld(activeMesh, sumX / count, sumY / count, sumZ / count));
            })
            .map((f) => f.id);
          setSelectedFaceIds(hitFaceIds);
        } else if (toolState.editMode === 'object') {
          const hitMeshIds = meshes
            .filter((m) => {
              const mPos = new THREE.Vector3(m.position.x, m.position.y, m.position.z);
              return isWorldPointInMarquee(mPos);
            })
            .map((m) => m.id);
          if (hitMeshIds.length > 0) {
            setSelectedMeshIds?.(hitMeshIds);
            setActiveMeshId(hitMeshIds[0]);
          }
        }
      }

      isMarqueeDraggingRef.current = false;
      marqueeStartRef.current = null;
      setMarqueeBox(null);
      const cur = toolStateRef.current;
      if (
        controlsRef.current &&
        !cur.isCadDrawing &&
        !cur.placeOnClick &&
        !cur.modalTransform &&
        !cur.modalMeshOp
      ) {
        controlsRef.current.enabled = true;
      }
    }

    const cur = toolStateRef.current;
    if (
      controlsRef.current &&
      !cur.isCadDrawing &&
      !cur.placeOnClick &&
      !cur.modalTransform &&
      !cur.modalMeshOp &&
      !isPainting3DActiveRef.current
    ) {
      controlsRef.current.enabled = true;
      applyStandardOrbitMouseButtons(controlsRef.current);
      if (activeWorkspaceMode === 'blockout' && useVectorStore.getState().mode === 'pen') {
        applyDrawToolOrbitMouseButtons(controlsRef.current, {
          ortho: cameraType !== 'perspective',
        });
      } else if (cur.isPainting3D) {
        applyPaintOrbitMouseButtons(controlsRef.current);
      }
    }
  };

  const handlePointerLeave = () => {
    // Keep an active paint stroke alive — pointer capture continues delivering moves.
    if (isPainting3DActiveRef.current || isWeightPaintingRef.current) {
      if (paintCursorRafRef.current) {
        cancelAnimationFrame(paintCursorRafRef.current);
        paintCursorRafRef.current = 0;
      }
      setPaintCursor(null);
      return;
    }
    handlePointerUp();
    setPaintCursor(null);
  };

  const applyWeightPaintAtEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      toolState.rigMode !== 'skin' ||
      !selectedBoneId ||
      !activeMesh ||
      !activeMeshObjectRef.current ||
      !containerRef.current ||
      !cameraRef.current
    ) {
      return false;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);
    const hits = raycaster.intersectObject(activeMeshObjectRef.current);
    if (!hits.length) return false;

    const hitPoint = hits[0].point.clone();
    // Convert to mesh-local space for vertex distance
    const inv = activeMeshObjectRef.current.matrixWorld.clone().invert();
    hitPoint.applyMatrix4(inv);

    const brushRadius = Math.max(0.08, (toolState.brushSize || 2) * 0.12);
    const opacityRaw = toolState.paintOpacity ?? 1;
    const opacity = opacityRaw > 1 ? opacityRaw / 100 : opacityRaw;
    const strength = Math.max(0.05, Math.min(1, opacity)) * 0.45;
    const baseMode = toolState.weightPaintMode || 'add';
    const mode = e.shiftKey ? 'subtract' : e.altKey ? 'smooth' : baseMode;

    let nextMesh = activeMesh;
    const neighborMap = new Map<string, string[]>();
    activeMesh.edges.forEach((edge) => {
      const a = neighborMap.get(edge.v1Id) || [];
      a.push(edge.v2Id);
      neighborMap.set(edge.v1Id, a);
      const b = neighborMap.get(edge.v2Id) || [];
      b.push(edge.v1Id);
      neighborMap.set(edge.v2Id, b);
    });

    activeMesh.vertices.forEach((vertex) => {
      const dx = vertex.x - hitPoint.x;
      const dy = vertex.y - hitPoint.y;
      const dz = vertex.z - hitPoint.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > brushRadius) return;
      const falloff = 1 - dist / brushRadius;
      nextMesh = paintVertexWeight(
        nextMesh,
        vertex.id,
        selectedBoneId,
        mode,
        strength * falloff,
        neighborMap.get(vertex.id) || [],
      );
    });

    if (nextMesh !== activeMesh) setMesh(nextMesh);
    return true;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;
    // Vector Blockout: LMB drawing/editing is handled by VectorOverlay / OrbitControls.
    // Do not run modeling selection on LMB here.
    if (activeWorkspaceMode === 'blockout' && e.button === 0) return;
    // Blender modal G/R/S owns the pointer — don't steal selection mid-grab.
    if (modalActiveRef.current || toolStateRef.current.modalTransform || toolStateRef.current.modalMeshOp) {
      e.preventDefault();
      return;
    }

    // RMB / MMB are reserved for pan (OrbitControls) — never steal for tools
    if (e.button === 1 || e.button === 2) {
      if (activeWorkspaceMode === 'blockout' && controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      return;
    }

    // Skin-mode weight painting — LMB on mesh paints; miss keeps orbit/pan/zoom
    if (toolState.rigMode === 'skin' && e.button === 0 && !e.ctrlKey) {
      if (applyWeightPaintAtEvent(e)) {
        isWeightPaintingRef.current = true;
        if (controlsRef.current) controlsRef.current.enabled = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Empty space → camera controls (don't steal the event for selection)
      return;
    }

    // Direct 3D paint: LMB on the model paints; empty LMB orbits (default mouse map).
    if (toolState.isPainting3D && onDirect3DPaintPixel && e.button === 0 && !e.ctrlKey && !e.altKey) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

      // Prefer the active mesh; also accept any selected mesh so paint targets the selection.
      // Raycast all scene meshes so a click can retarget the active object.
      const paintTargets: THREE.Object3D[] = [];
      const seen = new Set<string>();
      const addTarget = (obj: THREE.Object3D) => {
        const id = obj.userData?.meshId as string | undefined;
        if (!id || !(obj instanceof THREE.Mesh) || seen.has(id)) return;
        seen.add(id);
        paintTargets.push(obj);
      };
      if (activeMeshObjectRef.current) addTarget(activeMeshObjectRef.current);
      if (meshesGroupRef.current) {
        meshesGroupRef.current.children.forEach((child) => addTarget(child));
      }

      let hit: THREE.Intersection | null = null;
      let hitMeshId = activeMeshId;
      if (paintTargets.length) {
        const prevFirst = raycaster.firstHitOnly;
        raycaster.firstHitOnly = true;
        const hits = raycaster.intersectObjects(paintTargets, false);
        raycaster.firstHitOnly = prevFirst;
        // Prefer a hit on the active / selected mesh when several overlap.
        const preferred =
          hits.find((h) => {
            let cur: THREE.Object3D | null = h.object;
            while (cur) {
              const id = cur.userData?.meshId as string | undefined;
              if (id && (id === activeMeshId || selectedMeshIds.includes(id))) return true;
              cur = cur.parent;
            }
            return false;
          }) || hits[0];
        if (preferred) {
          hit = preferred;
          let cur: THREE.Object3D | null = preferred.object;
          while (cur) {
            if (cur.userData?.meshId) {
              hitMeshId = cur.userData.meshId;
              break;
            }
            cur = cur.parent;
          }
        }
      }

      // Clicking a different mesh selects it for painting (Pixel Paint follows activeMesh).
      if (hit && hitMeshId && hitMeshId !== activeMeshId) {
        setActiveMeshId(hitMeshId);
        setSelectedMeshIds([hitMeshId]);
        // Wait for texture studio remount before starting a stroke.
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const uv = hit?.uv;
      if (hit && uv) {
        isPainting3DActiveRef.current = true;
        paintPointerIdRef.current = e.pointerId;
        setIsPainting3DActive(true);
        lastPaintClientRef.current = { x: e.clientX, y: e.clientY };
        if (controlsRef.current) controlsRef.current.enabled = false;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (meshTexturesRef.current.get(activeMeshId)?.texture) {
          meshTexturesRef.current.get(activeMeshId)!.texture.needsUpdate = true;
        }
        const faceMap = (hit.object as THREE.Mesh).geometry?.userData?.triangleToFaceId as string[] | undefined;
        const faceId = hit.faceIndex != null ? faceMap?.[hit.faceIndex] ?? null : null;
        onDirect3DPaintPixel(uv.x, uv.y, false, faceId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Missed the model — leave OrbitControls free for camera orbit
      return;
    }

    // Ctrl + Left Mouse Drag Marquee Box Selection Trigger
    if (e.ctrlKey && e.button === 0) {
      isMarqueeDraggingRef.current = true;
      marqueeStartRef.current = { x: e.clientX, y: e.clientY };
      setMarqueeBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
      if (controlsRef.current) controlsRef.current.enabled = false;
      return;
    }

    if (toolState.editMode === 'bone' && bonesGroupRef.current && setSelectedBoneId) {
      const rect = containerRef.current.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ), cameraRef.current);
      const hit = raycaster.intersectObjects(bonesGroupRef.current.children, true)
        .find((item) => item.object.userData.boneId);
      if (hit) {
        setSelectedBoneId(hit.object.userData.boneId);
        return;
      }
    }

    // Interactive Ghost Placement Click Handler
    if (toolState.placeOnClick && placementHoverPos && onSpawnDrawnPrimitive) {
      const primType = toolState.activePrimitive || 'cube';
      const is2D = is2DPrimitive(primType);

      const newMesh = generatePrimitive(primType);
      const cy = is2D ? 0.001 : newMesh.scale.y / 2;
      newMesh.position = { x: placementHoverPos.x, y: cy, z: placementHoverPos.z };

      onSpawnDrawnPrimitive(newMesh);
      setActiveMeshId(newMesh.id);
      setToolState((s) => ({ ...s, placeOnClick: false }));
      return;
    }

    // 2-Step CAD Drawing Click Handler
    if (toolState.isCadDrawing) {
      if (cadStep === 0) {
        const point = getGridIntersection(e);
        if (!point) return;
        setCadStep(1);
        setDrawBaseStart(point);
        setDrawBaseEnd(point);
        setDrawHeight(1.0);
      } else if (cadStep === 1) {
        const point = getGridIntersection(e);
        if (point) setDrawBaseEnd(point);

        if (is2DPrimitive(toolState.cadDrawPrimitive)) {
          if (drawBaseStart && drawBaseEnd && onSpawnDrawnPrimitive) {
            const sx = Math.max(0.1, Math.abs(drawBaseEnd.x - drawBaseStart.x));
            const sz = Math.max(0.1, Math.abs(drawBaseEnd.z - drawBaseStart.z));
            const cx = (drawBaseEnd.x + drawBaseStart.x) / 2;
            const cz = (drawBaseEnd.z + drawBaseStart.z) / 2;

            const finalMesh = generatePrimitive(toolState.cadDrawPrimitive || 'plane', { x: sx, y: 0.001, z: sz });
            finalMesh.position = { x: cx, y: 0.001, z: cz };
            onSpawnDrawnPrimitive(finalMesh);
            setActiveMeshId(finalMesh.id);
          }
          setCadStep(0);
          setDrawBaseStart(null);
          setDrawBaseEnd(null);
        } else {
          setCadStep(2);
        }
      } else if (cadStep === 2) {
        if (drawBaseStart && drawBaseEnd && onSpawnDrawnPrimitive) {
          const sx = Math.max(0.1, Math.abs(drawBaseEnd.x - drawBaseStart.x));
          const sz = Math.max(0.1, Math.abs(drawBaseEnd.z - drawBaseStart.z));
          const sy = Math.max(0.1, Math.abs(drawHeight));
          const cx = (drawBaseStart.x + drawBaseEnd.x) / 2;
          const cz = (drawBaseStart.z + drawBaseEnd.z) / 2;

          const finalMesh = generatePrimitive(toolState.cadDrawPrimitive || 'cube', { x: sx, y: sy, z: sz });
          finalMesh.position = { x: cx, y: sy / 2, z: cz };
          onSpawnDrawnPrimitive(finalMesh);
          setActiveMeshId(finalMesh.id);
        }

        setCadStep(0);
        setDrawBaseStart(null);
        setDrawBaseEnd(null);
        setDrawHeight(1.0);
      }
      return;
    }

    if (transformControlsRef.current && transformControlsRef.current.dragging) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    // Vertex Selection
    if (toolState.editMode === 'vertex' && verticesGroupRef.current) {
      const intersects = raycaster.intersectObjects(verticesGroupRef.current.children);
      if (intersects.length > 0) {
        const hitId = intersects[0].object.userData.vertexId;
        if (e.shiftKey) {
          setSelectedVertexIds((prev) =>
            prev.includes(hitId) ? prev.filter((id) => id !== hitId) : [...prev, hitId]
          );
        } else {
          setSelectedVertexIds([hitId]);
        }
        return;
      }
    }

    // Edge selection — screen-space picker against source mesh edges
    if (toolState.editMode === 'edge' && setSelectedEdgeIds && activeMesh) {
      const hitEdgeId = pickClosestEdgeId(e.clientX, e.clientY, activeMesh);
      if (hitEdgeId) {
        if (e.shiftKey) {
          setSelectedEdgeIds((prev) =>
            prev.includes(hitEdgeId) ? prev.filter((id) => id !== hitEdgeId) : [...prev, hitEdgeId]
          );
        } else {
          setSelectedEdgeIds([hitEdgeId]);
        }
        return;
      }
    }

    // Face Selection
    if (toolState.editMode === 'face' && activeMeshObjectRef.current) {
      const intersects = raycaster.intersectObject(activeMeshObjectRef.current);
      if (intersects.length > 0 && intersects[0].faceIndex != null) {
        const geo = activeMeshObjectRef.current.geometry;
        const triToFaceMap = geo.userData.triangleToFaceId as string[];
        let hitFaceId: string | null = null;

        if (triToFaceMap && triToFaceMap[intersects[0].faceIndex]) {
          hitFaceId = triToFaceMap[intersects[0].faceIndex];
        } else {
          const faceIdx = Math.floor(intersects[0].faceIndex / 2);
          hitFaceId = activeMesh.faces[faceIdx]?.id || null;
        }

        if (hitFaceId) {
          if (e.shiftKey) {
            setSelectedFaceIds((prev) =>
              prev.includes(hitFaceId!) ? prev.filter((id) => id !== hitFaceId) : [...prev, hitFaceId!]
            );
          } else {
            setSelectedFaceIds([hitFaceId]);
          }
        }
        return;
      }
    }

    // Object Selection — scene helpers (cameras/lights/particles/weather) then meshes
    if (toolState.editMode === 'object') {
      if (sceneHelpersGroupRef.current) {
        const helperHits = raycaster.intersectObjects(sceneHelpersGroupRef.current.children, true);
        if (helperHits.length > 0) {
          let curr: THREE.Object3D | null = helperHits[0].object;
          while (curr) {
            if (curr.userData?.sceneKind && curr.userData?.sceneId) {
              setSceneSelection?.({ kind: curr.userData.sceneKind, id: curr.userData.sceneId });
              setSelectedMeshIds?.([]);
              return;
            }
            curr = curr.parent;
          }
        }
      }

      if (meshesGroupRef.current) {
        const intersects = raycaster.intersectObjects(meshesGroupRef.current.children, true);
        if (intersects.length > 0) {
          let curr: THREE.Object3D | null = intersects[0].object;
          let hitMeshId: string | null = null;

          while (curr && curr !== meshesGroupRef.current) {
            if (curr.userData && curr.userData.meshId) {
              hitMeshId = curr.userData.meshId;
              break;
            }
            curr = curr.parent;
          }

          if (hitMeshId) {
            setSceneSelection?.({ kind: 'mesh', id: hitMeshId });
            if (e.shiftKey) {
              setSelectedMeshIds?.((prev) => {
                const next = prev.includes(hitMeshId!)
                  ? prev.filter((id) => id !== hitMeshId)
                  : [...prev, hitMeshId!];
                if (next.length > 0) setActiveMeshId(hitMeshId!);
                return next;
              });
            } else {
              setActiveMeshId(hitMeshId);
              setSelectedMeshIds?.([hitMeshId]);
            }
          }
          return;
        }
      }
    }

    // Don't clear selection when clicking the transform gizmo
    if (transformControlsRef.current?.getHelper()) {
      const gizmoHits = raycaster.intersectObject(transformControlsRef.current.getHelper(), true);
      if (gizmoHits.length > 0) return;
    }

    // Unselect All on Click-Off Empty Background
    if (!e.shiftKey && !e.ctrlKey) {
      if (toolState.editMode === 'vertex') setSelectedVertexIds([]);
      else if (toolState.editMode === 'edge') setSelectedEdgeIds?.([]);
      else if (toolState.editMode === 'face') setSelectedFaceIds([]);
      else if (toolState.editMode === 'object') {
        setSelectedMeshIds?.([]);
        setSceneSelection?.(null);
      } else if (toolState.editMode === 'bone') setSelectedBoneId?.('');
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || !cameraRef.current) return;
    // Modal G/R/S owns the pointer — don't thrash hover/selection rebuilds mid-grab.
    if (modalActiveRef.current || toolStateRef.current.modalTransform) return;

    // Blockout owns LMB draw/edit via VectorOverlay — skip hover raycasts that
    // setState and rebuild mesh outlines on every move.
    if (activeWorkspaceMode === 'blockout') return;

    if (isWeightPaintingRef.current) {
      applyWeightPaintAtEvent(e);
      return;
    }

    if (isMarqueeDraggingRef.current && marqueeStartRef.current) {
      setMarqueeBox({
        x1: marqueeStartRef.current.x,
        y1: marqueeStartRef.current.y,
        x2: e.clientX,
        y2: e.clientY,
      });
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    if (toolState.isPainting3D && activeMeshObjectRef.current) {
      const paintMesh = activeMeshObjectRef.current;
      if (
        isPainting3DActiveRef.current &&
        paintPointerIdRef.current === e.pointerId &&
        (e.buttons & 1) !== 0 &&
        onDirect3DPaintPixel &&
        cameraRef.current
      ) {
        const from = lastPaintClientRef.current;
        const to = { x: e.clientX, y: e.clientY };
        // After a miss, don't bridge from off-mesh screen positions — that sweeps
        // rays across the silhouette and stamps stray dots near face tops/edges.
        const bridging = !!from;
        const sampleFrom = from ?? to;
        const skipStart = bridging;
        const texImage = meshTexturesRef.current.get(activeMeshId)?.texture?.image as
          | { width?: number }
          | undefined;
        const texSize =
          textureCanvas?.width
          || texImage?.width
          || 64;
        const strokeHits = samplePaintStrokeUvs(
          raycaster,
          cameraRef.current,
          paintMesh,
          rect,
          sampleFrom,
          to,
          {
            maxSteps: 64,
            textureSize: texSize,
            skipStart,
            // Samples are screen-space ray hits, so crossing a real model edge is safe.
            // Do not lock to the starting polygon or the stroke stops at face boundaries.
            maxUvJump: 0,
            // Imported and double-sided meshes can have reversed triangle winding.
            // A facing filter rejects valid visible hits on those surfaces.
            minFacing: 0,
          },
        );

        // Empty strokeHits can simply mean the pointer stayed in the same texel.
        setRayFromPointer(raycaster, cameraRef.current, to.x, to.y, rect);
        const endHit = pickPaintUv(raycaster, paintMesh);

        if (strokeHits.length > 0) {
          lastPaintClientRef.current = to;
          const last = strokeHits[strokeHits.length - 1];
          schedulePaintCursor({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            u: last.uv.x,
            v: last.uv.y,
          });
          if (meshTexturesRef.current.get(activeMeshId)?.texture) {
            meshTexturesRef.current.get(activeMeshId)!.texture.needsUpdate = true;
          }
          for (const sample of strokeHits) {
            onDirect3DPaintPixel(sample.uv.x, sample.uv.y, false, sample.faceId);
          }
        } else if (endHit) {
          lastPaintClientRef.current = to;
          schedulePaintCursor({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            u: endHit.uv.x,
            v: endHit.uv.y,
          });
        } else {
          // Left the mesh / locked face — don't gap-fill across the silhouette.
          lastPaintClientRef.current = null;
          schedulePaintCursor(null);
        }
      } else {
        const paintHits = raycaster.intersectObject(paintMesh);
        if (paintHits.length > 0 && paintHits[0].uv) {
          schedulePaintCursor({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            u: paintHits[0].uv.x,
            v: paintHits[0].uv.y,
          });
        } else {
          schedulePaintCursor(null);
        }
      }
      return;
    }

    if (toolState.rigMode === 'skin') {
      schedulePaintCursor({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        u: 0,
        v: 0,
      });
    }

    if (toolState.placeOnClick) {
      const hit = getGridIntersection(e);
      if (hit) setPlacementHoverPos(hit);
    } else if (toolState.editMode === 'vertex' && verticesGroupRef.current) {
      const intersects = raycaster.intersectObjects(verticesGroupRef.current.children);
      if (intersects.length > 0) {
        setHoveredVertexId(intersects[0].object.userData.vertexId);
      } else {
        setHoveredVertexId(null);
      }
    } else if (toolState.editMode === 'edge' && activeMesh) {
      const hit = pickClosestEdgeId(e.clientX, e.clientY, activeMesh);
      setHoveredEdgeId(hit);
    } else if (toolState.editMode === 'face' && activeMeshObjectRef.current) {
      const intersects = raycaster.intersectObject(activeMeshObjectRef.current);
      if (intersects.length > 0 && intersects[0].faceIndex != null) {
        const geo = activeMeshObjectRef.current.geometry;
        const triToFaceMap = geo.userData.triangleToFaceId as string[];
        if (triToFaceMap && triToFaceMap[intersects[0].faceIndex]) {
          setHoveredFaceId(triToFaceMap[intersects[0].faceIndex]);
        } else {
          const idx = Math.floor(intersects[0].faceIndex / 2);
          setHoveredFaceId(activeMesh.faces[idx]?.id || null);
        }
      } else {
        setHoveredFaceId(null);
      }
    } else if (meshesGroupRef.current) {
      const intersects = raycaster.intersectObjects(meshesGroupRef.current.children, true);
      if (intersects.length > 0) {
        let curr: THREE.Object3D | null = intersects[0].object;
        let hitMeshId: string | null = null;
        while (curr && curr !== meshesGroupRef.current) {
          if (curr.userData && curr.userData.meshId) {
            hitMeshId = curr.userData.meshId;
            break;
          }
          curr = curr.parent;
        }
        setHoveredMeshId(hitMeshId);
      } else {
        setHoveredMeshId(null);
      }
    }

    if (toolState.isCadDrawing) {
      if (cadStep === 1) {
        const point = getGridIntersection(e);
        if (point) setDrawBaseEnd(point);
      } else if (cadStep === 2 && drawBaseEnd) {
        const heightVal = getVerticalHeightIntersection(e, drawBaseEnd);
        setDrawHeight(heightVal);
      }
    }
  };

  const setViewOrientation = (dir: 'top' | 'front' | 'side' | 'iso') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    if (dir === 'top') camera.position.set(0, 8, 0);
    else if (dir === 'front') camera.position.set(0, 0, 8);
    else if (dir === 'side') camera.position.set(8, 0, 0);
    else if (dir === 'iso') camera.position.set(4, 4, 5);
    camera.lookAt(0, 0, 0);
    controlsRef.current.update();
  };

  const totalVerts = meshes.reduce((acc, m) => acc + m.vertices.length, 0);
  const totalFaces = meshes.reduce((acc, m) => acc + m.faces.length, 0);
  const isBlockout = activeWorkspaceMode === 'blockout';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#1b1b1b] select-none font-sans">
      <div
        ref={containerRef}
        onPointerDownCapture={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={`w-full h-full ${
          toolState.isCadDrawing
            ? 'cursor-cell'
            : toolState.placeOnClick
            ? 'cursor-crosshair'
            : toolState.isPainting3D || toolState.rigMode === 'skin'
            ? 'cursor-crosshair'
            : 'cursor-default'
        }`}
      />

      <VectorOverlay kind={cameraType as VectorViewportKind} active={isBlockout} />

      {(toolState.isPainting3D || toolState.rigMode === 'skin') && paintCursor && (
        <div
          className={`absolute pointer-events-none z-20 rounded-full border-2 shadow-[0_0_0_1px_#000] ${
            toolState.rigMode === 'skin' ? 'border-[#ec5b62]' : 'border-white shadow-[0_0_0_1px_#000,0_0_12px_#d946ef]'
          }`}
          style={{
            left: paintCursor.x,
            top: paintCursor.y,
            width: Math.max(12, 10 + (toolState.brushSize || 2) * (toolState.rigMode === 'skin' ? 8 : 3)),
            height: Math.max(12, 10 + (toolState.brushSize || 2) * (toolState.rigMode === 'skin' ? 8 : 3)),
            transform: 'translate(-50%, -50%)',
            background:
              toolState.rigMode === 'skin'
                ? 'rgba(236,91,98,.15)'
                : toolState.drawTool === 'eraser'
                ? 'rgba(244,63,94,.18)'
                : `${toolState.activeColor}33`,
          }}
          title={toolState.rigMode === 'skin' ? 'Weight paint brush' : `U ${paintCursor.u.toFixed(3)} V ${paintCursor.v.toFixed(3)}`}
        />
      )}

      <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5 z-10 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 pointer-events-none">
        {isQuadSubViewport ? (
          <span className="cad-card px-2 py-0.5 text-[#ff9a3c] font-extrabold uppercase border-[#4d4d4d] bg-[#1a1a1a]/90 backdrop-blur tracking-wider">
            {cameraType} {cameraType === 'perspective' ? '3D' : 'ORTHO'}
          </span>
        ) : (
          <span className="cad-card px-2.5 py-1 text-[#ff9a3c] font-bold uppercase border-[#4d4d4d] bg-[#262626]">
            {cameraType} VIEWPORT ({toolState.editMode.toUpperCase()} MODE)
          </span>
        )}
        {toolState.modalTransform && (
          <span className="cad-card px-2.5 py-1 text-[#e68619] font-bold border-[#e68619]/50 bg-[#262626] animate-pulse">
            {toolState.modalTransform === 'translate' ? 'GRAB (G)' : toolState.modalTransform === 'rotate' ? 'ROTATE (R)' : 'SCALE (S)'}
            {' · move mouse · LMB confirm · Esc/RMB cancel · gizmo for fine-tune'}
          </span>
        )}
        {toolState.modalMeshOp && (
          <span className="cad-card px-2.5 py-1 text-[#e68619] font-bold border-[#e68619]/50 bg-[#262626] animate-pulse">
            {toolState.modalMeshOp === 'extrude'
              ? 'EXTRUDE (E)'
              : toolState.modalMeshOp === 'inset'
                ? 'INSET (I)'
                : toolState.modalMeshOp === 'bevel'
                  ? 'BEVEL (Ctrl+B)'
                  : toolState.modalMeshOp === 'loopCut'
                    ? 'LOOP CUT (Ctrl+R)'
                    : 'KNIFE (K)'}
            {toolState.modalMeshOp === 'loopCut'
              ? ' · hover edge · click pin · slide · wheel cuts · LMB confirm · Esc/RMB cancel'
              : toolState.modalMeshOp === 'knife'
                ? ' · click path · Z undo · Enter confirm · Esc/RMB cancel'
                : toolState.modalMeshOp === 'bevel'
                  ? ' · move mouse · wheel segments · LMB/Enter confirm · Esc/RMB cancel'
                  : toolState.modalMeshOp === 'inset'
                    ? ' · move mouse to inset · LMB/Enter confirm · Esc/RMB cancel'
                    : ' · move mouse · LMB/Enter confirm · Esc/RMB cancel'}
          </span>
        )}
        {toolState.isPainting3D && (
          <span className="cad-card px-2.5 py-1 text-[#ffb366] font-bold border-[#ed7300] bg-[#262626]">
            3D PAINT ({toolState.drawTool?.toUpperCase() || 'PENCIL'}) · {PAINT_NAV_HINT}
          </span>
        )}
        {toolState.placeOnClick && (
          <span className="cad-card px-2.5 py-1 text-[#00ffcc] font-bold border-cyan-700 bg-[#262626] animate-pulse">
            PLACEMENT MODE: CLICK ANYWHERE TO DROP {toolState.activePrimitive.toUpperCase()} GHOST
          </span>
        )}
        {toolState.isCadDrawing && (
          <span className="cad-card px-2.5 py-1 text-emerald-400 font-bold border-emerald-900 bg-[#262626] animate-pulse">
            CAD DRAWING: {cadStep === 1 ? 'PART 1 (FLAT WIDTH & DEPTH)' : cadStep === 2 ? 'PART 2 (3D HEIGHT EXTRUSION)' : 'CLICK GRID TO START'}
          </span>
        )}
        {hoveredVertexId && (
          <span className="cad-card px-2.5 py-1 text-rose-400 font-bold border-rose-900 bg-[#262626] animate-pulse">
            HOVER: VERTEX #{hoveredVertexId}
          </span>
        )}
        {hoveredEdgeId && (
          <span className="cad-card px-2.5 py-1 text-[#ff9a3c] font-bold border-cyan-900 bg-[#262626] animate-pulse">
            HOVER: EDGE #{hoveredEdgeId}
          </span>
        )}
        {hoveredFaceId && (
          <span className="cad-card px-2.5 py-1 text-amber-400 font-bold border-amber-900 bg-[#262626] animate-pulse">
            HOVER: FACE #{hoveredFaceId}
          </span>
        )}
        {hoveredMeshId && (
          <span className="cad-card px-2.5 py-1 text-cyan-400 font-bold border-cyan-900 bg-[#262626]">
            HOVER: MESH #{hoveredMeshId}
          </span>
        )}
        {!isQuadSubViewport && (
          <span className="cad-card px-2.5 py-1 text-[#cccccc] bg-[#262626] border-[#4d4d4d]">
            GRID: {toolState.gridSnap === 0 ? 'OFF' : `${toolState.gridSnap}u`}
          </span>
        )}
        {toolState.rigMode === 'skin' && (
          <span className="cad-card px-2.5 py-1 text-[#ec5b62] font-bold border-[#ec5b62]/40 bg-[#ec5b62]/10">
            WEIGHT PAINT · {(toolState.weightPaintMode || 'add').toUpperCase()} · LMB on mesh paints · empty LMB orbits · {STANDARD_NAV_HINT}
          </span>
        )}
        {toolState.editMode === 'bone' && toolState.rigMode === 'pose' && (
          <span className="cad-card px-2.5 py-1 text-[#e68619] font-bold border-[#e68619]/40 bg-[#e68619]/10">
            POSE MODE
          </span>
        )}
        {toolState.editMode === 'bone' && toolState.rigMode === 'edit' && (
          <span className="cad-card px-2.5 py-1 text-[#ed7300] font-bold border-[#ed7300]/40 bg-[#ed7300]/10">
            BONE EDIT
          </span>
        )}
        </div>
        {isBlockout && (cameraType === 'front' || cameraType === 'side') && (
          <>
            <BlockoutRefToolbar plane={cameraType} />
            <BlockoutSilhouetteToolbar plane={cameraType} />
          </>
        )}
      </div>

      {!isQuadSubViewport && (
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-10 font-mono text-[10px]">
          <div className="cad-card p-1 flex gap-1 bg-[#262626] border-[#4d4d4d]">
            <button onClick={() => setViewOrientation('top')} className="px-2 py-0.5 cad-button font-bold">
              TOP
            </button>
            <button onClick={() => setViewOrientation('front')} className="px-2 py-0.5 cad-button font-bold">
              FRONT
            </button>
            <button onClick={() => setViewOrientation('side')} className="px-2 py-0.5 cad-button font-bold">
              SIDE
            </button>
            <button onClick={() => setViewOrientation('iso')} className="px-2 py-0.5 cad-button font-bold text-[#ff9a3c]">
              3D ISO
            </button>
            <button
              onClick={() => setToolState((s) => ({ ...s, xray: !s.xray }))}
              className={`px-2 py-0.5 cad-button font-bold transition flex items-center gap-1 ${toolState.xray ? 'text-[#ed7300] border-[#ed7300]/40 bg-[#ed7300]/10' : 'text-[#8c8c8c]'}`}
              title="Toggle X-Ray (Alt+Z) — see through meshes like Blender"
            >
              <span>[X-Ray: {toolState.xray ? 'ON' : 'OFF'}]</span>
            </button>
            <button
              onClick={() => setToolState((s) => ({ ...s, showBones: s.showBones !== undefined ? !s.showBones : !shouldShowBones }))}
              className={`px-2 py-0.5 cad-button font-bold transition flex items-center gap-1 ${shouldShowBones ? 'text-[#00ffff] border-[#00ffff]/40 bg-[#00ffff]/10' : 'text-[#8c8c8c]'}`}
              title="Toggle Skeleton / Bone Visibility in Viewport"
            >
              <span>[Bones: {shouldShowBones ? 'ON' : 'OFF'}]</span>
            </button>
            {onOpenUVModal && (
              <button
                onClick={onOpenUVModal}
                className="px-2.5 py-0.5 bg-[#ed7300] text-white font-bold rounded hover:bg-[#ff9a3c] transition shadow-md shadow-[#ed7300]/30 flex items-center gap-1"
                title="Open UV Mapping Studio Popup (Hotkey: U)"
              >
                <span>[UV Studio]</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* LightWave 3D Interactive Bottom-Right Navigation & Pen/Laptop Toolbar */}
      {!isBlockout && (
        <LightwaveNavToolbar
          toolState={toolState}
          setToolState={setToolState}
          onFocusCenter={handleFocusCenter}
          onDragPan={handleLightwaveDragPan}
          onDragOrbit={handleLightwaveDragOrbit}
          onDragZoom={handleLightwaveDragZoom}
          showOrbit={cameraType === 'perspective'}
          compact={isQuadSubViewport}
        />
      )}

      {!isQuadSubViewport && (
        <div className="absolute bottom-2 left-2 cad-card px-3 py-1 text-[10px] font-mono flex items-center gap-3 bg-[#262626] border-[#4d4d4d]">
          <span>Scene Objects: <strong className="text-amber-400">{meshes.length}</strong></span>
          <span>Rig Bones: <strong className="text-[#ed7300]">{bones.length}</strong></span>
          <span>Total Verts: <strong className="text-[#ff9a3c]">{totalVerts}</strong></span>
          <span>Total Faces: <strong className="text-[#ed7300]">{totalFaces}</strong></span>
          <span>Selected Mesh: <strong className="text-[#ff9a3c]">{activeMesh?.name || 'None'}</strong></span>
          {toolState.xray && (
            <span className="text-[#ed7300] font-bold" title="Alt+Z to toggle">
              X-RAY
            </span>
          )}
          <span className="text-[#6a7a8c]">{STANDARD_NAV_HINT}</span>
        </div>
      )}

      {/* Perforated Marquee Box Overlay */}
      {marqueeBox && containerRef.current && (() => {
        const rect = containerRef.current.getBoundingClientRect();
        const minX = Math.min(marqueeBox.x1, marqueeBox.x2) - rect.left;
        const maxX = Math.max(marqueeBox.x1, marqueeBox.x2) - rect.left;
        const minY = Math.min(marqueeBox.y1, marqueeBox.y2) - rect.top;
        const maxY = Math.max(marqueeBox.y1, marqueeBox.y2) - rect.top;
        const w = maxX - minX;
        const h = maxY - minY;

        return (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-[#ed7300] bg-[#ed7300]/15 backdrop-blur-[0.5px] z-40 rounded-sm shadow-md"
            style={{
              left: minX,
              top: minY,
              width: w,
              height: h,
            }}
          >
            <div className="absolute top-1 left-1.5 px-1.5 py-0.5 bg-[#ed7300] text-white font-mono text-[8px] font-bold rounded shadow-sm tracking-wider uppercase">
              MARQUEE ({toolState.editMode.toUpperCase()})
            </div>
          </div>
        );
      })()}
    </div>
  );
};

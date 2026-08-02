import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { Viewport3D } from './components/Viewport3D';
import { QuadViewport } from './components/QuadViewport';
import { UVEditor } from './components/UVEditor';
import { UVEditorModal } from './components/UVEditorModal';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RenderExportPanel } from './components/RenderExportPanel';
import { OutlinerPanel } from './components/OutlinerPanel';
/**
 * The animation and paint studios are the two heaviest modules in the app and each
 * is only reachable from its own workspace, so they load on demand instead of
 * inflating the initial bundle. Types are imported separately (erased at build time).
 */
const CutsceneStudio = lazy(() =>
  import('./components/CutsceneStudio').then((m) => ({ default: m.CutsceneStudio })),
);
const PixelPaintStudio = lazy(() =>
  import('./components/PixelPaintStudio').then((m) => ({ default: m.PixelPaintStudio })),
);
import { ParticleStudioModal } from './components/ParticleStudioModal';
import { RiggingPanel } from './components/RiggingPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { FloatingToolWindow, type ToolWindowTab } from './components/FloatingToolWindow';
import { FloatingOutliner } from './components/FloatingOutliner';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AssetBrowserModal } from './components/AssetBrowserModal';
import { ImportModelModal } from './components/ImportModelModal';
import { SpriteSheetModal } from './components/SpriteSheetModal';
import type { PaintTool as StudioPaintTool } from './components/PixelPaintStudio';
import { paint3dBridge } from './utils/paint3dSurface';
import { PaintBridgeHost } from './components/PaintBridgeHost';
import { notifyTexturePreview, setLiveTextureCanvas } from './utils/texturePreviewBus';
import { VectorPanel } from './components/VectorPanel';
import { useVectorStore } from './store/useVectorStore';
import {
  applyVectorSectionEdits,
  resolveVectorPartTransform,
  vectorPrimitiveToMesh,
  vectorPathsToMesh,
  vectorSnapshotToCADMesh,
} from './utils/vectorBlockout';
import type {
  CADMesh, SceneGroup, CADBone, ToolState, RenderSettings, PrimitiveType, CADScene, AnimationClip,
  CADCamera, CADLight, ParticleEmitter, EnvironmentSettings, SceneSelection,
  WorkspaceMode, HeaderWorkspace, RigMode, EditMode,
} from './types/cad';
import { generateId, generatePrimitive, createEdgesFromFaces } from './utils/meshUtils';
import { separateSelectedFaces, separateLooseParts } from './utils/meshSeparate';
import { import3DModelFromFile } from './utils/importers';
import { finalizeEditableMesh } from './utils/topology/validate';
import { edgeKey } from './utils/topology/ids';
import { mergeVerticesByDistance } from './utils/blockbenchCore';
import {
  applyMirrorSymmetry,
  applyModifiersToMesh,
  createMirrorModifier,
  createSubdivisionModifier,
  mirrorBones,
} from './utils/mirrorModeling';
import { catmullClarkSubdivide } from './utils/subdivision';
import {
  copyBones,
  copyMeshes,
  copySelectedGeometry,
  copySelectedVertices,
  pasteClipboardBones,
  pasteClipboardGeometry,
  pasteClipboardMeshes,
} from './utils/clipboard';
import { magnetSnapSelectedVertices } from './utils/vertexSnap';
import { subdivideFaces, fillSelectedVerticesFace } from './utils/advancedMeshTools';
import {
  convertSelection,
  EMPTY_SELECTION,
  growSelection,
  invertSelection,
  selectedIdsFor,
  selectLinked,
  shrinkSelection,
  withSelectedIds,
  type ComponentMode,
  type ComponentSelection,
} from './utils/selection';
import { applyLoopCut, applyKnifeCut, type KnifeHit } from './utils/meshCutTools';
import type { MirrorAxis } from './types/cad';
import { createDefaultClip, autoKeyTarget } from './utils/animation';
import { exportSceneToGLB } from './utils/glbExport';
import { createCamera, createDefaultEnvironment } from './utils/cutsceneEnv';
import { createCADLight, createDramaticThreePointLights } from './utils/cutsceneLights';
import { createEmptySequence, createSequenceClip, addClipToTrack } from './utils/sequence';
import type { CutsceneSequence } from './types/sequence';
import { deleteBoneBranch } from './utils/rigging';

import { Sliders, Palette, Sparkles, Layers, Bone } from 'lucide-react';

/** Placeholder shown while a lazily-loaded workspace chunk arrives. */
const WorkspaceLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#252525] text-[11px] text-[#858a93]">
    <div className="sp-workspace-spinner" aria-hidden />
    <span>
      Loading <b className="text-[#c6cad1]">{label}</b>…
    </span>
  </div>
);

export const App: React.FC = () => {
  const [scenes, setScenes] = useState<CADScene[]>(() => {
    const mesh = generatePrimitive('chest');
    const bones: CADBone[] = [
      {
        id: 'bone_root',
        name: 'Root_Spine',
        parentId: null,
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        restPosition: { x: 0, y: 0.5, z: 0 },
        restRotation: { x: 0, y: 0, z: 0 },
        restScale: { x: 1, y: 1, z: 1 },
        length: 0.8,
        assignedMeshIds: [],
        color: '#f59e0b',
        deform: true,
      },
    ];
    const clip = createDefaultClip([mesh], bones, 'Idle');
    const camera = createCamera('Shot Cam A');
    const [keyLight, fillLight, rimLight] = createDramaticThreePointLights();
    let sequence = createEmptySequence('Main Cutscene', Math.max(4, clip.duration), 24);
    const videoTrack = sequence.tracks.find((t) => t.kind === 'video');
    if (videoTrack) {
      sequence = addClipToTrack(
        sequence,
        videoTrack.id,
        createSequenceClip(videoTrack.id, clip.name, { type: 'animClip', refId: clip.id }, 0, clip.duration),
      );
    }
    return [
      {
        id: 'scene_main',
        name: 'Main Scene',
        meshes: [mesh],
        groups: [],
        bones,
        clips: [clip],
        activeClipId: clip.id,
        cameras: [camera],
        activeCameraId: camera.id,
        lights: [keyLight, fillLight, rimLight],
        particles: [],
        environment: createDefaultEnvironment(),
        sequence,
      },
    ];
  });
  const [activeSceneId, setActiveSceneId] = useState<string>('scene_main');
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState<WorkspaceMode>('modeling');
  const [blockoutStatus, setBlockoutStatus] = useState(
    'Trace Front, close it → Side cage seeds automatically. Drag width/depth, then Update for clean game quads.'
  );
  const [activeMeshId, setActiveMeshId] = useState<string>('');

  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];
  const meshes = activeScene.meshes;
  const groups = activeScene.groups;
  const bones = activeScene.bones || [];
  const clips = activeScene.clips || [];
  const activeClipId = activeScene.activeClipId || clips[0]?.id || null;
  const cameras = activeScene.cameras || [];
  const activeCameraId = activeScene.activeCameraId || cameras[0]?.id || null;
  const lights = activeScene.lights || [];
  const particles = activeScene.particles || [];
  const environment = activeScene.environment || createDefaultEnvironment();
  const sequence = activeScene.sequence || null;

  useEffect(() => {
    if (meshes.length > 0 && (!activeMeshId || !meshes.some((m) => m.id === activeMeshId))) {
      setActiveMeshId(meshes[0].id);
      setSelectedMeshIds((prev) => (prev.length === 0 ? [meshes[0].id] : prev));
    }
  }, [meshes, activeMeshId]);

  const setMeshes = (updater: CADMesh[] | ((prev: CADMesh[]) => CADMesh[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id === activeScene.id) {
          const nextMeshes = typeof updater === 'function' ? updater(s.meshes) : updater;
          return { ...s, meshes: nextMeshes };
        }
        return s;
      })
    );
  };

  const setGroups = (updater: SceneGroup[] | ((prev: SceneGroup[]) => SceneGroup[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id === activeScene.id) {
          const nextGroups = typeof updater === 'function' ? updater(s.groups) : updater;
          return { ...s, groups: nextGroups };
        }
        return s;
      })
    );
  };

  const setBones = (updater: CADBone[] | ((prev: CADBone[]) => CADBone[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id === activeScene.id) {
          const nextBones = typeof updater === 'function' ? updater(s.bones || []) : updater;
          return { ...s, bones: nextBones };
        }
        return s;
      })
    );
  };

  const setClips = (updater: AnimationClip[] | ((prev: AnimationClip[]) => AnimationClip[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id === activeScene.id) {
          const nextClips = typeof updater === 'function' ? updater(s.clips || []) : updater;
          return { ...s, clips: nextClips };
        }
        return s;
      })
    );
  };

  const setActiveClipId = (clipId: string | null) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => (s.id === activeScene.id ? { ...s, activeClipId: clipId } : s))
    );
  };

  const setCameras = (updater: CADCamera[] | ((prev: CADCamera[]) => CADCamera[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        const next = typeof updater === 'function' ? updater(s.cameras || []) : updater;
        return { ...s, cameras: next };
      })
    );
  };

  const setActiveCameraId = (cameraId: string | null) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => (s.id === activeScene.id ? { ...s, activeCameraId: cameraId } : s))
    );
  };

  const setParticles = (updater: ParticleEmitter[] | ((prev: ParticleEmitter[]) => ParticleEmitter[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        const next = typeof updater === 'function' ? updater(s.particles || []) : updater;
        return { ...s, particles: next };
      })
    );
  };

  const setEnvironment = (updater: EnvironmentSettings | ((prev: EnvironmentSettings) => EnvironmentSettings)) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        const prev = s.environment || createDefaultEnvironment();
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return { ...s, environment: next };
      })
    );
  };

  const setLights = (updater: CADLight[] | ((prev: CADLight[]) => CADLight[])) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        const next = typeof updater === 'function' ? updater(s.lights || []) : updater;
        return { ...s, lights: next };
      })
    );
  };

  const setSequence = (updater: CutsceneSequence | null | ((prev: CutsceneSequence | null) => CutsceneSequence | null)) => {
    setScenes((prevScenes) =>
      prevScenes.map((s) => {
        if (s.id !== activeScene.id) return s;
        const prev = s.sequence || null;
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return { ...s, sequence: next };
      })
    );
  };

  const handleExportGLB = async () => {
    const name = (activeScene.name || 'character').toLowerCase().replace(/\s+/g, '_');
    await exportSceneToGLB(meshes, bones, clips, `${name}.glb`);
  };

  const [selectedVertexIds, setSelectedVertexIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedFaceIds, setSelectedFaceIds] = useState<string[]>([]);
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);
  const [sceneSelection, setSceneSelectionRaw] = useState<SceneSelection | null>(null);
  const setSceneSelection = (sel: SceneSelection | null) => {
    setSceneSelectionRaw(sel);
    if (sel && sel.kind !== 'mesh') {
      setToolState((s) => ({ ...s, editMode: 'object', isPainting3D: false }));
    }
  };
  const [selectedBoneId, setSelectedBoneId] = useState<string>('bone_root');

  const activeMesh = meshes.find((m) => m.id === activeMeshId) || meshes[0] || generatePrimitive('cube');

  // --- Smart undo / redo (meshes + bones) ---
  type HistorySnap = { meshes: CADMesh[]; bones: CADBone[]; activeMeshId: string };
  const MAX_HISTORY = 80;
  const [undoStack, setUndoStack] = useState<HistorySnap[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnap[]>([]);
  const meshesRef = useRef(meshes);
  const bonesRef = useRef(bones);
  const activeMeshIdRef = useRef(activeMeshId);
  meshesRef.current = meshes;
  bonesRef.current = bones;
  activeMeshIdRef.current = activeMeshId;
  const skipHistoryRef = useRef(false);

  const captureSnap = (): HistorySnap => ({
    meshes: JSON.parse(JSON.stringify(meshesRef.current)),
    bones: JSON.parse(JSON.stringify(bonesRef.current)),
    activeMeshId: activeMeshIdRef.current,
  });

  const commitHistory = () => {
    if (skipHistoryRef.current) return;
    const snap = captureSnap();
    setUndoStack((prev) => {
      const next = [...prev, snap];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setRedoStack([]);
  };

  const restoreSnap = (snap: HistorySnap) => {
    skipHistoryRef.current = true;
    setMeshes(snap.meshes);
    setBones(snap.bones);
    setActiveMeshId(snap.activeMeshId);
    requestAnimationFrame(() => {
      skipHistoryRef.current = false;
    });
  };

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const current = captureSnap();
      const next = [...prev];
      const snap = next.pop()!;
      setRedoStack((r) => [...r, current]);
      restoreSnap(snap);
      return next;
    });
  };

  const handleRedo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const current = captureSnap();
      const next = [...prev];
      const snap = next.pop()!;
      setUndoStack((u) => [...u, current]);
      restoreSnap(snap);
      return next;
    });
  };

  const updateActiveMesh = (
    updater: CADMesh | ((prev: CADMesh) => CADMesh),
    opts?: { recordHistory?: boolean },
  ) => {
    // Default: no history (viewport gizmo streams). Discrete tools pass recordHistory: true.
    if (opts?.recordHistory) commitHistory();
    setMeshes((prev) =>
      prev.map((m) => {
        if (m.id === activeMeshIdRef.current || m.id === activeMesh.id) {
          return typeof updater === 'function' ? updater(m) : updater;
        }
        return m;
      }),
    );
  };

  /** Discrete mesh edit — always records undo. */
  const editActiveMesh = (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => {
    updateActiveMesh(updater, { recordHistory: true });
  };

  const updateBonesWithHistory = (updater: CADBone[] | ((prev: CADBone[]) => CADBone[])) => {
    commitHistory();
    setBones((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };

  const [toolState, setToolState] = useState<ToolState>({
    editMode: 'object',
    transformMode: 'move',
    isPainting3D: false,
    isCadDrawing: false,
    cadDrawPrimitive: null,
    gridSnap: 0.25,
    angleSnap: 15,
    activePrimitive: 'cube',
    viewMode: 'lit',
    viewportLayout: 'single',
    activeColor: '#ff9a3c',
    brushSize: 3,
    drawTool: 'pencil',
    paintOpacity: 1,
    paintSpacing: 0.12,
    paintMirrorU: false,
    uvSnapToPixel: true,
    placeOnClick: false,
    rigMode: 'edit',
    weightPaintMode: 'add',
    modalTransform: null,
    modalMeshOp: null,
    liveMirror: false,
    mirrorAxis: 'x',
    mirrorClip: true,
    mirrorMergeThreshold: 0.001,
    mirrorBones: false,
    xray: false,
  });
  const toolStatePaintRef = useRef(toolState);
  toolStatePaintRef.current = toolState;

  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    pixelScale: 1,
    dither: false,
    bloom: true,
    ssao: true,
    // OutlineForge LIVE 3D: hemisphere fill + strong soft key.
    ambientIntensity: 1.45,
    lightIntensity: 2.5,
    wireframeColor: '#ff9a3c',
    bgColor: '#141518',
    turntableSpeed: 1,
    isTurntablePlaying: false,
    weather: 'clear',
    fogDensity: 0,
    fogColor: '#a8b4c4',
    // ≈ directional light at (4, 7, 5)
    sunElevation: 48,
    sunAzimuth: 39,
  });

  const [activeRightTab, setActiveRightTab] = useState<'outliner' | 'properties' | 'material' | 'rig' | 'render'>('outliner');

  const [isToolWindowOpen, setIsToolWindowOpen] = useState(true);
  const [toolWindowTab, setToolWindowTab] = useState<ToolWindowTab>('tools');
  const [isFloatingOutlinerOpen, setIsFloatingOutlinerOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAssetBrowserOpen, setIsAssetBrowserOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSpriteSheetOpen, setIsSpriteSheetOpen] = useState(false);
  const [isUVModalOpen, setIsUVModalOpen] = useState(false);
  const [isParticleStudioOpen, setIsParticleStudioOpen] = useState(false);
  const [uvSplitOpen, setUvSplitOpen] = useState(false);
  const [uvPanelPercent, setUvPanelPercent] = useState(45);
  const splitWorkspaceRef = useRef<HTMLElement | null>(null);
  const isResizingUvRef = useRef(false);

  useEffect(() => {
    if (toolState.editMode === 'bone') {
      setActiveRightTab('rig');
      setIsToolWindowOpen(false);
      if (!selectedBoneId && bones[0]) setSelectedBoneId(bones[0].id);
    }
  }, [toolState.editMode, bones, selectedBoneId]);

  useEffect(() => {
    const handleUvResizeMove = (event: PointerEvent) => {
      if (!isResizingUvRef.current || !splitWorkspaceRef.current) return;
      const rect = splitWorkspaceRef.current.getBoundingClientRect();
      const next = ((rect.right - event.clientX) / rect.width) * 100;
      setUvPanelPercent(Math.max(25, Math.min(75, next)));
    };
    const handleUvResizeEnd = () => {
      isResizingUvRef.current = false;
    };
    window.addEventListener('pointermove', handleUvResizeMove);
    window.addEventListener('pointerup', handleUvResizeEnd);
    window.addEventListener('pointercancel', handleUvResizeEnd);
    return () => {
      window.removeEventListener('pointermove', handleUvResizeMove);
      window.removeEventListener('pointerup', handleUvResizeEnd);
      window.removeEventListener('pointercancel', handleUvResizeEnd);
    };
  }, []);

  const textureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textureRevision, setTextureRevision] = useState(0);
  const loadedTextureRef = useRef<{ meshId: string; dataUrl?: string }>({ meshId: '' });
  /** Always the module singleton — never nulled by React effect cleanup. */
  const paintBridgeRef = useRef(paint3dBridge);

  const flushLivePaintPreview = () => {
    // Viewport listens via texturePreviewBus — no App setState on every stamp.
    if (textureCanvasRef.current) setLiveTextureCanvas(textureCanvasRef.current);
    notifyTexturePreview();
  };

  /** When Paint allocates a new edit canvas, bump revision so Viewport rebinds the map. */
  const bindLiveTextureCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const prev = textureCanvasRef.current;
    textureCanvasRef.current = canvas;
    setLiveTextureCanvas(canvas);
    notifyTexturePreview();
    // Always bump when the caller hands us a canvas to bind (hydrate / new buffer).
    // Compare by identity so repeat calls with the same composite are cheap no-ops.
    if (prev !== canvas) {
      setTextureRevision((revision) => revision + 1);
    }
  }, []);

  useEffect(() => {
    if (!toolState.isPainting3D) return;
    // Keep any texture already on the mesh / canvas — never replace a UV image with blank.
    if (textureCanvasRef.current || activeMesh.textureCanvasDataUrl) return;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    textureCanvasRef.current = canvas;
    setLiveTextureCanvas(canvas);
    // Deferred: handleTextureUpdated defined below; use direct live canvas for now.
    notifyTexturePreview();
    setTextureRevision((r) => r + 1);
  }, [toolState.isPainting3D, activeMesh.id, activeMesh.textureCanvasDataUrl]);

  useEffect(() => {
    if (toolState.isPainting3D) setIsToolWindowOpen(false);
  }, [toolState.isPainting3D]);

  useEffect(() => {
    if (activeWorkspaceMode !== 'paint') return;
    setUvSplitOpen(false);
    setIsToolWindowOpen(false);
    setToolState((state) => ({
      ...state,
      isPainting3D: true,
      viewportLayout: 'single',
      viewMode: 'textured',
      editMode: 'object',
    }));
  }, [activeWorkspaceMode]);

  // Keep 3D painting armed for the whole Paint workspace (toolbar edit-modes must not disable it).
  useEffect(() => {
    if (activeWorkspaceMode !== 'paint') return;
    if (toolState.isPainting3D && toolState.viewMode === 'textured') return;
    setToolState((state) => ({
      ...state,
      isPainting3D: true,
      viewMode: 'textured',
      editMode: 'object',
    }));
  }, [activeWorkspaceMode, toolState.isPainting3D, toolState.viewMode]);

  const handleAddScene = () => {
    const mesh = generatePrimitive('cube');
    const clip = createDefaultClip([mesh], [], 'Idle');
    const camera = createCamera('Shot Cam A');
    const newScene: CADScene = {
      id: `scene_${Date.now()}`,
      name: `Scene ${scenes.length + 1}`,
      meshes: [mesh],
      groups: [],
      bones: [],
      clips: [clip],
      activeClipId: clip.id,
      cameras: [camera],
      activeCameraId: camera.id,
      lights: [createCADLight('directional', 'Key Light')],
      particles: [],
      environment: createDefaultEnvironment(),
      sequence: createEmptySequence(`Cutscene ${scenes.length + 1}`, 8, 24),
    };
    setScenes((prev) => [...prev, newScene]);
    setActiveSceneId(newScene.id);
  };

  const handleRenameScene = (id: string, newName: string) => {
    setScenes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
    );
  };

  const handleDeleteScene = (id: string) => {
    if (scenes.length <= 1) return;
    const remaining = scenes.filter((s) => s.id !== id);
    setScenes(remaining);
    if (activeSceneId === id) {
      setActiveSceneId(remaining[0].id);
    }
  };

  const updateMeshesWithHistory = (newMeshes: CADMesh[]) => {
    commitHistory();
    setMeshes(newMeshes);
  };

  const hasCurrentSelection = () => {
    if (toolState.editMode === 'object') return selectedMeshIds.length > 0;
    if (toolState.editMode === 'vertex') return selectedVertexIds.length > 0;
    if (toolState.editMode === 'edge') return selectedEdgeIds.length > 0;
    if (toolState.editMode === 'face') return selectedFaceIds.length > 0;
    if (toolState.editMode === 'bone') return Boolean(selectedBoneId);
    return false;
  };

  const handleSelectAll = () => {
    if (toolState.editMode === 'object') {
      const allIds = meshes.map((m) => m.id);
      setSelectedMeshIds(allIds);
      if (allIds.length > 0 && !allIds.includes(activeMeshId)) {
        setActiveMeshId(allIds[0]);
      }
    } else if (toolState.editMode === 'vertex' && activeMesh) {
      setSelectedVertexIds(activeMesh.vertices.map((v) => v.id));
    } else if (toolState.editMode === 'edge' && activeMesh) {
      setSelectedEdgeIds(activeMesh.edges.map((e) => e.id));
    } else if (toolState.editMode === 'face' && activeMesh) {
      setSelectedFaceIds(activeMesh.faces.map((f) => f.id));
    } else if (toolState.editMode === 'bone' && bones.length > 0) {
      setSelectedBoneId(bones[0].id);
    }
  };

  const handleUnselectAll = () => {
    if (toolState.editMode === 'object') {
      setSelectedMeshIds([]);
    } else if (toolState.editMode === 'vertex') {
      setSelectedVertexIds([]);
    } else if (toolState.editMode === 'edge') {
      setSelectedEdgeIds([]);
    } else if (toolState.editMode === 'face') {
      setSelectedFaceIds([]);
    } else if (toolState.editMode === 'bone') {
      setSelectedBoneId('');
    }
  };

  const handleToggleSelectAll = () => {
    if (hasCurrentSelection()) handleUnselectAll();
    else handleSelectAll();
  };

  /** Sub-object mode Tab returns to when toggling back out of Object mode. */
  const lastComponentModeRef = useRef<ComponentMode>('vertex');
  /**
   * Component selection stashed while in Object mode, so Tab-ing out and back in
   * restores it. Held in a ref rather than state because the rest of the app treats a
   * non-empty component selection as "we are in a sub-object mode".
   */
  const stashedComponentSelectionRef = useRef<ComponentSelection | null>(null);

  const currentComponentSelection = (): ComponentSelection => ({
    vertexIds: selectedVertexIds,
    edgeIds: selectedEdgeIds,
    faceIds: selectedFaceIds,
  });

  const applyComponentSelection = (next: ComponentSelection) => {
    setSelectedVertexIds(next.vertexIds);
    setSelectedEdgeIds(next.edgeIds);
    setSelectedFaceIds(next.faceIds);
  };

  /**
   * Switch between Object / Vertex / Edge / Face.
   *
   * Moving between two sub-object modes converts the selection through the mesh
   * topology instead of discarding it, so the user keeps their work when pressing
   * 1/2/3/4 (widening takes everything touched, narrowing only fully-enclosed
   * components — the Blender rule).
   */
  const enterEditMode = (mode: EditMode) => {
    if (workspaceModeRef.current === 'rigging') {
      setActiveWorkspaceMode('modeling');
      setActiveRightTab((tab) => (tab === 'rig' ? 'outliner' : tab));
    }

    const prev = toolState.editMode;
    const isComponent = (m: EditMode): m is ComponentMode =>
      m === 'vertex' || m === 'edge' || m === 'face';

    // Read before updating: this is the mode any stashed selection belongs to.
    const stashedMode = lastComponentModeRef.current;
    if (isComponent(mode)) lastComponentModeRef.current = mode;

    if (isComponent(mode) && isComponent(prev) && activeMesh) {
      applyComponentSelection(convertSelection(activeMesh, prev, mode, currentComponentSelection()));
    } else if (isComponent(mode)) {
      // Coming back from Object/Bone mode: restore what was stashed on the way out,
      // converted if the target mode differs from the one we left.
      const stashed = stashedComponentSelectionRef.current;
      stashedComponentSelectionRef.current = null;
      applyComponentSelection(
        stashed && activeMesh
          ? convertSelection(activeMesh, stashedMode, mode, stashed)
          : EMPTY_SELECTION,
      );
    } else {
      // Leaving for Object/Bone mode — stash so Tab can bring the selection back.
      if (isComponent(prev)) stashedComponentSelectionRef.current = currentComponentSelection();
      applyComponentSelection(EMPTY_SELECTION);
    }

    setToolState((s) => ({
      ...s,
      editMode: mode,
      isPainting3D: false,
      modalTransform: null,
      modalMeshOp: null,
      ...(s.editMode === 'bone' || workspaceModeRef.current === 'rigging' ? { showBones: false } : {}),
    }));
  };

  /** Tab toggles between Object mode and the sub-object mode you were last in. */
  const toggleEditMode = () => {
    enterEditMode(toolState.editMode === 'object' ? lastComponentModeRef.current : 'object');
  };

  /** Run a selection operator against whichever sub-object mode is active. */
  const runSelectionOperator = (
    operator: (mesh: CADMesh, mode: ComponentMode, ids: string[]) => string[],
  ) => {
    const mode = toolState.editMode;
    if (!activeMesh || (mode !== 'vertex' && mode !== 'edge' && mode !== 'face')) return;
    const ids = selectedIdsFor(currentComponentSelection(), mode);
    applyComponentSelection(withSelectedIds(mode, operator(activeMesh, mode, ids)));
  };

  const modalTransformRef = useRef(toolState.modalTransform);
  modalTransformRef.current = toolState.modalTransform;
  const modalMeshOpRef = useRef(toolState.modalMeshOp);
  modalMeshOpRef.current = toolState.modalMeshOp;
  const workspaceModeRef = useRef(activeWorkspaceMode);
  workspaceModeRef.current = activeWorkspaceMode;
  const modalMeshSnapshotRef = useRef<{
    type: 'extrude' | 'inset' | 'bevel' | 'loopCut' | 'knife';
    baseMesh: CADMesh;
    faceIds: string[];
    edgeIds: string[];
  } | null>(null);

  const confirmModalMeshOp = () => {
    modalMeshSnapshotRef.current = null;
    setToolState((s) => ({ ...s, modalMeshOp: null }));
  };

  const cancelModalMeshOp = () => {
    const snap = modalMeshSnapshotRef.current;
    if (snap) {
      setMeshes((prev) => prev.map((m) => (m.id === snap.baseMesh.id ? snap.baseMesh : m)));
    }
    modalMeshSnapshotRef.current = null;
    setToolState((s) => ({ ...s, modalMeshOp: null }));
  };

  const confirmModalLoopCut = (loopEdgeIds: string[], factors: number[]) => {
    const snap = modalMeshSnapshotRef.current;
    if (!snap || snap.type !== 'loopCut') return;
    const next = applyLoopCut(snap.baseMesh, loopEdgeIds, factors);
    setMeshes((prev) => prev.map((m) => (m.id === snap.baseMesh.id ? next : m)));
    modalMeshSnapshotRef.current = null;
    setToolState((s) => ({ ...s, modalMeshOp: null }));
  };

  const confirmModalKnife = (hits: KnifeHit[]) => {
    const snap = modalMeshSnapshotRef.current;
    if (!snap || snap.type !== 'knife') return;
    const next = applyKnifeCut(snap.baseMesh, hits);
    setMeshes((prev) => prev.map((m) => (m.id === snap.baseMesh.id ? next : m)));
    modalMeshSnapshotRef.current = null;
    setToolState((s) => ({ ...s, modalMeshOp: null }));
  };

  const startModalMeshOp = (type: 'extrude' | 'inset' | 'bevel' | 'loopCut' | 'knife') => {
    if (!activeMesh) return;
    if ((type === 'extrude' || type === 'inset') && selectedFaceIds.length === 0) return;
    if (type === 'bevel' && selectedEdgeIds.length === 0 && selectedFaceIds.length === 0) return;

    commitHistory();
    modalMeshSnapshotRef.current = {
      type,
      baseMesh: JSON.parse(JSON.stringify(activeMesh)) as CADMesh,
      faceIds: [...selectedFaceIds],
      edgeIds: [...selectedEdgeIds],
    };
    const editMode =
      type === 'loopCut' || (type === 'bevel' && selectedEdgeIds.length > 0)
        ? 'edge'
        : type === 'knife'
          ? 'face'
          : 'face';
    setToolState((s) => ({
      ...s,
      modalMeshOp: type,
      modalTransform: null,
      editMode,
      isPainting3D: false,
      transformMode: type === 'inset' ? 'scale' : 'move',
    }));
  };

  const confirmModalMeshOpRef = useRef(confirmModalMeshOp);
  confirmModalMeshOpRef.current = confirmModalMeshOp;
  const cancelModalMeshOpRef = useRef(cancelModalMeshOp);
  cancelModalMeshOpRef.current = cancelModalMeshOp;
  const confirmModalLoopCutRef = useRef(confirmModalLoopCut);
  confirmModalLoopCutRef.current = confirmModalLoopCut;
  const confirmModalKnifeRef = useRef(confirmModalKnife);
  confirmModalKnifeRef.current = confirmModalKnife;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      // Animation editor owns G/R/S/Esc modal transforms while active.
      if (workspaceModeRef.current === 'animation') return;
      // Paint workspace owns G (fill), E (eraser), I (eyedropper), etc. — don't steal for grab/extrude.
      const inPaintWorkspace = workspaceModeRef.current === 'paint';
      const inBlockout = workspaceModeRef.current === 'blockout';

      if (inBlockout) {
        if (e.key === 'Escape') {
          e.preventDefault();
          useVectorStore.getState().setSelected(null);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          useVectorStore.getState().undo();
          return;
        }
        if (
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
          || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
        ) {
          e.preventDefault();
          useVectorStore.getState().redo();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          useVectorStore.getState().deleteSelected();
          return;
        }
        // Blockout owns drawing — skip modeling/edit-mode hotkeys.
        if (!e.ctrlKey && !e.metaKey && !e.altKey) return;
      }

      /** Selection operators only apply while a sub-object mode is active. */
      const inComponentMode =
        toolState.editMode === 'vertex'
        || toolState.editMode === 'edge'
        || toolState.editMode === 'face';

      if (e.key === 'Escape') {
        // Blender: Esc cancels modal ops first (viewport restores via capture).
        if (modalTransformRef.current || modalMeshOpRef.current) {
          e.preventDefault();
          return;
        }
        handleUnselectAll();
        setToolState((s) => ({
          ...s,
          isCadDrawing: false,
          placeOnClick: false,
          cadDrawPrimitive: null,
          modalTransform: null,
          modalMeshOp: null,
        }));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
      } else if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleUnselectAll();
      } else if (e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setToolState((s) => ({ ...s, xray: !s.xray }));
      } else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        handleToggleSelectAll();
      } else if (
        (e.ctrlKey || e.metaKey)
        && e.key.toLowerCase() === 'i'
        && inComponentMode
      ) {
        // In a sub-object mode Ctrl+I inverts (Blender); Object mode keeps Import.
        e.preventDefault();
        runSelectionOperator((mesh, mode, ids) => invertSelection(mesh, mode, ids));
      } else if (
        e.key.toLowerCase() === 'l'
        && !e.altKey
        && inComponentMode
      ) {
        // L / Ctrl+L both grow the selection to the whole connected island.
        e.preventDefault();
        runSelectionOperator(selectLinked);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=') && inComponentMode) {
        e.preventDefault();
        runSelectionOperator(growSelection);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_') && inComponentMode) {
        e.preventDefault();
        runSelectionOperator(shrinkSelection);
      } else if (
        (inPaintWorkspace || toolState.isPainting3D)
        && !e.ctrlKey && !e.metaKey && !e.altKey
        && ['b', 'e', 'i'].includes(e.key.toLowerCase())
      ) {
        // 3D paint tool hotkeys — keep them working while the mesh viewport is focused.
        e.preventDefault();
        const paintHotkey = e.key.toLowerCase();
        const nextTool =
          paintHotkey === 'b' ? 'pencil' : paintHotkey === 'e' ? 'eraser' : 'picker';
        setToolState((s) => ({
          ...s,
          drawTool: nextTool,
          isPainting3D: true,
          viewMode: 'textured',
          editMode: 'object',
        }));
      } else if (
        (inPaintWorkspace || toolState.isPainting3D)
        && !e.ctrlKey && !e.metaKey && !e.altKey
        && (e.key === '[' || e.key === ']')
      ) {
        e.preventDefault();
        const delta = e.key === ']' ? 1 : -1;
        setToolState((s) => ({
          ...s,
          brushSize: Math.max(1, Math.min(16, (s.brushSize || 1) + delta)),
        }));
      } else if (!inPaintWorkspace && e.key === '1') {
        enterEditMode('object');
      } else if (!inPaintWorkspace && e.key === '2') {
        enterEditMode('vertex');
      } else if (!inPaintWorkspace && e.key === '3') {
        enterEditMode('edge');
      } else if (!inPaintWorkspace && e.key === '4') {
        enterEditMode('face');
      } else if (!inPaintWorkspace && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Blender-style in/out of edit mode. Must preventDefault or focus walks the UI.
        e.preventDefault();
        toggleEditMode();
      } else if (!inPaintWorkspace && e.key === '5') {
        setActiveWorkspaceMode('rigging');
        setUvSplitOpen(false);
        setIsToolWindowOpen(false);
        setActiveRightTab('rig');
        setToolState((s) => ({
          ...s,
          editMode: 'bone',
          isPainting3D: false,
          isCadDrawing: false,
          placeOnClick: false,
          rigMode: s.rigMode || 'edit',
          showBones: true,
          weightPaintMode: s.weightPaintMode || 'add',
          viewportLayout: 'single',
          modalTransform: null,
          modalMeshOp: null,
        }));
        if (!selectedBoneId && bones[0]) setSelectedBoneId(bones[0].id);
      }
      else if (e.shiftKey && e.key.toLowerCase() === 't') {
        if (isToolWindowOpen && toolWindowTab === 'tools') setIsToolWindowOpen(false);
        else {
          setToolWindowTab('tools');
          setIsToolWindowOpen(true);
        }
      }
      else if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't steal typing when focus is in an input
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setIsFloatingOutlinerOpen((prev) => !prev);
      }
      else if (e.key.toLowerCase() === 'u' && !inPaintWorkspace) setIsUVModalOpen((prev) => !prev);
      else if (!inPaintWorkspace && e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setToolState((s) => ({ ...s, transformMode: 'move', modalTransform: 'translate', modalMeshOp: null, isPainting3D: false }));
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setToolState((s) => ({ ...s, transformMode: 'rotate', modalTransform: 'rotate', modalMeshOp: null, isPainting3D: false }));
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 's' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setToolState((s) => ({ ...s, transformMode: 'scale', modalTransform: 'scale', modalMeshOp: null, isPainting3D: false }));
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        startModalMeshOp('extrude');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        startModalMeshOp('bevel');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsImportModalOpen(true);
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        startModalMeshOp('inset');
      } else if (e.shiftKey && e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        handleSeparateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleAddSubdivision();
      } else if (!inPaintWorkspace && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        startModalMeshOp('loopCut');
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        startModalMeshOp('knife');
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'f') {
        if (activeMesh && selectedVertexIds.length >= 3) editActiveMesh(fillSelectedVerticesFace(activeMesh, selectedVertexIds));
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'm' && !e.ctrlKey) handleMergeVertices();
      else if (!inPaintWorkspace && e.shiftKey && e.key.toLowerCase() === 's') handleMagnetSnap();
      else if (!inPaintWorkspace && e.altKey && e.key.toLowerCase() === 'x') handleMirrorSymmetry();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
        || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') handleDeleteSelected();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    toolState.editMode,
    toolState.isPainting3D,
    selectedFaceIds,
    selectedEdgeIds,
    selectedVertexIds,
    selectedMeshIds,
    selectedBoneId,
    activeMesh,
    activeMeshId,
    meshes,
    bones,
    undoStack.length,
    redoStack.length,
    isToolWindowOpen,
    toolWindowTab,
  ]);

  const handleMergeVertices = () => {
    if (!activeMesh) return;
    editActiveMesh(mergeVerticesByDistance(activeMesh, 0.05));
  };

  const handleMirrorSymmetry = () => {
    const axis = (toolState.mirrorAxis || 'x') as MirrorAxis;
    const clip = toolState.mirrorClip !== false;
    const threshold = toolState.mirrorMergeThreshold ?? 0.001;

    if (toolState.editMode === 'bone' || toolState.mirrorBones) {
      if (!selectedBoneId) return;
      updateBonesWithHistory((prev) => {
        const result = mirrorBones(prev, selectedBoneId, axis, { includeChildren: true });
        setSelectedBoneId(result.newSelectionId);
        return result.bones;
      });
      if (!toolState.mirrorBones || toolState.editMode === 'bone') return;
    }

    if (!activeMesh) return;
    editActiveMesh(applyMirrorSymmetry(activeMesh, axis, { clip, mergeThreshold: threshold }));
  };

  const handleAddMirrorModifier = () => {
    if (!activeMesh) return;
    const axis = (toolState.mirrorAxis || 'x') as MirrorAxis;
    editActiveMesh((prev) => ({
      ...prev,
      modifiers: [...(prev.modifiers || []), createMirrorModifier(axis, toolState.mirrorClip !== false, toolState.mirrorMergeThreshold ?? 0.001)],
    }));
  };

  const handleAddSubdivision = (levels = 1) => {
    if (!activeMesh) return;
    const existing = (activeMesh.modifiers || []).find((m) => m.type === 'subdivision');
    if (existing && existing.type === 'subdivision') {
      editActiveMesh((prev) => ({
        ...prev,
        modifiers: (prev.modifiers || []).map((m) =>
          m.type === 'subdivision'
            ? { ...m, enabled: true, levels: Math.min(4, Math.max(0, levels)) }
            : m,
        ),
      }));
      return;
    }
    editActiveMesh((prev) => ({
      ...prev,
      modifiers: [...(prev.modifiers || []), createSubdivisionModifier(levels)],
    }));
  };

  const handleApplySubdivideDestructive = () => {
    if (!activeMesh) return;
    if (selectedFaceIds.length > 0) {
      editActiveMesh(subdivideFaces(activeMesh, selectedFaceIds));
      return;
    }
    const sub = (activeMesh.modifiers || []).find((m) => m.type === 'subdivision' && m.enabled);
    if (sub && sub.type === 'subdivision') {
      const levels = Math.max(1, sub.levels);
      editActiveMesh((prev) => {
        const next = sub.algorithm === 'simple'
          ? subdivideFaces(prev)
          : catmullClarkSubdivide(prev, levels);
        return {
          ...next,
          modifiers: (prev.modifiers || []).filter((m) => m.type !== 'subdivision'),
        };
      });
      return;
    }
    editActiveMesh(catmullClarkSubdivide(activeMesh, 1));
  };

  const handleApplyModifiers = () => {
    if (!activeMesh?.modifiers?.length) return;
    editActiveMesh(applyModifiersToMesh(activeMesh));
  };

  const handleCopy = () => {
    if (toolState.editMode === 'bone' && selectedBoneId) {
      const bone = bones.find((b) => b.id === selectedBoneId);
      if (bone) copyBones([bone]);
      return;
    }
    if (toolState.editMode === 'object') {
      const ids = selectedMeshIds.length ? selectedMeshIds : [activeMeshId];
      copyMeshes(meshes.filter((m) => ids.includes(m.id)));
      return;
    }
    if (toolState.editMode === 'face' && selectedFaceIds.length) {
      copySelectedGeometry(activeMesh, selectedFaceIds);
      return;
    }
    if (toolState.editMode === 'vertex' && selectedVertexIds.length) {
      copySelectedVertices(activeMesh, selectedVertexIds);
      return;
    }
    if (selectedFaceIds.length) copySelectedGeometry(activeMesh, selectedFaceIds);
    else if (selectedMeshIds.length) copyMeshes(meshes.filter((m) => selectedMeshIds.includes(m.id)));
    else copyMeshes([activeMesh]);
  };

  const handlePaste = () => {
    if (toolState.editMode === 'bone') {
      updateBonesWithHistory((prev) => {
        const { bones: next, newSelectionId } = pasteClipboardBones(prev);
        if (newSelectionId) setSelectedBoneId(newSelectionId);
        return next;
      });
      return;
    }
    if (toolState.editMode === 'object') {
      commitHistory();
      const { meshes: next, newIds } = pasteClipboardMeshes(meshes);
      if (newIds.length) {
        setMeshes(next);
        setActiveMeshId(newIds[0]);
        setSelectedMeshIds(newIds);
      }
      return;
    }
    const { mesh: next, newFaceIds, newVertexIds } = pasteClipboardGeometry(activeMesh);
    if (newFaceIds.length || newVertexIds.length) {
      updateActiveMesh(next, { recordHistory: true });
      if (newFaceIds.length) {
        setSelectedFaceIds(newFaceIds);
        setToolState((s) => ({ ...s, editMode: 'face' }));
      } else if (newVertexIds.length) {
        setSelectedVertexIds(newVertexIds);
        setToolState((s) => ({ ...s, editMode: 'vertex' }));
      }
      return;
    }
    commitHistory();
    const { meshes: nextMeshes, newIds } = pasteClipboardMeshes(meshes);
    if (newIds.length) {
      setMeshes(nextMeshes);
      setActiveMeshId(newIds[0]);
      setSelectedMeshIds(newIds);
    }
  };

  const handleMagnetSnap = () => {
    if (!activeMesh || selectedVertexIds.length === 0) return;
    const snapped = magnetSnapSelectedVertices(activeMesh, selectedVertexIds, 0.3);
    editActiveMesh(snapped);
  };

  const handleSpawnPrimitive = (type: PrimitiveType) => {
    setToolState((s) => ({
      ...s,
      placeOnClick: true,
      activePrimitive: type,
      isCadDrawing: false,
    }));
  };

  const handleSpawnDrawnPrimitive = (newMesh: CADMesh) => {
    updateMeshesWithHistory([...meshes, newMesh]);
    setActiveMeshId(newMesh.id);
    setSelectedMeshIds([newMesh.id]);
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
  };

  const handleVectorBuildAll = (built: CADMesh[]) => {
    if (!built.length) return;
    commitHistory();
    const sameVector = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
    const nextBuilt = built.map((incoming) => {
      const existing = meshes.find(
        (mesh) => incoming.blockoutPartId && mesh.blockoutPartId === incoming.blockoutPartId
      );
      if (!existing) return incoming;
      const previousAuthored = existing.blockoutTransform;
      const manuallyTransformed = !!previousAuthored && (
        !sameVector(existing.position, previousAuthored.position) ||
        !sameVector(existing.rotation, previousAuthored.rotation) ||
        !sameVector(existing.scale, previousAuthored.scale)
      );
      return {
        ...incoming,
        id: existing.id,
        position: manuallyTransformed ? existing.position : incoming.position,
        rotation: manuallyTransformed ? existing.rotation : incoming.rotation,
        scale: manuallyTransformed ? existing.scale : incoming.scale,
        textureCanvasDataUrl: existing.textureCanvasDataUrl,
        textureAnimation: existing.textureAnimation,
        boneId: existing.boneId,
        visible: existing.visible,
        locked: existing.locked,
        doubleSided: existing.doubleSided,
        modifiers: existing.modifiers,
      };
    });
    const retained = meshes.filter((mesh) => !mesh.blockoutPartId);
    const nextMeshes = [...retained, ...nextBuilt];
    setMeshes(nextMeshes);
    setActiveMeshId(nextBuilt[0].id);
    setSelectedMeshIds([nextBuilt[0].id]);
    setSceneSelection({ kind: 'mesh', id: nextBuilt[0].id });
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
    setToolState((s) => ({
      ...s,
      editMode: 'object',
      // Shaded solid like reference blockout after Build.
      viewMode: 'lit',
      isPainting3D: false,
    }));
  };

  /** Commit current Blockout curves into the scene — one mesh object per part. */
  const commitBlockoutMeshFromStore = (): CADMesh[] | null => {
    const store = useVectorStore.getState();
    const buildParts = store.parts.map((part) =>
      part.id === store.activePartId ? { ...part, paths: store.paths } : part
    );
    const generated = buildParts
      .filter((part) => !part.hidden)
      .map((part) => {
        const base = part.kind === 'primitive' && part.primitive
          ? vectorPrimitiveToMesh(part.primitive)
          : vectorPathsToMesh(
              part.paths.front.closed ? part.paths.front : null,
              part.paths.side.closed ? part.paths.side : null,
              store.verticalSegments,
              store.radialSegments,
              part.paths.top.closed ? part.paths.top : null,
              {
                thickness: store.thickness,
                gameTopology: true,
                capStyle: store.capStyle,
                taperThickness: true,
                roundness: store.roundness,
              }
            );
        return { part, mesh: base ? applyVectorSectionEdits(base, part.sections || []) : null };
      })
      .filter((item): item is { part: (typeof buildParts)[number]; mesh: NonNullable<typeof item.mesh> } => !!item.mesh);
    if (!generated.length) return null;
    const built = generated.map((item) => {
      const transform = resolveVectorPartTransform(item.part, buildParts);
      const cad = vectorSnapshotToCADMesh(item.mesh, item.part.name, {
        seedTexture: '#d2b48c',
        transform,
      });
      const authored = {
        position: { ...cad.position },
        rotation: { ...cad.rotation },
        scale: { ...cad.scale },
      };
      return {
        ...cad,
        blockoutPartId: item.part.id,
        blockoutRevision: store.revision,
        blockoutTransform: authored,
      };
    });
    handleVectorBuildAll(built);
    store.markBuilt();
    const totalVerts = built.reduce((n, m) => n + m.vertices.length, 0);
    setBlockoutStatus(
      `Blockout in scene as ${built.length} object${built.length === 1 ? '' : 's'} (${totalVerts} verts). MODEL / Mat / UV / Paint ready.`
    );
    return built;
  };

  const handleVectorAddActive = (mesh: CADMesh) => {
    commitHistory();
    const existing = meshes.find(
      (item) => mesh.blockoutPartId && item.blockoutPartId === mesh.blockoutPartId
    );
    const previousAuthored = existing?.blockoutTransform;
    const manuallyTransformed = !!existing && !!previousAuthored && (
      Math.abs(existing.position.x - previousAuthored.position.x) > 1e-6 ||
      Math.abs(existing.position.y - previousAuthored.position.y) > 1e-6 ||
      Math.abs(existing.position.z - previousAuthored.position.z) > 1e-6 ||
      Math.abs(existing.rotation.x - previousAuthored.rotation.x) > 1e-6 ||
      Math.abs(existing.rotation.y - previousAuthored.rotation.y) > 1e-6 ||
      Math.abs(existing.rotation.z - previousAuthored.rotation.z) > 1e-6 ||
      Math.abs(existing.scale.x - previousAuthored.scale.x) > 1e-6 ||
      Math.abs(existing.scale.y - previousAuthored.scale.y) > 1e-6 ||
      Math.abs(existing.scale.z - previousAuthored.scale.z) > 1e-6
    );
    const next = existing
      ? {
          ...mesh,
          id: existing.id,
          position: manuallyTransformed ? existing.position : mesh.position,
          rotation: manuallyTransformed ? existing.rotation : mesh.rotation,
          scale: manuallyTransformed ? existing.scale : mesh.scale,
          textureCanvasDataUrl: existing.textureCanvasDataUrl,
          textureAnimation: existing.textureAnimation,
          boneId: existing.boneId,
          visible: existing.visible,
          locked: existing.locked,
          modifiers: existing.modifiers,
        }
      : mesh;
    updateMeshesWithHistory(
      existing
        ? meshes.map((item) => item.id === existing.id ? next : item)
        : [...meshes, next]
    );
    setActiveMeshId(next.id);
    setSelectedMeshIds([next.id]);
    setSceneSelection({ kind: 'mesh', id: next.id });
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
    setToolState((s) => ({ ...s, editMode: 'object', viewMode: 'lit', isPainting3D: false }));
  };

  const handleImportMeshes = (imported: CADMesh[]) => {
    if (!imported.length) return;
    updateMeshesWithHistory([...meshes, ...imported]);
    const last = imported[imported.length - 1];
    setActiveMeshId(last.id);
    setSelectedMeshIds(imported.map((m) => m.id));
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
  };

  const handleExtrudeFace = () => startModalMeshOp('extrude');

  const handleInsetFace = () => startModalMeshOp('inset');

  const handleBevelEdges = () => startModalMeshOp('bevel');

  const handleLoopCut = () => startModalMeshOp('loopCut');

  const handleKnife = () => startModalMeshOp('knife');

  const handleDeleteSelected = () => {
    if (toolState.editMode === 'bone' && selectedBoneId) {
      const removed = new Set<string>();
      const collect = (id: string) => {
        removed.add(id);
        bones.forEach((b) => {
          if (b.parentId === id) collect(b.id);
        });
      };
      collect(selectedBoneId);
      setBones((prev) => deleteBoneBranch(prev, selectedBoneId));
      setMeshes((prev) =>
        prev.map((mesh) => ({
          ...mesh,
          boneId: mesh.boneId && removed.has(mesh.boneId) ? null : mesh.boneId,
          skinWeights: mesh.skinWeights
            ? Object.fromEntries(
                Object.entries(mesh.skinWeights).map(([vertexId, weights]) => [
                  vertexId,
                  weights.filter((weight) => !removed.has(weight.boneId)),
                ]),
              )
            : undefined,
        })),
      );
      setSelectedBoneId('');
      return;
    }
    if (!activeMesh) return;
    if (toolState.editMode === 'vertex' && selectedVertexIds.length > 0) {
      const remainingVerts = activeMesh.vertices.filter((v) => !selectedVertexIds.includes(v.id));
      const remainingFaces = activeMesh.faces.filter(
        (f) => !f.vertexIds.some((vId) => selectedVertexIds.includes(vId))
      );
      updateActiveMesh(finalizeEditableMesh({
        ...activeMesh,
        vertices: remainingVerts,
        faces: remainingFaces,
      }), { recordHistory: true });
      setSelectedVertexIds([]);
    } else if (toolState.editMode === 'edge' && selectedEdgeIds.length > 0) {
      const removeKeys = new Set(
        activeMesh.edges
          .filter((e) => selectedEdgeIds.includes(e.id))
          .map((e) => edgeKey(e.v1Id, e.v2Id)),
      );
      const remainingFaces = activeMesh.faces.filter((face) => {
        const n = face.vertexIds.length;
        for (let i = 0; i < n; i++) {
          if (removeKeys.has(edgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]))) return false;
        }
        return true;
      });
      const used = new Set<string>();
      remainingFaces.forEach((f) => f.vertexIds.forEach((id) => used.add(id)));
      updateActiveMesh(finalizeEditableMesh({
        ...activeMesh,
        vertices: activeMesh.vertices.filter((v) => used.has(v.id)),
        faces: remainingFaces,
      }), { recordHistory: true });
      setSelectedEdgeIds([]);
    } else if (toolState.editMode === 'face' && selectedFaceIds.length > 0) {
      const remainingFaces = activeMesh.faces.filter((f) => !selectedFaceIds.includes(f.id));
      const used = new Set<string>();
      remainingFaces.forEach((f) => f.vertexIds.forEach((id) => used.add(id)));
      updateActiveMesh(finalizeEditableMesh({
        ...activeMesh,
        vertices: activeMesh.vertices.filter((v) => used.has(v.id)),
        faces: remainingFaces,
      }), { recordHistory: true });
      setSelectedFaceIds([]);
    }
  };

  const handleDeleteMesh = (id: string) => {
    if (meshes.length <= 1) return;
    const remaining = meshes.filter((m) => m.id !== id);
    updateMeshesWithHistory(remaining);
    setSelectedMeshIds((prev) => {
      const next = prev.filter((meshId) => meshId !== id);
      return next.length > 0 ? next : remaining[0] ? [remaining[0].id] : [];
    });
    if (activeMeshId === id) {
      setActiveMeshId(remaining[0].id);
    }
  };

  const cloneCadMesh = (source: CADMesh): CADMesh => {
    const vertexMap = new Map(source.vertices.map((v) => [v.id, generateId('v')]));
    const edgeMap = new Map(source.edges.map((e) => [e.id, generateId('e')]));
    const faceMap = new Map(source.faces.map((f) => [f.id, generateId('f')]));
    const mapV = (id: string) => vertexMap.get(id) || id;
    const mapF = (id: string) => faceMap.get(id) || id;
    const skinWeights = source.skinWeights
      ? Object.fromEntries(
          Object.entries(source.skinWeights).map(([vertexId, weights]) => [
            mapV(vertexId),
            weights.map((w) => ({ ...w })),
          ]),
        )
      : undefined;
    return {
      ...source,
      id: generateId('mesh'),
      name: `${source.name}_copy`,
      position: {
        x: source.position.x + 0.5,
        y: source.position.y,
        z: source.position.z + 0.5,
      },
      vertices: source.vertices.map((v) => ({ ...v, id: mapV(v.id) })),
      edges: source.edges.map((e) => ({
        ...e,
        id: edgeMap.get(e.id) || e.id,
        v1Id: mapV(e.v1Id),
        v2Id: mapV(e.v2Id),
        faceIds: e.faceIds?.map(mapF),
      })),
      faces: source.faces.map((f) => ({
        ...f,
        id: faceMap.get(f.id) || f.id,
        vertexIds: f.vertexIds.map(mapV),
        uvs: f.uvs.map((uv) => ({ ...uv })),
      })),
      skinWeights,
      revision: (source.revision || 0) + 1,
    };
  };

  /** Duplicate active/selected mesh(es). Optional meshId used by Outliner. */
  const handleDuplicateSelected = (meshId?: string) => {
    const ids = meshId
      ? [meshId]
      : selectedMeshIds.length
        ? selectedMeshIds
        : activeMeshId
          ? [activeMeshId]
          : [];
    const sources = ids.map((id) => meshes.find((m) => m.id === id)).filter(Boolean) as CADMesh[];
    if (!sources.length) return;
    const clones = sources.map(cloneCadMesh);
    updateMeshesWithHistory([...meshes, ...clones]);
    setActiveMeshId(clones[0].id);
    setSelectedMeshIds(clones.map((m) => m.id));
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
  };

  /**
   * Separate into a new object (Blender-style P):
   * - Face mode + faces selected → peel selection into a new mesh
   * - Otherwise (object mode / outliner) → split loose connected parts
   */
  const handleSeparateSelected = (meshId?: string) => {
    const targetId = meshId || activeMeshId;
    const mesh = meshes.find((m) => m.id === targetId);
    if (!mesh || mesh.locked) return;

    const preferFaces =
      !meshId &&
      toolState.editMode === 'face' &&
      selectedFaceIds.length > 0;

    const result = preferFaces
      ? separateSelectedFaces(mesh, selectedFaceIds)
      : separateLooseParts(mesh);
    if (!result || !result.separated.length) return;

    const next = meshes.flatMap((m) => {
      if (m.id !== mesh.id) return [m];
      const out: CADMesh[] = [];
      if (result.remaining) out.push(result.remaining);
      out.push(...result.separated);
      return out;
    });
    if (!next.length) return;

    updateMeshesWithHistory(next);
    setActiveMeshId(result.separated[0].id);
    setSelectedMeshIds([result.separated[0].id]);
    setSceneSelection({ kind: 'mesh', id: result.separated[0].id });
    setSelectedVertexIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
    setToolState((s) => ({ ...s, editMode: 'object' }));
  };

  const handleKeyPoseToClip = (opts?: { time?: number; selectedOnly?: boolean }) => {
    const keyTime = Math.max(0, opts?.time ?? 0);
    const selectedOnly = opts?.selectedOnly === true;
    let clipId = activeClipId;
    setClips((prev) => {
      let clipsNext = prev;
      if (!clipsNext.length) {
        const clip = createDefaultClip(meshes, bones, 'Pose');
        clipId = clip.id;
        clipsNext = [clip];
        setActiveClipId(clip.id);
      }
      const targetId = clipId || clipsNext[0]?.id;
      if (!targetId) return clipsNext;
      const bonesToKey = selectedOnly && selectedBoneId
        ? bones.filter((bone) => bone.id === selectedBoneId)
        : bones;
      return clipsNext.map((clip) => {
        if (clip.id !== targetId) return clip;
        let next = clip;
        // Extend clip duration if keying past the end.
        if (keyTime > next.duration) {
          next = { ...next, duration: Math.ceil(keyTime * 10) / 10 + 0.5 };
        }
        bonesToKey.forEach((bone) => {
          next = autoKeyTarget(next, bone.id, 'bone', bone.name, {
            position: bone.position,
            rotation: bone.rotation,
            scale: bone.scale,
          }, keyTime);
        });
        if (!selectedOnly) {
          meshes.forEach((mesh) => {
            next = autoKeyTarget(next, mesh.id, 'mesh', mesh.name, {
              position: mesh.position,
              rotation: mesh.rotation,
              scale: mesh.scale,
            }, keyTime);
          });
        }
        return next;
      });
    });
  };

  const enterRigMode = (mode: RigMode) => {
    setActiveWorkspaceMode('rigging');
    setUvSplitOpen(false);
    setIsToolWindowOpen(false);
    setActiveRightTab('rig');
    setToolState((s) => ({
      ...s,
      editMode: 'bone',
      isPainting3D: false,
      isCadDrawing: false,
      placeOnClick: false,
      rigMode: mode,
      weightPaintMode: s.weightPaintMode || 'add',
      showBones: true,
      viewportLayout: 'single',
      brushSize: mode === 'skin' ? Math.max(s.brushSize, 2) : s.brushSize,
    }));
    if (!selectedBoneId && bones[0]) setSelectedBoneId(bones[0].id);
  };

  const textureEncodeTimerRef = useRef(0);

  useEffect(() => {
    return () => {
      if (textureEncodeTimerRef.current) {
        window.clearTimeout(textureEncodeTimerRef.current);
        textureEncodeTimerRef.current = 0;
      }
    };
  }, []);

  const handleTextureUpdated = (
    canvas: HTMLCanvasElement,
    opts?: { clearAnimation?: boolean; immediate?: boolean; encode?: boolean },
  ) => {
    textureCanvasRef.current = canvas;
    setLiveTextureCanvas(canvas);
    setToolState((state) => (state.viewMode === 'textured' ? state : { ...state, viewMode: 'textured' }));

    const isLarge = Math.max(canvas.width, canvas.height) >= 256;
    const wantEncode = opts?.encode === true || opts?.immediate === true || opts?.clearAnimation === true;

    // Large stills during live paint: preview only — encode on leave Paint / explicit encode.
    if (!wantEncode && isLarge) {
      notifyTexturePreview();
      // Rebind when the canvas instance changed (Paint hydrate), not every stamp.
      setTextureRevision((revision) => revision + 1);
      return;
    }

    setTextureRevision((revision) => revision + 1);
    notifyTexturePreview();

    const commitDataUrl = () => {
      textureEncodeTimerRef.current = 0;
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch {
        return;
      }
      loadedTextureRef.current = { meshId: activeMesh.id, dataUrl };
      updateActiveMesh((prev) => ({
        ...prev,
        textureCanvasDataUrl: dataUrl,
        ...(opts?.clearAnimation ? { textureAnimation: undefined } : {}),
      }));
    };

    if (textureEncodeTimerRef.current) {
      window.clearTimeout(textureEncodeTimerRef.current);
      textureEncodeTimerRef.current = 0;
    }

    if (wantEncode || opts?.immediate || opts?.clearAnimation) {
      textureEncodeTimerRef.current = window.setTimeout(commitDataUrl, 0);
    } else if (!isLarge) {
      // Small pixel canvases: debounced encode is cheap enough.
      textureEncodeTimerRef.current = window.setTimeout(commitDataUrl, 1000);
    }
  };

  /** UV / Load Image — replace any stale paint animation strip. */
  const handleUvTextureLoaded = (canvas: HTMLCanvasElement) => {
    handleTextureUpdated(canvas, { clearAnimation: true, immediate: true, encode: true });
  };

  const commitLiveTextureEncode = (opts?: { clearAnimation?: boolean }) => {
    const canvas = textureCanvasRef.current;
    if (!canvas) return;
    handleTextureUpdated(canvas, { encode: true, immediate: true, clearAnimation: opts?.clearAnimation });
  };

  // Encode large stills when leaving Paint (strokes stay on the live canvas until then).
  const prevWorkspaceRef = useRef(activeWorkspaceMode);
  useEffect(() => {
    const prev = prevWorkspaceRef.current;
    prevWorkspaceRef.current = activeWorkspaceMode;
    if (prev === 'paint' && activeWorkspaceMode !== 'paint') {
      commitLiveTextureEncode();
    }
  }, [activeWorkspaceMode]);

  useEffect(() => {
    // Paint studio owns the live canvas — rebuilding from dataUrl steals the ref and
    // makes strokes look like they "don't draw" (edits go to a detached layer).
    if (activeWorkspaceMode === 'paint') return;

    const dataUrl = activeMesh.textureCanvasDataUrl;
    if (loadedTextureRef.current.meshId === activeMesh.id && loadedTextureRef.current.dataUrl === dataUrl) return;
    if (!dataUrl) {
      textureCanvasRef.current = null;
      loadedTextureRef.current = { meshId: activeMesh.id };
      setTextureRevision((revision) => revision + 1);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, image.naturalWidth);
      canvas.height = Math.max(1, image.naturalHeight);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      textureCanvasRef.current = canvas;
      loadedTextureRef.current = { meshId: activeMesh.id, dataUrl };
      setTextureRevision((revision) => revision + 1);
    };
    image.src = dataUrl;
    return () => { cancelled = true; };
  }, [activeMesh.id, activeMesh.textureCanvasDataUrl, activeWorkspaceMode]);

  const handleDirect3DPaintPixel = (uvU: number, uvV: number, isFinal = false, faceId: string | null = null) => {
    const ts = toolStatePaintRef.current;
    const drawTool = ts.drawTool || 'pencil';
    // Select is for picking meshes — never stamp paint.
    if (drawTool === 'select') {
      if (isFinal) paint3dBridge.endStroke();
      return;
    }
    const studioTool: StudioPaintTool =
      drawTool === 'rectangle' ? 'rect' :
      (drawTool as StudioPaintTool);
    if (isFinal) {
      paint3dBridge.endStroke();
      return;
    }
    // Module singleton — immune to React remounts / history / layers effect cleanup.
    paint3dBridge.paintUv(
      uvU,
      uvV,
      ts.activeColor || '#ff9a3c',
      ts.brushSize || 1,
      studioTool,
      ts.paintOpacity ?? 1,
      faceId,
    );
    // GitHub main always flushed after stamp so the Viewport CanvasTexture uploads
    // even if the host refresh path is briefly unbound mid-workspace switch.
    flushLivePaintPreview();
  };

  const handleLoadJSON = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.mesh && Array.isArray(parsed.mesh.vertices)) {
        const mesh = finalizeEditableMesh({
          ...parsed.mesh,
          edges: parsed.mesh.edges?.length
            ? parsed.mesh.edges
            : createEdgesFromFaces(parsed.mesh.faces),
        });
        updateMeshesWithHistory([mesh]);
        setActiveMeshId(mesh.id);
        setSelectedMeshIds([mesh.id]);
        return;
      }
      if (Array.isArray(parsed.meshes) && parsed.meshes.length) {
        const next = parsed.meshes
          .filter((m: CADMesh) => m && Array.isArray(m.vertices) && Array.isArray(m.faces))
          .map((m: CADMesh) =>
            finalizeEditableMesh({
              ...m,
              edges: m.edges?.length ? m.edges : createEdgesFromFaces(m.faces),
            }),
          );
        if (!next.length) return;
        updateMeshesWithHistory(next);
        setActiveMeshId(next[0].id);
        setSelectedMeshIds(next.map((m: CADMesh) => m.id));
        return;
      }
      if (parsed.polystage_mesh && Array.isArray(parsed.polystage_mesh.vertices)) {
        const mesh = finalizeEditableMesh({
          ...parsed.polystage_mesh,
          id: generateId(),
          edges: parsed.polystage_mesh.edges?.length
            ? parsed.polystage_mesh.edges
            : createEdgesFromFaces(parsed.polystage_mesh.faces),
        });
        updateMeshesWithHistory([mesh]);
        setActiveMeshId(mesh.id);
        setSelectedMeshIds([mesh.id]);
      }
    } catch (err) {
      console.error('Failed to parse project JSON:', err);
    }
  };

  const handleOpenFile = async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const projectLike = ['json', 'bbmodel', 'polystage', 'picocad2'].includes(ext);

    if (projectLike) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.mesh || parsed.meshes || parsed.polystage_mesh) {
          handleLoadJSON(text);
          return;
        }
      } catch {
        // Fall through to geometry import
      }
    }

    const result = await import3DModelFromFile(file);
    if (result.meshes.length) {
      handleImportMeshes(result.meshes);
    } else if (result.error) {
      console.error(result.error);
    }
  };

  const editorSplitOpen = uvSplitOpen || activeWorkspaceMode === 'paint';
  const editorPanelLabel = activeWorkspaceMode === 'paint' ? 'Pixel Editor' : 'UV Editor';
  const leaveRigOverlay = () => {
    // Rig entry forces showBones + the Rig right-tab; clear both so MODEL/PAINT/UV
    // don't keep the skeleton overlay from the previous Rig session.
    setActiveRightTab((tab) => (tab === 'rig' ? 'outliner' : tab));
  };

  const selectWorkspace = (workspace: HeaderWorkspace) => {
    // Ghost preview is not a scene mesh — commit Blockout curves before leaving.
    if (activeWorkspaceMode === 'blockout' && workspace !== 'blockout') {
      const committed = commitBlockoutMeshFromStore();
      if (!committed) {
        setBlockoutStatus(
          'No closed Front/Side silhouette to send. Scene mesh unchanged — finish the blockout or Build first.'
        );
      }
    }

    if (workspace === 'modeling') {
      setActiveWorkspaceMode('modeling');
      setUvSplitOpen(false);
      leaveRigOverlay();
      setToolState((state) => ({
        ...state,
        isPainting3D: false,
        editMode: 'object',
        viewMode: 'lit',
        viewportLayout: 'single',
        isCadDrawing: false,
        placeOnClick: false,
        showBones: false,
      }));
      return;
    }
    if (workspace === 'blockout') {
      setActiveWorkspaceMode('blockout');
      setUvSplitOpen(false);
      setIsToolWindowOpen(false);
      leaveRigOverlay();
      setSelectedMeshIds([]);
      setSelectedVertexIds([]);
      setSelectedEdgeIds([]);
      setSelectedFaceIds([]);
      setSceneSelection(null);
      useVectorStore.getState().setActivePlane('side');
      setBlockoutStatus(
        'Close a Front or Side silhouette for height. Top is optional and shapes the XZ cross-section.'
      );
      setToolState((state) => ({
        ...state,
        isPainting3D: false,
        editMode: 'object',
        viewMode: 'lit',
        viewportLayout: 'quad',
        isCadDrawing: false,
        placeOnClick: false,
        showBones: false,
      }));
      return;
    }
    if (workspace === 'paint') {
      setActiveWorkspaceMode('paint');
      setUvSplitOpen(false);
      setIsToolWindowOpen(false);
      // Give the 3D mesh more room; pixel editor stays usable on the right.
      setUvPanelPercent(38);
      leaveRigOverlay();
      setToolState((state) => ({
        ...state,
        isPainting3D: true,
        editMode: 'object',
        viewMode: 'textured',
        viewportLayout: 'single',
        drawTool: 'pencil',
        // Usable 3D brush defaults — larger soft brush, tight spacing for continuous feel.
        brushSize: Math.max(state.brushSize || 1, 3),
        paintSpacing: Math.min(state.paintSpacing ?? 0.12, 0.12),
        paintOpacity: state.paintOpacity ?? 1,
        isCadDrawing: false,
        placeOnClick: false,
        showBones: false,
      }));
      return;
    }
    if (workspace === 'brush') {
      setActiveWorkspaceMode('modeling');
      setUvSplitOpen(false);
      setIsToolWindowOpen(false);
      leaveRigOverlay();
      setToolState((state) => ({
        ...state,
        isPainting3D: true,
        editMode: 'object',
        viewMode: 'textured',
        viewportLayout: 'single',
        drawTool: 'pencil',
        isCadDrawing: false,
        placeOnClick: false,
        showBones: false,
      }));
      return;
    }
    if (workspace === 'rig') {
      enterRigMode('edit');
      return;
    }
    if (workspace === 'animation') {
      setActiveWorkspaceMode('animation');
      setUvSplitOpen(false);
      setToolState((state) => ({
        ...state,
        isPainting3D: false,
        isCadDrawing: false,
        placeOnClick: false,
        // Keep / restore bones in Anim — useful while posing.
        showBones: true,
      }));
      return;
    }

    setActiveWorkspaceMode('modeling');
    setUvSplitOpen(true);
    setIsToolWindowOpen(false);
    leaveRigOverlay();
    setToolState((state) => ({
      ...state,
      isPainting3D: false,
      editMode: 'face',
      viewportLayout: 'single',
      isCadDrawing: false,
      placeOnClick: false,
      showBones: false,
    }));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1e2023] text-[#c6cad1] overflow-hidden font-sans select-none app-shell">
      <Header
        toolState={toolState}
        setToolState={setToolState}
        mesh={activeMesh}
        setMesh={updateActiveMesh}
        scenes={scenes}
        activeSceneId={activeSceneId}
        setActiveSceneId={setActiveSceneId}
        onAddScene={handleAddScene}
        onRenameScene={handleRenameScene}
        onDeleteScene={handleDeleteScene}
        activeWorkspaceMode={activeWorkspaceMode}
        setActiveWorkspaceMode={setActiveWorkspaceMode}
        onSelectWorkspace={selectWorkspace}
        undo={handleUndo}
        redo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onOpenPresets={() => setIsAssetBrowserOpen(true)}
        onOpenAssetBrowser={() => setIsAssetBrowserOpen(true)}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenSpriteSheetModal={() => setIsSpriteSheetOpen(true)}
        onNewModel={() => handleSpawnPrimitive('cube')}
        onLoadJSON={handleLoadJSON}
        onOpenFile={handleOpenFile}
        onToggleSelectAll={handleToggleSelectAll}
        onDeselectAll={handleUnselectAll}
        onExportGLB={handleExportGLB}
        onEnterRigMode={enterRigMode}
        uvSplitOpen={uvSplitOpen}
        isToolWindowOpen={isToolWindowOpen && toolWindowTab === 'tools'}
        onToggleToolWindow={() => {
          if (isToolWindowOpen && toolWindowTab === 'tools') setIsToolWindowOpen(false);
          else {
            setToolWindowTab('tools');
            setIsToolWindowOpen(true);
          }
        }}
        isPaletteOpen={isToolWindowOpen && toolWindowTab === 'primitives'}
        onTogglePalette={() => {
          if (isToolWindowOpen && toolWindowTab === 'primitives') setIsToolWindowOpen(false);
          else {
            setToolWindowTab('primitives');
            setIsToolWindowOpen(true);
          }
        }}
        isOutlinerOpen={isFloatingOutlinerOpen}
        onToggleOutliner={() => setIsFloatingOutlinerOpen((prev) => !prev)}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {activeWorkspaceMode !== 'blockout' && (
        <Toolbar
          toolState={toolState}
          setToolState={setToolState}
          onSpawnPrimitive={handleSpawnPrimitive}
          onExtrudeFace={handleExtrudeFace}
          onInsetFace={handleInsetFace}
          onDeleteSelected={handleDeleteSelected}
          onDuplicateSelected={handleDuplicateSelected}
          onMergeVertices={handleMergeVertices}
          onMirrorSymmetry={handleMirrorSymmetry}
          onMagnetSnap={handleMagnetSnap}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleUnselectAll}
          paintWorkspace={activeWorkspaceMode === 'paint'}
          rigWorkspace={activeWorkspaceMode === 'rigging'}
        />
        )}

        <main ref={splitWorkspaceRef} className="flex-1 h-full relative overflow-hidden bg-[#252525] flex">
          <section
            className={`h-full relative overflow-hidden ${activeWorkspaceMode === 'blockout' ? 'vector-panel-host' : ''}`}
            style={{ width: editorSplitOpen ? `calc(${100 - uvPanelPercent}% - 8px)` : '100%' }}
          >
          {activeWorkspaceMode === 'animation' ? (
              <Suspense fallback={<WorkspaceLoading label="Animation Studio" />}>
              <CutsceneStudio
                sceneName={activeScene.name}
                scenes={scenes.map((s) => ({ id: s.id, name: s.name, meshCount: s.meshes.length }))}
                activeSceneId={activeSceneId}
                setActiveSceneId={setActiveSceneId}
                meshes={meshes}
                setMeshes={setMeshes}
                bones={bones}
                setBones={setBones}
                clips={clips}
                setClips={setClips}
                activeClipId={activeClipId}
                setActiveClipId={setActiveClipId}
                cameras={cameras}
                setCameras={setCameras}
                activeCameraId={activeCameraId}
                setActiveCameraId={setActiveCameraId}
                lights={lights}
                setLights={setLights}
                particles={particles}
                setParticles={setParticles}
                environment={environment}
                setEnvironment={setEnvironment}
                sequence={sequence}
                setSequence={setSequence}
                textureCanvas={textureCanvasRef.current}
                textureRevision={textureRevision}
                activeMeshId={activeMeshId}
              />
              </Suspense>
          ) : toolState.viewportLayout === 'single' && activeWorkspaceMode !== 'blockout' ? (
            <Viewport3D
              meshes={meshes}
              bones={bones}
              setBones={setBones}
              selectedBoneId={selectedBoneId}
              setSelectedBoneId={setSelectedBoneId}
              activeMeshId={activeMeshId}
              setActiveMeshId={setActiveMeshId}
              setMesh={updateActiveMesh}
              toolState={toolState}
              setToolState={setToolState}
              renderSettings={renderSettings}
              textureCanvas={textureCanvasRef.current}
              textureRevision={textureRevision}
              selectedVertexIds={selectedVertexIds}
              setSelectedVertexIds={setSelectedVertexIds}
              selectedEdgeIds={selectedEdgeIds}
              setSelectedEdgeIds={setSelectedEdgeIds}
              selectedFaceIds={selectedFaceIds}
              setSelectedFaceIds={setSelectedFaceIds}
              selectedMeshIds={selectedMeshIds}
              setSelectedMeshIds={setSelectedMeshIds}
              activeWorkspaceMode={activeWorkspaceMode}
              uvObjectRetargeting={uvSplitOpen}
              activeRightTab={activeRightTab}
              onDirect3DPaintPixel={handleDirect3DPaintPixel}
              onSpawnDrawnPrimitive={handleSpawnDrawnPrimitive}
              onOpenUVModal={() => setIsUVModalOpen(true)}
              onModalMeshConfirm={() => confirmModalMeshOpRef.current()}
              onModalMeshCancel={() => cancelModalMeshOpRef.current()}
              onModalLoopCutConfirm={(loopEdgeIds, factors) => confirmModalLoopCutRef.current(loopEdgeIds, factors)}
              onModalKnifeConfirm={(hits) => confirmModalKnifeRef.current(hits)}
              onBeginHistory={commitHistory}
              cameras={cameras}
              lights={lights}
              particles={particles}
              environment={environment}
              setCameras={setCameras}
              setLights={setLights}
              setParticles={setParticles}
              setEnvironment={setEnvironment}
              sceneSelection={sceneSelection}
              setSceneSelection={setSceneSelection}
            />
          ) : (
            <QuadViewport
              meshes={meshes}
              activeMeshId={activeMeshId}
              setActiveMeshId={setActiveMeshId}
              setMesh={updateActiveMesh}
              toolState={toolState}
              setToolState={setToolState}
              renderSettings={renderSettings}
              textureCanvas={textureCanvasRef.current}
              textureReadyTick={textureRevision}
              selectedVertexIds={selectedVertexIds}
              setSelectedVertexIds={setSelectedVertexIds}
              selectedEdgeIds={selectedEdgeIds}
              setSelectedEdgeIds={setSelectedEdgeIds}
              selectedFaceIds={selectedFaceIds}
              setSelectedFaceIds={setSelectedFaceIds}
              selectedMeshIds={selectedMeshIds}
              setSelectedMeshIds={setSelectedMeshIds}
              onDirect3DPaintPixel={handleDirect3DPaintPixel}
              onSpawnDrawnPrimitive={handleSpawnDrawnPrimitive}
              onOpenUVModal={() => setIsUVModalOpen(true)}
              onModalMeshConfirm={() => confirmModalMeshOpRef.current()}
              onModalMeshCancel={() => cancelModalMeshOpRef.current()}
              onModalLoopCutConfirm={(loopEdgeIds, factors) => confirmModalLoopCutRef.current(loopEdgeIds, factors)}
              onModalKnifeConfirm={(hits) => confirmModalKnifeRef.current(hits)}
              onBeginHistory={commitHistory}
              cameras={cameras}
              lights={lights}
              particles={particles}
              environment={environment}
              setCameras={setCameras}
              setLights={setLights}
              setParticles={setParticles}
              setEnvironment={setEnvironment}
              sceneSelection={sceneSelection}
              setSceneSelection={setSceneSelection}
              activeWorkspaceMode={activeWorkspaceMode}
              layout={activeWorkspaceMode === 'blockout' ? 'blockout' : 'quad'}
            />
          )}

          {activeWorkspaceMode === 'blockout' && (
            <VectorPanel
              onBuildAll={handleVectorBuildAll}
              onAddActive={handleVectorAddActive}
              onBuildAndEdit={() => {
                // Mesh already committed via onBuildAll — just open MODEL.
                setActiveWorkspaceMode('modeling');
                setUvSplitOpen(false);
                leaveRigOverlay();
                setToolState((state) => ({
                  ...state,
                  isPainting3D: false,
                  editMode: 'object',
                  viewMode: 'lit',
                  viewportLayout: 'single',
                  isCadDrawing: false,
                  placeOnClick: false,
                  showBones: false,
                }));
              }}
              onStatus={setBlockoutStatus}
            />
          )}

          </section>
          {editorSplitOpen && (
            <>
              <div
                role="separator"
                aria-label={`Resize ${editorPanelLabel}`}
                aria-orientation="vertical"
                aria-valuemin={25}
                aria-valuemax={75}
                aria-valuenow={Math.round(uvPanelPercent)}
                tabIndex={0}
                onDoubleClick={() => setUvPanelPercent(45)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setUvPanelPercent((value) => Math.min(75, value + 2));
                  if (e.key === 'ArrowRight') setUvPanelPercent((value) => Math.max(25, value - 2));
                  if (e.key === 'Home') setUvPanelPercent(45);
                }}
                onPointerDown={(e) => {
                  isResizingUvRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  isResizingUvRef.current = false;
                  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* capture already released */ }
                }}
                onPointerCancel={() => { isResizingUvRef.current = false; }}
                className="adobe-divider group relative z-30 w-2 shrink-0 cursor-col-resize border-x touch-none"
                title="Drag to resize · Double-click to reset"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#3b3f46] group-hover:w-0.5 group-hover:bg-[#ed7300]" />
                <div className="adobe-divider-handle absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-3 flex flex-col items-center justify-center gap-1">
                  <span className="w-0.5 h-0.5 rounded-full bg-[#3b3f46]" />
                  <span className="w-0.5 h-0.5 rounded-full bg-[#3b3f46]" />
                  <span className="w-0.5 h-0.5 rounded-full bg-[#3b3f46]" />
                </div>
              </div>
              <section
                className="min-w-0 h-full bg-[#1e2023]"
                style={{ width: `${uvPanelPercent}%` }}
              >
                {activeWorkspaceMode === 'paint' ? (
                  <Suspense fallback={<WorkspaceLoading label="Pixel Paint" />}>
                  <PixelPaintStudio
                    key={activeMesh.id}
                    toolState={toolState}
                    setToolState={setToolState}
                    onTextureUpdated={handleTextureUpdated}
                    onLiveTextureFlush={flushLivePaintPreview}
                    onBindLiveTextureCanvas={bindLiveTextureCanvas}
                    textureCanvasRef={textureCanvasRef}
                    initialDataUrl={activeMesh.textureCanvasDataUrl}
                    paintBridgeRef={paintBridgeRef}
                    mesh={activeMesh}
                    selectedFaceIds={selectedFaceIds}
                    onTextureAnimationChange={(anim) => {
                      // Skip stuffing multi‑MB frame PNGs into React state for large stills.
                      if (anim.width >= 256 && anim.frames.length <= 1) return;
                      updateActiveMesh((prev) => ({
                        ...prev,
                        textureAnimation: anim,
                        textureCanvasDataUrl:
                          anim.frames[0]?.dataUrl || prev.textureCanvasDataUrl,
                      }));
                    }}
                  />
                  </Suspense>
                ) : (
                  <UVEditor
                    mesh={activeMesh}
                    setMesh={updateActiveMesh}
                    meshes={meshes}
                    activeMeshId={activeMeshId}
                    onSelectMesh={(meshId) => {
                      if (meshId === activeMeshId) return;
                      setActiveMeshId(meshId);
                      setSelectedMeshIds([meshId]);
                      setSelectedFaceIds([]);
                      setSelectedVertexIds([]);
                      setSelectedEdgeIds([]);
                      setSceneSelection({ kind: 'mesh', id: meshId });
                    }}
                    selectedFaceIds={selectedFaceIds}
                    setSelectedFaceIds={setSelectedFaceIds}
                    textureCanvas={textureCanvasRef.current}
                    onTextureUpdated={handleUvTextureLoaded}
                    onOpenUVModal={() => setIsUVModalOpen(true)}
                  />
                )}
              </section>
            </>
          )}
        </main>

        {/* Brush / 3D-paint outside the Paint workspace still needs the texture bridge
            (layers + UV-correct stamping). Keep it mounted but invisible. */}
        {toolState.isPainting3D && activeWorkspaceMode !== 'paint' && activeWorkspaceMode !== 'animation' && (
          <PaintBridgeHost
            toolState={toolState}
            setToolState={setToolState}
            textureCanvasRef={textureCanvasRef}
            paintBridgeRef={paintBridgeRef}
            onBindLiveCanvas={bindLiveTextureCanvas}
            onStrokeEnd={(canvas) => {
              const large = Math.max(canvas.width, canvas.height) >= 256;
              if (large) {
                flushLivePaintPreview();
                return;
              }
              handleTextureUpdated(canvas);
            }}
          />
        )}

        {!editorSplitOpen && activeWorkspaceMode !== 'animation' && activeWorkspaceMode !== 'blockout' && <aside className="w-80 bg-[#26282d] border-l border-[#101114] flex flex-col z-20 panel-surface">
          {activeWorkspaceMode === 'rigging' ? (
            <div className="flex-1 overflow-hidden bg-[#26282d]">
              <RiggingPanel
                bones={bones}
                setBones={setBones}
                meshes={meshes}
                setMeshes={setMeshes}
                activeMeshId={activeMeshId}
                selectedBoneId={selectedBoneId}
                setSelectedBoneId={setSelectedBoneId}
                toolState={toolState}
                setToolState={setToolState}
                onKeyPoseToClip={handleKeyPoseToClip}
                onOpenAnimation={() => selectWorkspace('animation')}
                easyRig
              />
            </div>
          ) : (
          <>
          <div className="h-9 bg-[#191b1e] border-b border-[#3b3f46] flex items-stretch px-1 text-xs">
            <button
              onClick={() => {
                setActiveRightTab('outliner');
              }}
              className={`flex-1 flex items-center justify-center gap-1 font-mono text-[9px] transition ${
                activeRightTab === 'outliner' ? 'cad-tab-active' : 'cad-tab-inactive'
              }`}
              title="Scene Outliner Hierarchy"
            >
              <Layers className="w-3 h-3" />
              <span>Tree</span>
            </button>

            <button
              onClick={() => {
                setActiveRightTab('properties');
              }}
              className={`flex-1 flex items-center justify-center gap-1 font-mono text-[9px] transition ${
                activeRightTab === 'properties' ? 'cad-tab-active' : 'cad-tab-inactive'
              }`}
              title="Properties & Numerics"
            >
              <Sliders className="w-3 h-3" />
              <span>Props</span>
            </button>

            <button
              onClick={() => {
                setActiveRightTab('material');
              }}
              className={`flex-1 flex items-center justify-center gap-1 font-mono text-[9px] transition ${
                activeRightTab === 'material' ? 'cad-tab-active' : 'cad-tab-inactive'
              }`}
              title="Material & Gradient Studio"
            >
              <Palette className="w-3 h-3 text-[#e68619]" />
              <span>Mat</span>
            </button>

            <button
              onClick={() => {
                setActiveRightTab('rig');
                setToolState((state) => ({
                  ...state,
                  editMode: 'bone',
                  isPainting3D: false,
                  rigMode: state.rigMode || 'edit',
                  showBones: true,
                }));
              }}
              className={`flex-1 flex items-center justify-center gap-1 font-mono text-[9px] transition ${
                activeRightTab === 'rig' ? 'cad-tab-active' : 'cad-tab-inactive'
              }`}
              title="Skeleton Rigging Studio"
            >
              <Bone className="w-3 h-3" />
              <span>Rig</span>
            </button>

            <button
              onClick={() => setActiveRightTab('render')}
              className={`flex-1 flex items-center justify-center gap-1 font-mono text-[9px] transition ${
                activeRightTab === 'render' ? 'cad-tab-active' : 'cad-tab-inactive'
              }`}
              title="Modern AAA Shaders & Export Studio"
            >
              <Sparkles className="w-3 h-3" />
              <span>FX</span>
            </button>
          </div>

          <div className="flex-1 overflow-hidden bg-[#26282d] p-1">
            {activeRightTab === 'outliner' && (
              <OutlinerPanel
                meshes={meshes}
                setMeshes={setMeshes}
                groups={groups}
                setGroups={setGroups}
                bones={bones}
                setBones={setBones}
                activeMeshId={activeMeshId}
                setActiveMeshId={setActiveMeshId}
                selectedMeshIds={selectedMeshIds}
                setSelectedMeshIds={setSelectedMeshIds}
                selectedBoneId={selectedBoneId}
                setSelectedBoneId={setSelectedBoneId}
                onSpawnPrimitive={handleSpawnPrimitive}
                onDeleteMesh={handleDeleteMesh}
                onDuplicateMesh={handleDuplicateSelected}
                onSeparateMesh={handleSeparateSelected}
                cameras={cameras}
                setCameras={setCameras}
                lights={lights}
                setLights={setLights}
                particles={particles}
                setParticles={setParticles}
                environment={environment}
                setEnvironment={setEnvironment}
                sceneSelection={sceneSelection}
                setSceneSelection={setSceneSelection}
                setActiveCameraId={setActiveCameraId}
                showSceneObjects={false}
              />
            )}

            {activeRightTab === 'properties' && (
              <PropertiesPanel
                mesh={activeMesh}
                setMesh={updateActiveMesh}
                toolState={toolState}
                setToolState={setToolState}
                selectedVertexIds={selectedVertexIds}
                selectedFaceIds={selectedFaceIds}
                sceneSelection={sceneSelection}
                cameras={cameras}
                lights={lights}
                particles={particles}
                environment={environment}
                setCameras={setCameras}
                setLights={setLights}
                setParticles={setParticles}
                setEnvironment={setEnvironment}
              />
            )}

            {activeRightTab === 'material' && (
              <MaterialPanel
                mesh={activeMesh}
                setMesh={updateActiveMesh}
                setMeshes={setMeshes}
                selectedMeshIds={selectedMeshIds}
                selectedFaceIds={selectedFaceIds}
                toolState={toolState}
                setToolState={setToolState}
                textureCanvas={textureCanvasRef.current}
                onOpenPaintWorkspace={() => selectWorkspace('paint')}
              />
            )}

            {activeRightTab === 'rig' && (
              <RiggingPanel
                bones={bones}
                setBones={setBones}
                meshes={meshes}
                setMeshes={setMeshes}
                activeMeshId={activeMeshId}
                selectedBoneId={selectedBoneId}
                setSelectedBoneId={setSelectedBoneId}
                toolState={toolState}
                setToolState={setToolState}
                onKeyPoseToClip={handleKeyPoseToClip}
                onOpenAnimation={() => selectWorkspace('animation')}
                easyRig={false}
              />
            )}

            {activeRightTab === 'render' && (
              <RenderExportPanel
                renderSettings={renderSettings}
                setRenderSettings={setRenderSettings}
                mesh={activeMesh}
                setMesh={updateActiveMesh}
                onOpenSpriteSheetModal={() => setIsSpriteSheetOpen(true)}
                onExportGLB={handleExportGLB}
                onOpenParticleStudio={() => setIsParticleStudioOpen(true)}
              />
            )}
          </div>
          </>
          )}
        </aside>}
      </div>

      <footer className="adobe-statusbar z-30 select-none justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-[#e4e7eb]">
            <span className="w-2 h-2 rounded-full bg-[#ed7300]" />
            <span>PolyStage</span>
          </div>
          <div>
            Scene: <strong className="text-[#ed7300]">{activeScene.name}</strong>
          </div>
          <div>
            Rig Bones: <strong className="text-[#ed7300]">{bones.length}</strong>
          </div>
          <div>
            Objects in Scene: <strong className="text-[#ff9a3c]">{meshes.length}</strong>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[#7e838c]">
          {activeWorkspaceMode === 'rigging' ? (
            <>
              <span className="text-[#ed7300] font-bold">Easy Rig</span>
              <span>Preset → Rest → Bind → Paint → Test → ANIM</span>
              <span>[Edit / Pose / Skin]</span>
              <span>Shift=Sub · Alt=Smooth weights</span>
            </>
          ) : activeWorkspaceMode === 'blockout' ? (
            <>
              <span className="text-[#5b9bd5] font-bold">Blockout</span>
              <span>{blockoutStatus}</span>
              <span>RMB/MMB pan · Wheel zoom · Space+LMB pan</span>
              <span>[Ctrl+Z] Undo path</span>
              <span>[Ctrl+drag] Box-select points</span>
              <span>[Del] Delete points</span>
            </>
          ) : (
            <>
              <button onClick={() => setIsUVModalOpen(true)} className="inline-flex items-center gap-1 text-[#ff9a3c] font-bold hover:underline">
                <kbd>U</kbd> UV Studio
              </button>
              <button
                onClick={() => {
                  setToolWindowTab('primitives');
                  setIsToolWindowOpen(true);
                }}
                className="text-amber-400 font-bold hover:underline"
              >
                Primitives
              </button>
              <span className="kbd-hint"><kbd>Esc</kbd> Cancel</span>
              <span className="kbd-hint"><kbd>Ctrl+Z</kbd> Undo</span>
              <span className="kbd-hint"><kbd>Ctrl+Y</kbd> Redo</span>
              <span className="kbd-hint"><kbd>Ctrl+C/V</kbd> Copy/Paste</span>
              <span className="kbd-hint"><kbd>G</kbd> Move</span>
              <span className="kbd-hint"><kbd>R</kbd> Rotate</span>
              <span className="kbd-hint"><kbd>S</kbd> Scale</span>
              <span className="kbd-hint"><kbd>E</kbd> Extrude</span>
              <span className="kbd-hint"><kbd>I</kbd> Inset</span>
              <span className="kbd-hint"><kbd>Shift+D</kbd> Dup</span>
              <span className="kbd-hint"><kbd>P</kbd> Separate</span>
              <span className="kbd-hint"><kbd>Alt+X</kbd> Mirror</span>
            </>
          )}
        </div>
      </footer>

      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <AssetBrowserModal
        isOpen={isAssetBrowserOpen}
        onClose={() => setIsAssetBrowserOpen(false)}
        onSelectAsset={handleSpawnPrimitive}
        onSpawnMesh={handleSpawnDrawnPrimitive}
      />
      <ImportModelModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportMeshes={handleImportMeshes}
      />
      <SpriteSheetModal isOpen={isSpriteSheetOpen} onClose={() => setIsSpriteSheetOpen(false)} mesh={activeMesh} />
      <ParticleStudioModal
        isOpen={isParticleStudioOpen}
        onClose={() => setIsParticleStudioOpen(false)}
        onSave={(emitter) => setParticles((prev) => [...prev, emitter])}
      />
      <UVEditorModal
        isOpen={isUVModalOpen}
        onClose={() => setIsUVModalOpen(false)}
        mesh={activeMesh}
        setMesh={updateActiveMesh}
        meshes={meshes}
        activeMeshId={activeMeshId}
        onSelectMesh={(meshId) => {
          if (meshId === activeMeshId) return;
          setActiveMeshId(meshId);
          setSelectedMeshIds([meshId]);
          setSelectedFaceIds([]);
          setSelectedVertexIds([]);
          setSelectedEdgeIds([]);
          setSceneSelection({ kind: 'mesh', id: meshId });
        }}
        selectedFaceIds={selectedFaceIds}
        setSelectedFaceIds={setSelectedFaceIds}
        textureCanvas={textureCanvasRef.current}
      />
      <FloatingOutliner
        isOpen={isFloatingOutlinerOpen}
        onClose={() => setIsFloatingOutlinerOpen(false)}
        meshes={meshes}
        setMeshes={setMeshes}
        groups={groups}
        setGroups={setGroups}
        bones={bones}
        setBones={setBones}
        activeMeshId={activeMeshId}
        setActiveMeshId={setActiveMeshId}
        selectedMeshIds={selectedMeshIds}
        setSelectedMeshIds={setSelectedMeshIds}
        selectedBoneId={selectedBoneId}
        setSelectedBoneId={setSelectedBoneId}
        onSpawnPrimitive={handleSpawnPrimitive}
        onDeleteMesh={handleDeleteMesh}
        onDuplicateMesh={handleDuplicateSelected}
        onSeparateMesh={handleSeparateSelected}
        cameras={cameras}
        setCameras={setCameras}
        lights={lights}
        setLights={setLights}
        particles={particles}
        setParticles={setParticles}
        environment={environment}
        setEnvironment={setEnvironment}
        sceneSelection={sceneSelection}
        setSceneSelection={setSceneSelection}
        setActiveCameraId={setActiveCameraId}
        onActivateObject={(meshId) => {
          setSelectedVertexIds([]);
          setSelectedEdgeIds([]);
          setSelectedFaceIds([]);
          setSelectedMeshIds([meshId]);
          setActiveMeshId(meshId);
          setSceneSelection({ kind: 'mesh', id: meshId });
        }}
      />
      <FloatingToolWindow
        isOpen={isToolWindowOpen && activeWorkspaceMode === 'modeling'}
        onClose={() => setIsToolWindowOpen(false)}
        activeTab={toolWindowTab}
        onTabChange={setToolWindowTab}
        mesh={activeMesh}
        setMesh={editActiveMesh}
        selectedVertexIds={selectedVertexIds}
        setSelectedVertexIds={setSelectedVertexIds}
        selectedEdgeIds={selectedEdgeIds}
        setSelectedEdgeIds={setSelectedEdgeIds}
        selectedFaceIds={selectedFaceIds}
        setSelectedFaceIds={setSelectedFaceIds}
        toolState={toolState}
        setToolState={setToolState}
        onExtrudeFace={handleExtrudeFace}
        onInsetFace={handleInsetFace}
        onBevelEdges={handleBevelEdges}
        onLoopCut={handleLoopCut}
        onKnife={handleKnife}
        onDeleteSelected={handleDeleteSelected}
        onDuplicateSelected={handleDuplicateSelected}
        onSeparateSelected={handleSeparateSelected}
        onMergeVertices={handleMergeVertices}
        onMirrorSymmetry={handleMirrorSymmetry}
        onAddMirrorModifier={handleAddMirrorModifier}
        onAddSubdivision={handleAddSubdivision}
        onApplySubdivide={handleApplySubdivideDestructive}
        onApplyModifiers={handleApplyModifiers}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onMagnetSnap={handleMagnetSnap}
      />
    </div>
  );
};

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { Viewport3D } from './components/Viewport3D';
import { QuadViewport } from './components/QuadViewport';
import { UVEditor } from './components/UVEditor';
import { UVEditorModal } from './components/UVEditorModal';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RenderExportPanel } from './components/RenderExportPanel';
import { OutlinerPanel } from './components/OutlinerPanel';
import { CutsceneStudio } from './components/CutsceneStudio';
import { ParticleStudioModal } from './components/ParticleStudioModal';
import { RiggingPanel } from './components/RiggingPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { FloatingToolWindow, type ToolWindowTab } from './components/FloatingToolWindow';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AssetBrowserModal } from './components/AssetBrowserModal';
import { ImportModelModal } from './components/ImportModelModal';
import { SpriteSheetModal } from './components/SpriteSheetModal';
import { PixelPaintStudio, type Paint3DBridge, type PaintTool as StudioPaintTool } from './components/PixelPaintStudio';
import { floodFill, hexToRgba } from './utils/pixelPaint';
import type {
  CADMesh, SceneGroup, CADBone, ToolState, RenderSettings, PrimitiveType, CADScene, AnimationClip,
  CADCamera, CADLight, ParticleEmitter, EnvironmentSettings, SceneSelection,
  WorkspaceMode, HeaderWorkspace, RigMode,
} from './types/cad';
import { generateId, generatePrimitive, extrudeFaces, insetFaces } from './utils/meshUtils';
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
import { subdivideFaces, fillSelectedVerticesFace, bevelSelectedEdges } from './utils/advancedMeshTools';
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
    activeColor: '#02a0e8',
    brushSize: 1,
    drawTool: 'pencil',
    paintOpacity: 1,
    paintSpacing: 0.25,
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
  });

  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    pixelScale: 1,
    dither: false,
    bloom: true,
    ssao: true,
    ambientIntensity: 0.8,
    lightIntensity: 1.2,
    wireframeColor: '#02a0e8',
    bgColor: '#161616',
    turntableSpeed: 1,
    isTurntablePlaying: false,
    weather: 'clear',
    fogDensity: 0,
    fogColor: '#a8b4c4',
    sunElevation: 55,
    sunAzimuth: 35,
  });

  const [activeRightTab, setActiveRightTab] = useState<'outliner' | 'properties' | 'material' | 'rig' | 'render'>('outliner');

  const [isToolWindowOpen, setIsToolWindowOpen] = useState(true);
  const [toolWindowTab, setToolWindowTab] = useState<ToolWindowTab>('tools');
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
  const lastPaintUvRef = useRef<{ u: number; v: number } | null>(null);
  const paintBridgeRef = useRef<Paint3DBridge | null>(null);
  const livePaintRafRef = useRef(0);

  const flushLivePaintPreview = () => {
    if (livePaintRafRef.current) return;
    livePaintRafRef.current = requestAnimationFrame(() => {
      livePaintRafRef.current = 0;
      // Refresh 3D viewport from the live composite canvas without serializing a dataURL every stamp.
      setTextureRevision((revision) => revision + 1);
      setToolState((state) => (state.viewMode === 'textured' ? state : { ...state, viewMode: 'textured' }));
    });
  };

  useEffect(() => {
    if (!toolState.isPainting3D || textureCanvasRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    textureCanvasRef.current = canvas;
    handleTextureUpdated(canvas);
  }, [toolState.isPainting3D]);

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

  const applyModalMeshAmount = (amount: number) => {
    const snap = modalMeshSnapshotRef.current;
    if (!snap) return;
    if (snap.type === 'loopCut' || snap.type === 'knife') return;
    let next: CADMesh = snap.baseMesh;
    if (snap.type === 'extrude') {
      next = extrudeFaces(snap.baseMesh, snap.faceIds, amount);
    } else if (snap.type === 'inset') {
      next = insetFaces(snap.baseMesh, snap.faceIds, Math.max(0, Math.min(0.95, amount)));
    } else if (snap.type === 'bevel') {
      if (snap.edgeIds.length > 0) {
        next = bevelSelectedEdges(snap.baseMesh, snap.edgeIds, Math.max(0.002, Math.min(0.45, amount)));
      } else if (snap.faceIds.length > 0) {
        next = insetFaces(snap.baseMesh, snap.faceIds, Math.max(0, Math.min(0.95, amount)));
      }
    }
    setMeshes((prev) => prev.map((m) => (m.id === snap.baseMesh.id ? next : m)));
  };

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
    if (type === 'extrude' || type === 'inset' || type === 'bevel') {
      // Seed at zero for extrude so the first mouse move feels continuous.
      applyModalMeshAmount(type === 'extrude' ? 0 : type === 'bevel' ? 0.06 : 0.08);
    }
  };

  const applyModalMeshAmountRef = useRef(applyModalMeshAmount);
  applyModalMeshAmountRef.current = applyModalMeshAmount;
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
      } else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        handleToggleSelectAll();
      } else if (e.key === '1') {
        setToolState((s) => ({ ...s, editMode: 'object', isPainting3D: false, modalTransform: null, modalMeshOp: null }));
        setSelectedVertexIds([]);
        setSelectedEdgeIds([]);
        setSelectedFaceIds([]);
      } else if (e.key === '2') {
        setToolState((s) => ({ ...s, editMode: 'vertex', isPainting3D: false, modalTransform: null, modalMeshOp: null }));
        setSelectedEdgeIds([]);
        setSelectedFaceIds([]);
      } else if (e.key === '3') {
        setToolState((s) => ({ ...s, editMode: 'edge', isPainting3D: false, modalTransform: null, modalMeshOp: null }));
        setSelectedVertexIds([]);
        setSelectedFaceIds([]);
      } else if (e.key === '4') {
        setToolState((s) => ({ ...s, editMode: 'face', isPainting3D: false, modalTransform: null, modalMeshOp: null }));
        setSelectedVertexIds([]);
        setSelectedEdgeIds([]);
      } else if (e.key === '5') {
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
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleAddSubdivision();
      } else if (!inPaintWorkspace && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        startModalMeshOp('loopCut');
      } else if (!inPaintWorkspace && e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        startModalMeshOp('knife');
      } else if (e.key.toLowerCase() === 'f') {
        if (activeMesh && selectedVertexIds.length >= 3) editActiveMesh(fillSelectedVerticesFace(activeMesh, selectedVertexIds));
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) handleMergeVertices();
      else if (e.shiftKey && e.key.toLowerCase() === 's') handleMagnetSnap();
      else if (e.altKey && e.key.toLowerCase() === 'x') handleMirrorSymmetry();
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

  const handleKeyPoseToClip = () => {
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
      return clipsNext.map((clip) => {
        if (clip.id !== targetId) return clip;
        let next = clip;
        bones.forEach((bone) => {
          next = autoKeyTarget(next, bone.id, 'bone', bone.name, {
            position: bone.position,
            rotation: bone.rotation,
            scale: bone.scale,
          }, 0);
        });
        meshes.forEach((mesh) => {
          next = autoKeyTarget(next, mesh.id, 'mesh', mesh.name, {
            position: mesh.position,
            rotation: mesh.rotation,
            scale: mesh.scale,
          }, 0);
        });
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

  const handleTextureUpdated = (canvas: HTMLCanvasElement) => {
    const dataUrl = canvas.toDataURL();
    textureCanvasRef.current = canvas;
    loadedTextureRef.current = { meshId: activeMesh.id, dataUrl };
    setTextureRevision((revision) => revision + 1);
    setToolState((state) => ({ ...state, viewMode: 'textured' }));
    updateActiveMesh((prev) => ({ ...prev, textureCanvasDataUrl: dataUrl }));
  };

  useEffect(() => {
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
  }, [activeMesh.id, activeMesh.textureCanvasDataUrl]);

  const handleDirect3DPaintPixel = (uvU: number, uvV: number, isFinal = false) => {
    const bridge = paintBridgeRef.current;
    if (bridge) {
      const studioTool: StudioPaintTool =
        toolState.drawTool === 'rectangle' ? 'rect' :
        toolState.drawTool === 'select' ? 'pencil' :
        toolState.drawTool as StudioPaintTool;
      if (isFinal) {
        bridge.endStroke();
        return;
      }
      bridge.paintUv(
        uvU,
        uvV,
        toolState.activeColor || '#02a0e8',
        toolState.brushSize || 1,
        studioTool,
        toolState.paintOpacity ?? 1,
        toolState.paintSpacing ?? .25,
        toolState.paintMirrorU ?? false,
      );
      flushLivePaintPreview();
      return;
    }
    const canvas = textureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (isFinal) {
      lastPaintUvRef.current = null;
      handleTextureUpdated(canvas);
      return;
    }

    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(uvU * canvas.width)));
    // With texture.flipY=false, raycast UV.v maps directly to canvas Y (0 = top).
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(uvV * canvas.height)));
    const color = toolState.activeColor || '#02a0e8';
    const bSize = toolState.brushSize || 1;
    const tool = toolState.drawTool || 'pencil';

    if (tool === 'picker') {
      const pData = ctx.getImageData(x, y, 1, 1).data;
      const hex = `#${((1 << 24) + (pData[0] << 16) + (pData[1] << 8) + pData[2]).toString(16).slice(1)}`;
      if (toolState.activeColor !== hex) {
        setToolState((s) => ({ ...s, activeColor: hex }));
      }
      lastPaintUvRef.current = null;
      return;
    }

    const stamp = (px: number, py: number) => {
      const half = Math.floor(bSize / 2);
      const stampAt = (cx: number) => {
        ctx.save();
        ctx.globalAlpha = toolState.paintOpacity ?? 1;
        if (tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = tool === 'eraser' ? '#000000' : color;
        if (tool === 'spray') {
          const radius = Math.max(2, bSize * 1.8);
          for (let i = 0; i < Math.max(8, bSize * 5); i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.sqrt(Math.random()) * radius;
            ctx.fillRect(Math.round(cx + Math.cos(angle) * distance), Math.round(py + Math.sin(angle) * distance), 1, 1);
          }
        } else {
          for (let by = 0; by < bSize; by++) for (let bx = 0; bx < bSize; bx++) {
            const sx = cx - half + bx, sy = py - half + by;
            if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
            if (tool !== 'dither' || (sx + sy) % 2 === 0) ctx.fillRect(sx, sy, 1, 1);
          }
        }
        ctx.restore();
      };
      stampAt(px);
      if (toolState.paintMirrorU) stampAt(canvas.width - 1 - px);
    };

    if (tool === 'fill') {
      floodFillCanvas(ctx, x, y, color);
      // Commit immediately so fill isn't lost if the stroke ends without further moves.
      handleTextureUpdated(canvas);
      lastPaintUvRef.current = { u: uvU, v: uvV };
      return;
    } else {
      const previous = lastPaintUvRef.current;
      const px0 = previous ? previous.u * canvas.width : x;
      const py0 = previous ? previous.v * canvas.height : y;
      const distance = Math.hypot(x - px0, y - py0);
      const seamJump = previous && (Math.abs(uvU - previous.u) > 0.35 || Math.abs(uvV - previous.v) > 0.35);
      const spacing = Math.max(0.35, bSize * (toolState.paintSpacing ?? 0.25));
      const steps = seamJump ? 1 : Math.max(1, Math.ceil(distance / spacing));
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 1;
        stamp(Math.round(px0 + (x - px0) * t), Math.round(py0 + (y - py0) * t));
      }
    }
    lastPaintUvRef.current = { u: uvU, v: uvV };
    flushLivePaintPreview();
  };

  const floodFillCanvas = (ctx: CanvasRenderingContext2D, startX: number, startY: number, fillColorHex: string) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    floodFill(imgData, startX, startY, hexToRgba(fillColorHex));
    ctx.putImageData(imgData, 0, 0);
  };

  const handleLoadJSON = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.mesh) {
        updateMeshesWithHistory([parsed.mesh]);
      }
    } catch (err) {
      console.error('Failed to parse project JSON:', err);
    }
  };

  const editorSplitOpen = uvSplitOpen || activeWorkspaceMode === 'paint';
  const editorPanelLabel = activeWorkspaceMode === 'paint' ? 'Pixel Editor' : 'UV Editor';
  const selectWorkspace = (workspace: HeaderWorkspace) => {
    if (workspace === 'modeling') {
      setActiveWorkspaceMode('modeling');
      setUvSplitOpen(false);
      setToolState((state) => ({
        ...state,
        isPainting3D: false,
        editMode: 'object',
        viewMode: 'lit',
        viewportLayout: 'single',
        isCadDrawing: false,
        placeOnClick: false,
      }));
      return;
    }
    if (workspace === 'paint') {
      setActiveWorkspaceMode('paint');
      setUvSplitOpen(false);
      setIsToolWindowOpen(false);
      setToolState((state) => ({
        ...state,
        isPainting3D: true,
        editMode: 'object',
        viewMode: 'textured',
        viewportLayout: 'single',
        drawTool: 'pencil',
        isCadDrawing: false,
        placeOnClick: false,
      }));
      return;
    }
    if (workspace === 'brush') {
      setActiveWorkspaceMode('modeling');
      setUvSplitOpen(false);
      setIsToolWindowOpen(false);
      setToolState((state) => ({
        ...state,
        isPainting3D: true,
        editMode: 'object',
        viewMode: 'textured',
        viewportLayout: 'single',
        drawTool: 'pencil',
        isCadDrawing: false,
        placeOnClick: false,
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
      }));
      return;
    }

    setActiveWorkspaceMode('modeling');
    setUvSplitOpen(true);
    setIsToolWindowOpen(false);
    setToolState((state) => ({
      ...state,
      isPainting3D: false,
      editMode: 'face',
      viewportLayout: 'single',
      isCadDrawing: false,
      placeOnClick: false,
    }));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#161616] text-[#e0e0e0] overflow-hidden font-sans select-none">
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
      />

      <div className="flex-1 flex overflow-hidden relative">
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

        <main ref={splitWorkspaceRef} className="flex-1 h-full relative overflow-hidden bg-[#161616] flex">
          <section
            className="h-full relative overflow-hidden"
            style={{ width: editorSplitOpen ? `calc(${100 - uvPanelPercent}% - 8px)` : '100%' }}
          >
          {activeWorkspaceMode === 'animation' ? (
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
          ) : toolState.viewportLayout === 'single' ? (
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
              activeRightTab={activeRightTab}
              onDirect3DPaintPixel={handleDirect3DPaintPixel}
              onSpawnDrawnPrimitive={handleSpawnDrawnPrimitive}
              onOpenUVModal={() => setIsUVModalOpen(true)}
              onModalMeshPreview={(amount) => applyModalMeshAmountRef.current(amount)}
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
              onOpenUVModal={() => setIsUVModalOpen(true)}
              onModalMeshPreview={(amount) => applyModalMeshAmountRef.current(amount)}
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
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#666666] group-hover:w-0.5 group-hover:bg-white/80" />
                <div className="adobe-divider-handle absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-3 flex flex-col items-center justify-center gap-1">
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-400" />
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-400" />
                  <span className="w-0.5 h-0.5 rounded-full bg-slate-400" />
                </div>
              </div>
              <section
                className="min-w-0 h-full bg-[#161616]"
                style={{ width: `${uvPanelPercent}%` }}
              >
                {activeWorkspaceMode === 'paint' ? (
                  <PixelPaintStudio
                    key={activeMesh.id}
                    toolState={toolState}
                    setToolState={setToolState}
                    onTextureUpdated={handleTextureUpdated}
                    textureCanvasRef={textureCanvasRef}
                    initialDataUrl={activeMesh.textureCanvasDataUrl}
                    paintBridgeRef={paintBridgeRef}
                    mesh={activeMesh}
                    selectedFaceIds={selectedFaceIds}
                    onTextureAnimationChange={(anim) => {
                      updateActiveMesh((prev) => ({
                        ...prev,
                        textureAnimation: anim,
                        textureCanvasDataUrl:
                          anim.frames[0]?.dataUrl || prev.textureCanvasDataUrl,
                      }));
                    }}
                  />
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
                    onTextureUpdated={handleTextureUpdated}
                    onOpenUVModal={() => setIsUVModalOpen(true)}
                  />
                )}
              </section>
            </>
          )}
        </main>

        {!editorSplitOpen && activeWorkspaceMode !== 'animation' && <aside className="w-80 bg-[#1c1c1c] border-l border-[#323232] flex flex-col z-20">
          {activeWorkspaceMode === 'rigging' ? (
            <div className="flex-1 overflow-hidden bg-[#1c1c1c]">
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
          <div className="h-9 bg-[#141414] border-b border-[#323232] flex items-stretch px-1 text-xs">
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
                setToolState((state) => ({ ...state, editMode: 'bone', isPainting3D: false, rigMode: state.rigMode || 'edit' }));
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

          <div className="flex-1 overflow-hidden bg-[#1c1c1c] p-1">
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

      <footer className="h-6 bg-[#141414] border-t border-[#323232] px-3 flex items-center justify-between text-[10px] font-mono text-[#888888] z-30 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-slate-200">
            <span className="w-2 h-2 rounded-full bg-[#02a0e8] animate-pulse shadow-sm shadow-[#02a0e8]" />
            <span>PolyStage Workstation</span>
          </div>
          <div>
            Scene: <strong className="text-amber-400">{activeScene.name}</strong>
          </div>
          <div>
            Rig Bones: <strong className="text-[#2680eb]">{bones.length}</strong>
          </div>
          <div>
            Objects in Scene: <strong className="text-[#02a0e8]">{meshes.length}</strong>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[#888888]">
          {activeWorkspaceMode === 'rigging' ? (
            <>
              <span className="text-[#2680eb] font-bold">Easy Rig</span>
              <span>Preset → Rest → Bind → Paint → Test → ANIM</span>
              <span>[Edit / Pose / Skin]</span>
              <span>Shift=Sub · Alt=Smooth weights</span>
            </>
          ) : (
            <>
              <button onClick={() => setIsUVModalOpen(true)} className="text-[#02a0e8] font-bold hover:underline">
                [U] UV Studio
              </button>
              <button
                onClick={() => {
                  setToolWindowTab('primitives');
                  setIsToolWindowOpen(true);
                }}
                className="text-amber-400 font-bold hover:underline"
              >
                [P] Primitives
              </button>
              <span>[Esc] Cancel Draw</span>
              <span>[Ctrl+Z] Undo</span>
              <span>[Ctrl+Y] Redo</span>
              <span>[Ctrl+C/V] Copy/Paste</span>
              <span>[G] Move</span>
              <span>[R] Rotate</span>
              <span>[S] Scale</span>
              <span>[E] Extrude</span>
              <span>[I] Inset</span>
              <span>[Shift+D] Dup</span>
              <span>[Alt+X] Mirror</span>
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
        onImportMesh={handleSpawnDrawnPrimitive}
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

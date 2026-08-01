import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { applyStandardOrbitMouseButtons, bindBlockbenchOrbitModifiers, panCameraInScreenSpace } from '../utils/viewportNav';
import { applyThemedTransformGizmo, VIEWPORT_THEME } from '../utils/viewportTheme';
import {
  Play, Pause, RotateCcw, Film, Camera, CloudRain, Sparkles, Plus, Video, Eye, Download,
  Key, Move, RotateCw, Maximize2, Minimize2, Trash2, ChevronRight, ChevronDown, ChevronUp, Minus, Layers, Bone,
  PanelLeftClose, PanelLeft, ChevronsDownUp, Settings2, Box, EyeOff, SlidersHorizontal,
  ZoomIn, ZoomOut, SkipBack, SkipForward, StepBack, StepForward, Sun, Lightbulb, Music,
  Crosshair, Aperture,
} from 'lucide-react';
import type {
  AnimationClip, CADBone, CADCamera, CADLight, CADLightType, CADMesh, EnvironmentSettings,
  ParticleEmitter, WeatherPreset, Vector3D,
} from '../types/cad';
import type { CutsceneSequence } from '../types/sequence';
import { buildThreeGeometry } from '../utils/meshUtils';
import { bindSkinToSkeleton, deformMeshWithBones, resetPoseToRest, unbindSkin } from '../utils/rigging';
import { applySkeletonPreset, SKELETON_PRESETS, type SkeletonPresetId } from '../utils/skeletonPresets';
import {
  detectProcSpecies, evaluateProceduralBoneAnim, PROC_ANIMATIONS, type ProcAnimId,
} from '../utils/proceduralBoneAnim';
import { evaluateClipAtTime, createEmptyClip, createDefaultClip, autoKeyTarget, ensureTrackForTarget, insertKeyframe, rebaseClipTracksToScene, ensureClipTracksForScene, insertTexFrameKeyframe, insertTextureClipKey } from '../utils/animation';
import {
  createCamera, createDefaultEnvironment, createParticleFromPreset, PARTICLE_PRESETS,
  sunDirectionFromAngles, weatherPresetToEnv, type ParticlePresetId,
} from '../utils/cutsceneEnv';
import {
  createCADLight,
  createCadLightHelper,
  createDramaticThreePointLights,
  createThreeLightFromCad,
  syncThreeLightFromCad,
  applyLiveLightProps,
  CAD_LIGHT_TYPE_LABELS,
  ensureAreaLightSupport,
} from '../utils/cutsceneLights';
import {
  activeAnimClipAtTime, addAudioAsset, addClipToTrack, addSequenceTrack, audioClipsAtTime,
  cameraShotAtTime, createEmptySequence, createSequenceClip, ensureMovieSequenceTracks,
  lightIdsAtTime, overlayClipsAtTime, particleIdsAtTime, SEQ_CLIP_COLORS, sequenceEndTime,
  setSequenceDuration, weatherCueAtTime,
} from '../utils/sequence';
import { ParticleSystem } from '../utils/particles';
import { ParticleStudioModal } from './ParticleStudioModal';
import { AnimEditPopup, type AnimEditKind, type AnimEditTarget, type AnimGizmoMode } from './AnimEditPopup';
import { AnimGraphEditor } from './AnimGraphEditor';
import { SequenceTimeline } from './SequenceTimeline';
import { EnvironmentSettingsModal } from './EnvironmentSettingsModal';
import { LightwaveNavToolbar } from './LightwaveNavToolbar';
import { LengthField } from './LengthField';
import { SmoothSlider } from './SmoothSlider';

interface CutsceneStudioProps {
  sceneName: string;
  scenes?: { id: string; name: string; meshCount: number }[];
  activeSceneId?: string;
  setActiveSceneId?: (id: string) => void;
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  bones: CADBone[];
  setBones: React.Dispatch<React.SetStateAction<CADBone[]>>;
  clips: AnimationClip[];
  setClips: React.Dispatch<React.SetStateAction<AnimationClip[]>>;
  activeClipId: string | null;
  setActiveClipId: (id: string | null) => void;
  cameras: CADCamera[];
  setCameras: React.Dispatch<React.SetStateAction<CADCamera[]>>;
  activeCameraId: string | null;
  setActiveCameraId: (id: string | null) => void;
  lights: CADLight[];
  setLights: React.Dispatch<React.SetStateAction<CADLight[]>>;
  particles: ParticleEmitter[];
  setParticles: React.Dispatch<React.SetStateAction<ParticleEmitter[]>>;
  environment: EnvironmentSettings;
  setEnvironment: React.Dispatch<React.SetStateAction<EnvironmentSettings>>;
  sequence: CutsceneSequence | null;
  setSequence: React.Dispatch<React.SetStateAction<CutsceneSequence | null>>;
  /** Live paint canvas for the active mesh (same source as modeling viewport). */
  textureCanvas?: HTMLCanvasElement | null;
  textureRevision?: number;
  activeMeshId?: string;
}

type LeftTab = 'outliner' | 'clips' | 'cameras' | 'bones' | 'meshes' | 'particles' | 'weather' | 'lights';
type TimelineTab = 'dope' | 'graph' | 'seq';

function makeNearestTexture(source: HTMLCanvasElement | HTMLImageElement): THREE.Texture {
  const texture = source instanceof HTMLCanvasElement
    ? new THREE.CanvasTexture(source)
    : new THREE.Texture(source);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Match modeling viewport / UV editor (canvas top upright, no GPU V flip).
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export const CutsceneStudio: React.FC<CutsceneStudioProps> = ({
  sceneName,
  scenes = [],
  activeSceneId,
  setActiveSceneId,
  meshes,
  setMeshes,
  bones,
  setBones,
  clips,
  setClips,
  activeClipId,
  setActiveClipId,
  cameras,
  setCameras,
  activeCameraId,
  setActiveCameraId,
  lights,
  setLights,
  particles,
  setParticles,
  environment,
  setEnvironment,
  sequence,
  setSequence,
  textureCanvas = null,
  textureRevision = 0,
  activeMeshId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const freeCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cineCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const gizmoProxyRef = useRef<THREE.Object3D | null>(null);
  const gizmoDraggingRef = useRef(false);
  /** While a panel slider is dragging, pose-sync must not overwrite the live Three value. */
  const sliderDragRef = useRef<{ kind: 'light' | 'camera' | 'env'; id: string } | null>(null);
  const modalTransformRef = useRef<'translate' | 'rotate' | 'scale' | null>(null);
  const meshesGroupRef = useRef<THREE.Group | null>(null);
  const camerasGroupRef = useRef<THREE.Group | null>(null);
  const bonesGroupRef = useRef<THREE.Group | null>(null);
  const particleMarkersRef = useRef<THREE.Group | null>(null);
  const ambientRef = useRef<THREE.HemisphereLight | null>(null);
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const shadowCatcherRef = useRef<THREE.Mesh | null>(null);
  const particleSystemsRef = useRef<Map<string, ParticleSystem>>(new Map());
  const weatherPointsRef = useRef<THREE.Points | null>(null);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const structureDirtyRef = useRef(true);
  const lastPoseSyncTimeRef = useRef(-1);
  const uiTimeAccumRef = useRef(0);
  const pxPerSecRef = useRef(100);
  const playheadElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const timeLabelElsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const setCurrentTimeRef = useRef<(t: number) => void>(() => {});
  const setIsPlayingRef = useRef<(v: boolean) => void>(() => {});
  const commitGizmoTransformRef = useRef<() => void>(() => {});
  const syncSequenceAudioRef = useRef<(time: number, playing: boolean) => void>(() => {});
  const syncViewportPoseRef = useRef<(time: number) => void>(() => {});
  const viewportMeshesRef = useRef<Map<string, {
    mesh: THREE.Mesh;
    edges: THREE.LineSegments | null;
    mat: THREE.MeshStandardMaterial;
    geoKey: string;
  }>>(new Map());
  const viewportBonesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const viewportCamsRef = useRef<Map<string, THREE.Group>>(new Map());
  const viewportLightsRef = useRef<Map<string, {
    light: THREE.Light;
    helper: THREE.Object3D;
  }>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const recordingChunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const environmentRef = useRef(environment);
  environmentRef.current = environment;
  const cameraViewRef = useRef(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  isPlayingRef.current = isPlaying;
  setCurrentTimeRef.current = setCurrentTime;
  setIsPlayingRef.current = setIsPlaying;
  const [cameraView, setCameraView] = useState(false);
  cameraViewRef.current = cameraView;
  const [isRecording, setIsRecording] = useState(false);
  const [particleModalOpen, setParticleModalOpen] = useState(false);
  const [editingParticle, setEditingParticle] = useState<ParticleEmitter | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [expandedTracks, setExpandedTracks] = useState<Record<string, boolean>>({});
  const [leftTab, setLeftTab] = useState<LeftTab>('outliner');
  const [timelineTab, setTimelineTab] = useState<TimelineTab>('dope');
  const [selectedSeqClipId, setSelectedSeqClipId] = useState<string | null>(null);
  const [recordFps, setRecordFps] = useState(30);
  const seqBlackRef = useRef<HTMLDivElement>(null);
  const seqTitlesRef = useRef<HTMLDivElement>(null);
  const [showBones, setShowBones] = useState(true);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [modalTransform, setModalTransform] = useState<'translate' | 'rotate' | 'scale' | null>(null);
  modalTransformRef.current = modalTransform;
  const modalSnapshotRef = useRef<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  } | null>(null);
  const [leftWidth, setLeftWidth] = useState(280);
  const [timelineHeight, setTimelineHeight] = useState(280);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [showLightwaveTools, setShowLightwaveTools] = useState(true);
  const [focusPlayback, setFocusPlayback] = useState(false);
  const focusRestoreRef = useRef<{
    leftCollapsed: boolean;
    timelineCollapsed: boolean;
    timelineHeight: number;
    editPopupOpen: boolean;
  } | null>(null);
  const [autoKey, setAutoKey] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [fxMenuOpen, setFxMenuOpen] = useState(false);
  const [outlinerQuery, setOutlinerQuery] = useState('');
  const [collapsedBones, setCollapsedBones] = useState<Record<string, boolean>>({});
  const [pxPerSec, setPxPerSec] = useState(100);
  const [snapToFrames, setSnapToFrames] = useState(true);
  const [timelineFocus, setTimelineFocus] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const trackLabelScrollRef = useRef<HTMLDivElement>(null);
  const [selectedBoneId, setSelectedBoneId] = useState<string>(bones[0]?.id || '');
  const [selectedMeshId, setSelectedMeshId] = useState<string>(meshes[0]?.id || '');
  const [selectedParticleId, setSelectedParticleId] = useState<string>('');
  const [editPopupOpen, setEditPopupOpen] = useState(true);
  const [gizmoMode, setGizmoMode] = useState<AnimGizmoMode>('translate');
  const [editKind, setEditKind] = useState<AnimEditKind>('camera');
  const [editId, setEditId] = useState<string>('');
  const [procAnimId, setProcAnimId] = useState<ProcAnimId | null>(null);
  const [procSpeed, setProcSpeed] = useState(1);
  const [meshTextureTick, setMeshTextureTick] = useState(0);
  /** Cinematic lit look — CAD lights drive the scene; background editable. */
  const [litPreview, setLitPreview] = useState(false);
  const [showLightHelpers, setShowLightHelpers] = useState(true);
  const litPreviewRef = useRef(false);
  litPreviewRef.current = litPreview;
  const showLightHelpersRef = useRef(true);
  showLightHelpersRef.current = showLightHelpers;
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLElement | null>(null);
  const layoutResizingRef = useRef(false);
  const syncRendererSizeRef = useRef<() => void>(() => {});
  const meshTextureCacheRef = useRef<Map<string, { dataUrl: string; texture: THREE.Texture }>>(new Map());
  const liveTextureRef = useRef<THREE.CanvasTexture | null>(null);

  const activeClip = clips.find((c) => c.id === activeClipId) || clips[0] || null;
  const activeCamera = cameras.find((c) => c.id === activeCameraId) || cameras[0] || null;
  const procSpecies = detectProcSpecies(bones);
  const procOptions = PROC_ANIMATIONS.filter((a) => procSpecies === 'other' || a.species === procSpecies);
  const skinTarget = meshes.find((m) => m.id === selectedMeshId) || meshes[0] || null;
  const isBound = Boolean(skinTarget?.skinWeights && Object.keys(skinTarget.skinWeights).length);

  const poseCtxRef = useRef({
    meshes, bones, cameras, particles, lights, activeClip, procAnimId, procSpeed,
    activeCameraId, cameraView, activeMeshId, editId, editKind, meshTextureTick, sequence, clips,
    timelineTab, showBones, litPreview, showLightHelpers,
  });
  poseCtxRef.current = {
    meshes, bones, cameras, particles, lights, activeClip, procAnimId, procSpeed,
    activeCameraId, cameraView, activeMeshId, editId, editKind, meshTextureTick, sequence, clips,
    timelineTab, showBones, litPreview, showLightHelpers,
  };
  pxPerSecRef.current = pxPerSec;

  // Model-mode / scene edits: ensure every object has tracks and rest keys match the scene.
  const sceneSyncSig = useMemo(
    () =>
      JSON.stringify({
        meshes: meshes.map((m) => ({
          id: m.id,
          p: m.position,
          r: m.rotation,
          s: m.scale,
          rev: m.revision || 0,
          vc: m.vertices.length,
          fc: m.faces.length,
          tex: m.textureCanvasDataUrl?.length || 0,
        })),
        bones: bones.map((b) => ({
          id: b.id,
          p: b.position,
          r: b.rotation,
          s: b.scale,
        })),
        cameras: cameras.map((c) => ({
          id: c.id,
          p: c.position,
          r: c.rotation,
          fov: c.fov,
        })),
        lights: lights.map((L) => ({
          id: L.id,
          p: L.position,
          r: L.rotation,
          s: L.scale,
        })),
        particles: particles.map((p) => ({
          id: p.id,
          p: p.position,
          r: p.rotation,
          s: p.scale,
        })),
      }),
    [meshes, bones, cameras, lights, particles],
  );
  const lastSceneSyncSigRef = useRef('');
  useEffect(() => {
    if (sceneSyncSig === lastSceneSyncSigRef.current) return;
    lastSceneSyncSigRef.current = sceneSyncSig;
    const sceneRest = { meshes, bones, cameras, lights, particles };
    setClips((prev) => {
      let any = false;
      const next = prev.map((clip) => {
        const withTracks = ensureClipTracksForScene(clip, sceneRest);
        const rebased = rebaseClipTracksToScene(withTracks, sceneRest);
        if (rebased !== clip) any = true;
        return rebased;
      });
      return any ? next : prev;
    });
    lastPoseSyncTimeRef.current = -1;
    structureDirtyRef.current = true;
    requestAnimationFrame(() => {
      syncViewportPoseRef.current(currentTimeRef.current);
    });
  }, [sceneSyncSig, meshes, bones, cameras, lights, particles]);

  const resolvePosed = (time: number) => {
    const ctx = poseCtxRef.current;
    let clip = ctx.activeClip;
    let localTime = time;
    if (ctx.timelineTab === 'seq' && ctx.sequence) {
      const hit = activeAnimClipAtTime(ctx.sequence, ctx.clips, time);
      if (hit) {
        clip = hit.clip;
        localTime = hit.localTime;
      }
    }
    const base = clip
      ? evaluateClipAtTime(clip, localTime, ctx.bones, ctx.meshes, ctx.cameras, ctx.lights)
      : { bones: ctx.bones, meshes: ctx.meshes, cameras: ctx.cameras, lights: ctx.lights };
    if (!ctx.procAnimId || !base.bones.length) return base;
    return {
      ...base,
      bones: evaluateProceduralBoneAnim(base.bones, ctx.procAnimId, localTime, ctx.procSpeed),
    };
  };

  const updatePlayheadDom = (time: number) => {
    const left = `${time * pxPerSecRef.current}px`;
    playheadElsRef.current.forEach((el) => {
      if (el) el.style.left = left;
    });
    const clip = poseCtxRef.current.activeClip;
    const dur = clip?.duration || (poseCtxRef.current.procAnimId ? 8 : 0);
    const label = `${time.toFixed(2)}s / ${dur.toFixed(2)}s`;
    timeLabelElsRef.current.forEach((el) => {
      if (el) el.textContent = label;
    });
  };
  const updatePlayheadDomRef = useRef(updatePlayheadDom);
  updatePlayheadDomRef.current = updatePlayheadDom;

  const syncViewportPose = (time: number) => {
    const meshesGroup = meshesGroupRef.current;
    const bonesGroup = bonesGroupRef.current;
    const camerasGroup = camerasGroupRef.current;
    if (!meshesGroup || !bonesGroup || !camerasGroup) return;

    const ctx = poseCtxRef.current;
    const posed = resolvePosed(time);
    const playing = isPlayingRef.current;
    const meshCache = viewportMeshesRef.current;
    const seenMeshes = new Set<string>();

    posed.meshes.forEach((m) => {
      if (m.visible === false) return;
      seenMeshes.add(m.id);
      const skinned = deformMeshWithBones(m, posed.bones);
      const needsSkin = Boolean(m.skinWeights && Object.keys(m.skinWeights).length && posed.bones.length);
      const geoKey = needsSkin
        ? `skin:${time.toFixed(4)}:${m.revision || 0}:${m.vertices.length}:${m.textureCanvasDataUrl || ''}`
        : `rest:${m.id}:${m.revision || 0}:${m.vertices.length}:${m.faces.length}:${ctx.meshTextureTick}:${m.textureCanvasDataUrl || ''}`;
      const liveMap = ctx.activeMeshId && m.id === ctx.activeMeshId ? liveTextureRef.current : null;
      let cachedMap = meshTextureCacheRef.current.get(m.id)?.texture || null;
      const cachedUrl = meshTextureCacheRef.current.get(m.id)?.dataUrl;
      if (m.textureCanvasDataUrl && m.textureCanvasDataUrl !== cachedUrl) {
        const dataUrl = m.textureCanvasDataUrl;
        const image = new Image();
        image.onload = () => {
          const prev = meshTextureCacheRef.current.get(m.id);
          prev?.texture.dispose();
          const texture = makeNearestTexture(image);
          meshTextureCacheRef.current.set(m.id, { dataUrl, texture });
          setMeshTextureTick((tick) => tick + 1);
        };
        image.src = dataUrl;
      }
      const map = liveMap || cachedMap;
      if (map) map.needsUpdate = true;

      let entry = meshCache.get(m.id);
      if (!entry) {
        const cinematic = Boolean(ctx.litPreview);
        const mat = new THREE.MeshStandardMaterial({
          map,
          color: map ? 0xffffff : 0xa5a6a8,
          vertexColors: false,
          // Keep DoubleSide — CAD meshes often have mixed winding; FrontSide looks inside-out.
          roughness: cinematic ? (map ? 0.7 : 0.52) : 0.64,
          metalness: cinematic ? 0.28 : 0.08,
          side: THREE.DoubleSide,
        });
        const geo = buildThreeGeometry(skinned);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { animTarget: 'mesh', targetId: m.id };
        meshesGroup.add(mesh);
        entry = { mesh, edges: null, mat, geoKey };
        meshCache.set(m.id, entry);
      } else if (entry.geoKey !== geoKey) {
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = buildThreeGeometry(skinned);
        entry.geoKey = geoKey;
        entry.mat.map = map;
        entry.mat.color.set(map ? 0xffffff : 0xa5a6a8);
        entry.mat.vertexColors = false;
        entry.mat.needsUpdate = true;
        if (entry.edges) {
          entry.edges.geometry.dispose();
          if (!playing) {
            entry.edges.geometry = new THREE.EdgesGeometry(entry.mesh.geometry, 30);
            entry.edges.visible = !ctx.litPreview;
          } else {
            entry.edges.visible = false;
          }
        }
      } else {
        entry.mat.map = map;
        entry.mat.color.set(map ? 0xffffff : 0xa5a6a8);
        entry.mat.vertexColors = false;
        entry.mat.needsUpdate = true;
      }

      // Keep materials in sync when toggling Cinematic mid-session.
      {
        const cinematic = Boolean(ctx.litPreview);
        entry.mat.side = THREE.DoubleSide;
        entry.mat.roughness = cinematic ? (map ? 0.7 : 0.52) : 0.64;
        entry.mat.metalness = cinematic ? 0.28 : 0.08;
      }

      if (!playing && !entry.edges) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(entry.mesh.geometry, 30),
          new THREE.LineBasicMaterial({
            color: 0x9ec8ff,
            transparent: true,
            opacity: map ? 0.22 : 0.55,
          }),
        );
        edges.userData = { animTarget: 'mesh', targetId: m.id };
        edges.visible = !ctx.litPreview;
        meshesGroup.add(edges);
        entry.edges = edges;
      } else if (playing && entry.edges) {
        entry.edges.visible = false;
      } else if (!playing && entry.edges) {
        // Unlit edge overlays would show even with zero scene lights — hide in cinematic.
        entry.edges.visible = !ctx.litPreview;
      }

      entry.mesh.userData = { animTarget: 'mesh', targetId: m.id };
      const transformBusy = gizmoDraggingRef.current || Boolean(modalTransformRef.current);
      const skipXform = transformBusy && ctx.editKind === 'mesh' && ctx.editId === m.id;
      if (!skipXform) {
        entry.mesh.position.set(m.position.x, m.position.y, m.position.z);
        entry.mesh.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
        entry.mesh.scale.set(m.scale.x, m.scale.y, m.scale.z);
      }
      if (entry.edges) {
        entry.edges.position.copy(entry.mesh.position);
        entry.edges.rotation.copy(entry.mesh.rotation);
        entry.edges.scale.copy(entry.mesh.scale);
      }
    });

    meshCache.forEach((entry, id) => {
      if (seenMeshes.has(id)) return;
      meshesGroup.remove(entry.mesh);
      if (entry.edges) meshesGroup.remove(entry.edges);
      entry.mesh.geometry.dispose();
      entry.mat.dispose();
      entry.edges?.geometry.dispose();
      (entry.edges?.material as THREE.Material | undefined)?.dispose?.();
      meshCache.delete(id);
    });

    const boneCache = viewportBonesRef.current;
    const seenBones = new Set<string>();
    posed.bones.forEach((bone) => {
      if (bone.visible === false) return;
      seenBones.add(bone.id);
      let joint = boneCache.get(bone.id);
      if (!joint) {
        joint = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 8),
          new THREE.MeshBasicMaterial({ color: bone.color || VIEWPORT_THEME.boneIdle, depthTest: false }),
        );
        joint.renderOrder = 20;
        joint.userData = { animTarget: 'bone', targetId: bone.id };
        bonesGroup.add(joint);
        boneCache.set(bone.id, joint);
      }
      const mat = joint.material as THREE.MeshBasicMaterial;
      mat.color.set(bone.id === ctx.editId && ctx.editKind === 'bone' ? 0xffffff : (bone.color || VIEWPORT_THEME.boneIdle));
      const skipBone =
        (gizmoDraggingRef.current || Boolean(modalTransformRef.current)) &&
        ctx.editKind === 'bone' &&
        ctx.editId === bone.id;
      if (!skipBone) {
        joint.position.set(bone.position.x, bone.position.y, bone.position.z);
      }
      joint.visible = !playing && !!ctx.showBones;
    });
    boneCache.forEach((joint, id) => {
      if (seenBones.has(id)) return;
      bonesGroup.remove(joint);
      joint.geometry.dispose();
      (joint.material as THREE.Material).dispose();
      boneCache.delete(id);
    });

    const camCache = viewportCamsRef.current;
    const seenCams = new Set<string>();
    const posedActive = posed.cameras.find((c) => c.id === ctx.activeCameraId) || posed.cameras[0] || null;
    posed.cameras.forEach((cam) => {
      if (cam.visible === false) return;
      if (ctx.cameraView && posedActive && cam.id === posedActive.id) {
        const existing = camCache.get(cam.id);
        if (existing) existing.visible = false;
        return;
      }
      seenCams.add(cam.id);
      let helper = camCache.get(cam.id);
      if (!helper) {
        helper = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.18, 0.35),
          new THREE.MeshBasicMaterial({ color: 0x888888 }),
        );
        const lens = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.08, 0.12, 10),
          new THREE.MeshBasicMaterial({ color: 0x222222 }),
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.z = -0.22;
        helper.add(body, lens);
        helper.userData = { animTarget: 'camera', targetId: cam.id };
        body.userData = { animTarget: 'camera', targetId: cam.id };
        lens.userData = { animTarget: 'camera', targetId: cam.id };
        camerasGroup.add(helper);
        camCache.set(cam.id, helper);
      }
      helper.visible = true;
      const body = helper.children[0] as THREE.Mesh;
      (body.material as THREE.MeshBasicMaterial).color.set(
        cam.id === posedActive?.id ? VIEWPORT_THEME.cameraSelected : VIEWPORT_THEME.cameraIdle,
      );
      const skipCam =
        (gizmoDraggingRef.current || Boolean(modalTransformRef.current)) &&
        ctx.editKind === 'camera' &&
        ctx.editId === cam.id;
      if (!skipCam) {
        helper.position.set(cam.position.x, cam.position.y, cam.position.z);
        helper.rotation.set(cam.rotation.x, cam.rotation.y, cam.rotation.z);
      }
    });
    camCache.forEach((helper, id) => {
      if (seenCams.has(id)) return;
      if (ctx.cameraView && posedActive && id === posedActive.id) {
        helper.visible = false;
        return;
      }
      camerasGroup.remove(helper);
      helper.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      camCache.delete(id);
    });

    if (posedActive && cineCamRef.current) {
      const cine = cineCamRef.current;
      // Sequence camera override (hard cut / dissolve / fade / dip)
      let camPose = posedActive;
      let fromPose: typeof posedActive | null = null;
      let blend = 1;
      let blackOpacity = 0;
      if (ctx.timelineTab === 'seq' && ctx.sequence) {
        const shot = cameraShotAtTime(ctx.sequence, time);
        if (shot) {
          const override = posed.cameras?.find((c) => c.id === shot.cameraId)
            || ctx.cameras.find((c) => c.id === shot.cameraId);
          if (override) camPose = override;
          if (shot.fromCameraId && shot.transition === 'dissolve' && shot.blend < 1) {
            fromPose = posed.cameras?.find((c) => c.id === shot.fromCameraId)
              || ctx.cameras.find((c) => c.id === shot.fromCameraId)
              || null;
            blend = shot.blend;
          }
          blackOpacity = shot.blackOpacity;
        }
      }
      if (seqBlackRef.current) {
        seqBlackRef.current.style.opacity = String(blackOpacity);
      }
      if (seqTitlesRef.current) {
        if (ctx.timelineTab === 'seq' && ctx.sequence) {
          const overlays = overlayClipsAtTime(ctx.sequence, time);
          seqTitlesRef.current.innerHTML = overlays.map((o) => {
            const style = o.clip.textStyle || {};
            const pos = style.position || (o.clip.source.type === 'title' ? 'center' : 'bottom');
            const align = style.align || 'center';
            const top = pos === 'top' ? '8%' : pos === 'bottom' ? 'auto' : '50%';
            const bottom = pos === 'bottom' ? '10%' : 'auto';
            const transform = pos === 'center' ? 'translate(-50%, -50%)' : 'translateX(-50%)';
            const left = align === 'left' ? '8%' : align === 'right' ? '92%' : '50%';
            const tx = align === 'left' ? '0' : align === 'right' ? '-100%' : null;
            const fontSize = style.fontSize || (o.clip.source.type === 'title' ? 42 : 22);
            const color = style.color || '#ffffff';
            const finalTransform = tx
              ? `translate(${tx}, ${pos === 'center' ? '-50%' : '0'})`
              : transform;
            const escaped = o.text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\n/g, '<br/>');
            return `<div style="position:absolute;left:${left};top:${top};bottom:${bottom};transform:${finalTransform};opacity:${o.opacity};color:${color};font-size:${fontSize}px;font-family:Georgia,'Times New Roman',serif;text-align:${align};text-shadow:0 2px 12px rgba(0,0,0,.85);max-width:80%;line-height:1.25;pointer-events:none;white-space:pre-wrap">${escaped}</div>`;
          }).join('');
        } else {
          seqTitlesRef.current.innerHTML = '';
        }
      }
      const skipFov = sliderDragRef.current?.kind === 'camera' && sliderDragRef.current.id === camPose.id;
      if (fromPose && blend < 1) {
        const a = fromPose;
        const b = camPose;
        cine.position.set(
          a.position.x + (b.position.x - a.position.x) * blend,
          a.position.y + (b.position.y - a.position.y) * blend,
          a.position.z + (b.position.z - a.position.z) * blend,
        );
        const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.rotation.x, a.rotation.y, a.rotation.z));
        const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rotation.x, b.rotation.y, b.rotation.z));
        qa.slerp(qb, blend);
        cine.quaternion.copy(qa);
        if (!skipFov) cine.fov = a.fov + (b.fov - a.fov) * blend;
        cine.near = b.near;
        cine.far = b.far;
        cine.updateProjectionMatrix();
      } else {
        if (!skipFov) cine.fov = camPose.fov;
        cine.near = camPose.near;
        cine.far = camPose.far;
        cine.position.set(camPose.position.x, camPose.position.y, camPose.position.z);
        if (camPose.lookAt) {
          cine.lookAt(camPose.lookAt.x, camPose.lookAt.y, camPose.lookAt.z);
        } else {
          cine.rotation.set(camPose.rotation.x, camPose.rotation.y, camPose.rotation.z);
        }
        cine.updateProjectionMatrix();
      }
    } else {
      if (seqBlackRef.current) seqBlackRef.current.style.opacity = '0';
      if (seqTitlesRef.current) seqTitlesRef.current.innerHTML = '';
    }

    // CAD lights → Three lights + helpers
    {
      const scene = sceneRef.current;
      const lightCache = viewportLightsRef.current;
      if (scene) {
        let allowed: Set<string> | null = null;
        if (ctx.timelineTab === 'seq' && ctx.sequence) {
          allowed = lightIdsAtTime(ctx.sequence, time);
        }
        const seen = new Set<string>();
        const posedLights = posed.lights || ctx.lights;
        const helpersVisible = ctx.showLightHelpers !== false;
        posedLights.forEach((L) => {
          if (L.visible === false) return;
          if (allowed && !allowed.has(L.id)) return;
          seen.add(L.id);
          let entry = lightCache.get(L.id);
          if (!entry || (entry.light.userData.lightType !== L.type)) {
            if (entry) {
              scene.remove(entry.light);
              scene.remove(entry.helper);
              if (
                entry.light instanceof THREE.DirectionalLight
                || entry.light instanceof THREE.SpotLight
              ) {
                scene.remove(entry.light.target);
              }
            }
            const light = createThreeLightFromCad(L);
            const helper = createCadLightHelper(L, ctx.editId === L.id && ctx.editKind === 'light');
            scene.add(light);
            scene.add(helper);
            entry = { light, helper };
            lightCache.set(L.id, entry);
          }
          const skipLight =
            ((gizmoDraggingRef.current || Boolean(modalTransformRef.current)) &&
              ctx.editKind === 'light' &&
              ctx.editId === L.id)
            || (sliderDragRef.current?.kind === 'light' && sliderDragRef.current.id === L.id);
          syncThreeLightFromCad(entry.light, entry.helper, L, scene, skipLight);
          entry.helper.visible = helpersVisible;
          const selected = ctx.editId === L.id && ctx.editKind === 'light';
          entry.helper.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
              obj.material.color.set(selected ? '#ffffff' : L.color);
            }
            if (obj instanceof THREE.LineSegments && obj.material instanceof THREE.LineBasicMaterial) {
              obj.material.color.set(selected ? '#ffffff' : '#ffcc66');
            }
          });
        });
        lightCache.forEach((entry, id) => {
          if (seen.has(id)) return;
          scene.remove(entry.light);
          scene.remove(entry.helper);
          if (entry.light instanceof THREE.DirectionalLight || entry.light instanceof THREE.SpotLight) {
            scene.remove(entry.light.target);
          }
          lightCache.delete(id);
        });
      }
    }

    // Particle enable from sequence FX clips
    if (ctx.timelineTab === 'seq' && ctx.sequence) {
      const activeFx = particleIdsAtTime(ctx.sequence, time);
      particleSystemsRef.current.forEach((sys, id) => {
        sys.group.visible = activeFx.size === 0 ? true : activeFx.has(id);
      });
      const weatherCue = weatherCueAtTime(ctx.sequence, time);
      if (weatherCue && environmentRef.current.weather !== weatherCue) {
        // Soft apply: update sky/fog live from cue without React thrash every frame.
        const next = weatherPresetToEnv(weatherCue, environmentRef.current);
        environmentRef.current = next;
        const scene = sceneRef.current;
        if (scene) {
          if (litPreviewRef.current) {
            if (next.backgroundMode === 'solid') {
              scene.background = new THREE.Color(next.backgroundColor || '#000000');
            } else {
              const top = new THREE.Color(next.skyTopColor);
              const horizon = new THREE.Color(next.skyHorizonColor);
              scene.background = top.clone().lerp(horizon, 0.45);
            }
          } else {
            scene.background = new THREE.Color('#1b1b1b');
          }
          if (next.fogDensity > 0.001) scene.fog = new THREE.FogExp2(next.fogColor, next.fogDensity);
          else scene.fog = null;
        }
      }
    }

    const transformBusy = gizmoDraggingRef.current || Boolean(modalTransformRef.current);
    if (controlsRef.current) controlsRef.current.enabled = !ctx.cameraView && !transformBusy;

    // Attach gizmo to the live Three object so it cannot drift from the viewport mesh.
    const tc = transformControlsRef.current;
    if (tc) {
      const viewCam = ctx.cameraView && cineCamRef.current ? cineCamRef.current : freeCamRef.current;
      if (viewCam) tc.camera = viewCam;

      if (ctx.cameraView || !ctx.editId) {
        tc.detach();
        tc.visible = false;
        tc.enabled = false;
      } else if (modalTransformRef.current) {
        // Modal G/R/S: hide gizmo for free grab; restore when modal ends.
        tc.enabled = false;
        tc.visible = false;
        tc.getHelper().visible = false;
      } else if (!gizmoDraggingRef.current) {
        let obj: THREE.Object3D | null = null;
        if (ctx.editKind === 'mesh') obj = viewportMeshesRef.current.get(ctx.editId)?.mesh || null;
        else if (ctx.editKind === 'bone') obj = viewportBonesRef.current.get(ctx.editId) || null;
        else if (ctx.editKind === 'camera') obj = viewportCamsRef.current.get(ctx.editId) || null;
        else if (ctx.editKind === 'particle') {
          obj = particleMarkersRef.current?.children.find((c) => c.userData?.targetId === ctx.editId) || null;
        } else if (ctx.editKind === 'light') {
          obj = viewportLightsRef.current.get(ctx.editId)?.helper || null;
        }
        if (obj) {
          if (tc.object !== obj) tc.attach(obj);
          tc.visible = true;
          tc.enabled = true;
          tc.getHelper().visible = true;
        } else {
          tc.detach();
          tc.visible = false;
          tc.getHelper().visible = false;
        }
      }
    }
  };
  syncViewportPoseRef.current = syncViewportPose;

  const applyPresetInStudio = (id: SkeletonPresetId) => {
    const label = SKELETON_PRESETS.find((p) => p.id === id)?.label || id;
    if (bones.length && !window.confirm(`Replace skeleton with ${label}? Mesh is kept.`)) return;
    const preset = applySkeletonPreset(id, skinTarget);
    setBones(preset);
    setSelectedBoneId(preset[0]?.id || '');
    setProcAnimId(id === 'fish' ? 'fish_swim_x' : id === 'bird' ? 'bird_idle_1' : null);
    if (skinTarget?.skinWeights) {
      setMeshes((current) => current.map((mesh) => mesh.id === skinTarget.id ? unbindSkin(mesh) : mesh));
    }
  };

  const animationTargets = [
    ...meshes.map((mesh) => ({
      id: mesh.id,
      name: mesh.name,
      targetType: 'mesh' as const,
      position: mesh.position,
      rotation: mesh.rotation,
      scale: mesh.scale,
    })),
    ...bones.map((bone) => ({
      id: bone.id,
      name: bone.name,
      targetType: 'bone' as const,
      position: bone.position,
      rotation: bone.rotation,
      scale: bone.scale,
    })),
    ...cameras.map((cam) => ({
      id: cam.id,
      name: cam.name,
      targetType: 'camera' as const,
      position: cam.position,
      rotation: cam.rotation,
      scale: { x: cam.fov, y: 1, z: 1 },
    })),
    ...particles.map((p) => ({
      id: p.id,
      name: p.name,
      targetType: 'particle' as const,
      position: p.position,
      rotation: p.rotation,
      scale: { x: 1, y: 1, z: 1 },
    })),
    ...lights.map((L) => ({
      id: L.id,
      name: L.name,
      targetType: 'light' as const,
      position: L.position,
      rotation: L.rotation,
      scale: L.scale,
    })),
  ];

  useEffect(() => {
    if (!selectedTrackId && animationTargets[0]) setSelectedTrackId(animationTargets[0].id);
  }, [animationTargets, selectedTrackId]);

  useEffect(() => {
    // While playing, RAF owns currentTimeRef — never let a lagged setState rewind it.
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
    updatePlayheadDom(currentTime);
  }, [currentTime]);

  // Scene bootstrap
  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const freeCam = new THREE.PerspectiveCamera(38, width / height, 0.01, 500);
    freeCam.position.set(5.5, 3.5, 8);
    freeCamRef.current = freeCam;

    const cineCam = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    cineCamRef.current = cineCam;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);
    ensureAreaLightSupport();

    const controls = new OrbitControls(freeCam, renderer.domElement);
    controls.enableDamping = true;
    applyStandardOrbitMouseButtons(controls);
    const unbindNavMods = bindBlockbenchOrbitModifiers(controls, renderer.domElement);
    controlsRef.current = controls;

    // OutlineForge-style studio fill (edit mode). Hidden in Cinematic.
    const ambient = new THREE.HemisphereLight(0xffffff, 0x242424, 1.45);
    ambientRef.current = ambient;
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(4, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    const shadowSpan = 10;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    sunRef.current = sun;
    scene.add(sun);
    const grid = new THREE.GridHelper(14, 28, VIEWPORT_THEME.gridMajor, VIEWPORT_THEME.gridMinor);
    grid.position.y = -0.001;
    gridHelperRef.current = grid;
    scene.add(grid);

    // Soft contact-shadow catcher — always on in edit; darker in Cinematic.
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.ShadowMaterial({ opacity: 0.18, color: 0x000000 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = -0.002;
    shadowCatcher.receiveShadow = true;
    shadowCatcher.visible = true;
    shadowCatcherRef.current = shadowCatcher;
    scene.add(shadowCatcher);

    const meshesGroup = new THREE.Group();
    meshesGroupRef.current = meshesGroup;
    scene.add(meshesGroup);
    const camerasGroup = new THREE.Group();
    camerasGroupRef.current = camerasGroup;
    scene.add(camerasGroup);
    const bonesGroup = new THREE.Group();
    bonesGroupRef.current = bonesGroup;
    scene.add(bonesGroup);
    const particleMarkers = new THREE.Group();
    particleMarkersRef.current = particleMarkers;
    scene.add(particleMarkers);

    const gizmoProxy = new THREE.Object3D();
    gizmoProxyRef.current = gizmoProxy;
    scene.add(gizmoProxy);

    const tc = new TransformControls(freeCam, renderer.domElement);
    tc.setSize(0.85);
    applyThemedTransformGizmo(tc);
    transformControlsRef.current = tc;
    tc.addEventListener('dragging-changed', (event) => {
      const dragging = !!event.value;
      gizmoDraggingRef.current = dragging;
      if (controlsRef.current) controlsRef.current.enabled = !dragging && !cameraViewRef.current;
      // Commit live Three transform → CAD / keys when the user releases the gizmo.
      if (!dragging) commitGizmoTransformRef.current();
    });
    const helper = tc.getHelper();
    scene.add(helper);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Advance playhead in the same RAF as rendering (smooth, no React per-frame).
      if (isPlayingRef.current) {
        const ctx = poseCtxRef.current;
        const duration = ctx.timelineTab === 'seq' && ctx.sequence
          ? sequenceEndTime(ctx.sequence)
          : (ctx.activeClip?.duration || (ctx.procAnimId ? 8 : 0));
        if (duration > 0) {
          let next = currentTimeRef.current + dt;
          if (next >= duration) {
            const recording = Boolean(mediaRecorderRef.current);
            const loop = !recording && (
              ctx.timelineTab === 'seq'
              || !ctx.activeClip
              || ctx.activeClip.loopMode === 'loop'
              || ctx.procAnimId
            );
            if (loop) {
              next %= duration;
            } else {
              next = duration;
              isPlayingRef.current = false;
              setIsPlayingRef.current(false);
              setCurrentTimeRef.current(next);
              if (recording) {
                mediaRecorderRef.current?.stop();
                mediaRecorderRef.current = null;
              }
            }
          }
          currentTimeRef.current = next;
          updatePlayheadDomRef.current(next);
          // Sync sequence audio
          syncSequenceAudioRef.current(next, true);
          uiTimeAccumRef.current += dt;
          if (uiTimeAccumRef.current >= 1 / 20) {
            uiTimeAccumRef.current = 0;
            setCurrentTimeRef.current(next);
          }
        }
      }

      const time = currentTimeRef.current;
      if (structureDirtyRef.current || Math.abs(time - lastPoseSyncTimeRef.current) > 1e-6) {
        syncViewportPoseRef.current(time);
        lastPoseSyncTimeRef.current = time;
        structureDirtyRef.current = false;
      }

      controls.update();
      particleSystemsRef.current.forEach((sys) => sys.update(dt, currentTimeRef.current));
      if (weatherPointsRef.current) {
        const env = environmentRef.current;
        const pos = weatherPointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i += 1) {
          let y = pos.getY(i) - dt * (env.weather === 'snow' ? 1.2 : 4);
          if (y < 0) y = 8 + Math.random() * 2;
          pos.setY(i, y);
          if (env.weather === 'rain' || env.weather === 'storm') {
            pos.setX(i, pos.getX(i) + env.windStrength * dt);
          }
        }
        pos.needsUpdate = true;
      }
      const cam = cameraViewRef.current && cineCamRef.current ? cineCamRef.current : freeCam;
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(tick);

    const applyRendererSize = (buffer = true) => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w < 1 || h < 1) return;
      freeCam.aspect = w / h;
      freeCam.updateProjectionMatrix();
      cineCam.aspect = w / h;
      cineCam.updateProjectionMatrix();
      // During panel drag we skip setSize so CSS can stretch the existing buffer.
      if (buffer) renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    };
    syncRendererSizeRef.current = () => applyRendererSize(true);

    let resizeRaf = 0;
    const onResize = () => {
      if (layoutResizingRef.current) {
        applyRendererSize(false);
        return;
      }
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        applyRendererSize(true);
      });
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => onResize())
      : null;
    resizeObserver?.observe(containerRef.current);
    requestAnimationFrame(() => applyRendererSize(true));

    return () => {
      cancelAnimationFrame(raf);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      syncRendererSizeRef.current = () => {};
      particleSystemsRef.current.forEach((s) => s.dispose());
      particleSystemsRef.current.clear();
      viewportMeshesRef.current.forEach((entry) => {
        entry.mesh.geometry.dispose();
        entry.mat.dispose();
        entry.edges?.geometry.dispose();
        (entry.edges?.material as THREE.Material | undefined)?.dispose?.();
      });
      viewportMeshesRef.current.clear();
      viewportBonesRef.current.forEach((joint) => {
        joint.geometry.dispose();
        (joint.material as THREE.Material).dispose();
      });
      viewportBonesRef.current.clear();
      viewportCamsRef.current.forEach((helper) => {
        helper.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });
      });
      viewportCamsRef.current.clear();
      if (shadowCatcherRef.current) {
        shadowCatcherRef.current.geometry.dispose();
        (shadowCatcherRef.current.material as THREE.Material).dispose();
        shadowCatcherRef.current = null;
      }
      transformControlsRef.current?.dispose();
      transformControlsRef.current = null;
      unbindNavMods();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      liveTextureRef.current?.dispose();
      liveTextureRef.current = null;
      meshTextureCacheRef.current.forEach((entry) => entry.texture.dispose());
      meshTextureCacheRef.current.clear();
    };
  }, []);

  // Live paint canvas for the active mesh
  useEffect(() => {
    liveTextureRef.current?.dispose();
    liveTextureRef.current = null;
    if (textureCanvas) {
      liveTextureRef.current = makeNearestTexture(textureCanvas) as THREE.CanvasTexture;
    }
    setMeshTextureTick((t) => t + 1);
  }, [textureCanvas, textureRevision, activeMeshId]);

  // Per-mesh textures from saved paint data URLs
  useEffect(() => {
    let cancelled = false;
    const cache = meshTextureCacheRef.current;
    const wanted = new Set<string>();

    meshes.forEach((mesh) => {
      const dataUrl = mesh.textureCanvasDataUrl;
      if (!dataUrl) return;
      wanted.add(mesh.id);
      const existing = cache.get(mesh.id);
      if (existing?.dataUrl === dataUrl) return;

      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        existing?.texture.dispose();
        const texture = makeNearestTexture(image);
        cache.set(mesh.id, { dataUrl, texture });
        setMeshTextureTick((t) => t + 1);
      };
      image.src = dataUrl;
    });

    cache.forEach((entry, id) => {
      if (!wanted.has(id)) {
        entry.texture.dispose();
        cache.delete(id);
      }
    });

    return () => { cancelled = true; };
  }, [meshes]);

  // Apply environment + lit preview presentation (no weather particle rebuild here)
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene) return;

    if (litPreview) {
      if (environment.backgroundMode === 'solid') {
        scene.background = new THREE.Color(environment.backgroundColor || '#000000');
      } else {
        const top = new THREE.Color(environment.skyTopColor);
        const horizon = new THREE.Color(environment.skyHorizonColor);
        scene.background = top.clone().lerp(horizon, 0.45);
      }
    } else {
      // Edit mode: same charcoal LIVE 3D look as the modeling viewport.
      scene.background = new THREE.Color('#1b1b1b');
    }

    if (environment.fogDensity > 0.001) {
      scene.fog = new THREE.FogExp2(environment.fogColor, environment.fogDensity);
    } else {
      scene.fog = null;
    }

    if (ambientRef.current) {
      // Edit: soft hemisphere fill. Cinematic: off — only authored CAD lights.
      ambientRef.current.color.set(litPreview ? environment.ambientColor : 0xffffff);
      ambientRef.current.groundColor.set(0x242424);
      ambientRef.current.intensity = litPreview ? 0 : 1.45;
      ambientRef.current.visible = !litPreview;
    }
    if (sunRef.current) {
      const dir = sunDirectionFromAngles(
        litPreview ? environment.sunElevation : (environment.sunElevation ?? 48),
        litPreview ? environment.sunAzimuth : (environment.sunAzimuth ?? 39),
      );
      sunRef.current.position.set(dir.x * 20, dir.y * 20, dir.z * 20);
      sunRef.current.color.set(litPreview ? environment.sunColor : 0xffffff);
      sunRef.current.intensity = litPreview ? 0 : 2.5;
      sunRef.current.visible = !litPreview;
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = !litPreview;
    }
    if (shadowCatcherRef.current) {
      // Soft studio contact shadow always; deeper catcher for cinematic CAD lights.
      shadowCatcherRef.current.visible = true;
      const mat = shadowCatcherRef.current.material as THREE.ShadowMaterial;
      mat.opacity = litPreview ? 0.55 : 0.18;
    }
    if (camerasGroupRef.current) {
      camerasGroupRef.current.visible = !litPreview;
    }
    if (bonesGroupRef.current) {
      bonesGroupRef.current.visible = !litPreview && showBones;
    }
    if (particleMarkersRef.current) {
      particleMarkersRef.current.visible = !litPreview;
    }
    if (renderer) {
      renderer.toneMapping = litPreview ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      // Slightly hotter exposure so Key/Rim read with more punch on dark BG.
      renderer.toneMappingExposure = litPreview ? 1.22 : 1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
    }
    // Remesh materials pick up cinematic roughness/metalness on next pose sync.
    structureDirtyRef.current = true;
  }, [
    environment.backgroundMode,
    environment.backgroundColor,
    environment.skyTopColor,
    environment.skyHorizonColor,
    environment.fogDensity,
    environment.fogColor,
    environment.ambientColor,
    environment.sunElevation,
    environment.sunAzimuth,
    environment.sunColor,
    litPreview,
    showBones,
  ]);

  // Weather particles — only when weather type changes (not every fog/sun slider tick)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (weatherPointsRef.current) {
      scene.remove(weatherPointsRef.current);
      weatherPointsRef.current.geometry.dispose();
      (weatherPointsRef.current.material as THREE.Material).dispose();
      weatherPointsRef.current = null;
    }
    if (environment.weather === 'rain' || environment.weather === 'snow' || environment.weather === 'storm') {
      const count = environment.weather === 'storm' ? 1200 : environment.weather === 'snow' ? 600 : 800;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * 16;
        positions[i * 3 + 1] = Math.random() * 10;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: environment.weather === 'snow' ? 0xffffff : 0x88aacc,
        size: environment.weather === 'snow' ? 0.06 : 0.03,
        transparent: true,
        opacity: 0.75,
      });
      const pts = new THREE.Points(geo, mat);
      weatherPointsRef.current = pts;
      scene.add(pts);
    }
  }, [environment.weather]);

  // Mark viewport pose dirty when *structure* changes — not every light intensity tick.
  const lightStructureSig = useMemo(
    () => lights.map((L) => `${L.id}:${L.type}:${L.visible === false ? 0 : 1}`).join('|'),
    [lights],
  );
  const cameraStructureSig = useMemo(
    () => cameras.map((c) => c.id).join('|'),
    [cameras],
  );

  useEffect(() => {
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
  }, [
    meshes,
    bones,
    cameraStructureSig,
    lightStructureSig,
    activeClip,
    procAnimId,
    meshTextureTick,
    activeMeshId,
    editId,
    editKind,
    activeCameraId,
    cameraView,
    isPlaying,
    showBones,
    litPreview,
    showLightHelpers,
  ]);

  // Particle emitter markers
  useEffect(() => {
    if (!particleMarkersRef.current) return;
    const group = particleMarkersRef.current;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose?.();
    }
    particles.forEach((p) => {
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12),
        new THREE.MeshBasicMaterial({
          color: p.id === editId && editKind === 'particle' ? 0xffffff : 0xe68619,
          wireframe: true,
          depthTest: false,
        }),
      );
      marker.position.set(p.position.x, p.position.y, p.position.z);
      marker.renderOrder = 21;
      marker.userData = { animTarget: 'particle', targetId: p.id };
      group.add(marker);
    });
  }, [particles, editId, editKind]);

  // Particles sync
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const map = particleSystemsRef.current;
    const ids = new Set(particles.map((p) => p.id));
    map.forEach((sys, id) => {
      if (!ids.has(id)) {
        scene.remove(sys.group);
        sys.dispose();
        map.delete(id);
      }
    });
    particles.forEach((p) => {
      let sys = map.get(p.id);
      if (!sys) {
        sys = new ParticleSystem(p);
        map.set(p.id, sys);
        scene.add(sys.group);
      } else {
        sys.updateEmitter(p);
      }
    });
  }, [particles]);

  // Playback is driven by the main WebGL RAF (see scene bootstrap).
  const startRecording = () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    const fps = timelineTab === 'seq' ? (sequence?.fps || recordFps) : recordFps;
    const stream = canvas.captureStream(fps);
    // Mix all sequence audio tracks into the recording when available.
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx && sequence) {
        const actx = new AudioCtx();
        const dest = actx.createMediaStreamDestination();
        sequence.tracks.filter((t) => t.kind === 'audio' && !t.muted).forEach((track) => {
          track.clips.forEach((clip) => {
            const asset = sequence.audioAssets.find((a) => a.id === clip.source.refId);
            if (!asset || clip.muted) return;
            const el = audioElementsRef.current.get(clip.id) || new Audio(asset.url);
            audioElementsRef.current.set(clip.id, el);
            try {
              const src = actx.createMediaElementSource(el);
              const gain = actx.createGain();
              gain.gain.value = clip.volume ?? 1;
              src.connect(gain);
              gain.connect(dest);
            } catch {
              // Element may already be connected from a prior record pass.
            }
          });
        });
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      }
    } catch {
      // Audio mix optional — video-only fallback.
    }
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    recordingChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(timelineTab === 'seq' ? sequence?.name : activeClip?.name) || 'cutscene'}.webm`.toLowerCase().replace(/\s+/g, '_');
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setIsPlaying(true);
    setCurrentTime(0);
    currentTimeRef.current = 0;
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  };

  const applyWeather = (weather: WeatherPreset) => {
    setEnvironment((prev) => weatherPresetToEnv(weather, prev));
  };

  const addParticleEffect = (preset?: ParticlePresetId) => {
    const emitter = preset ? createParticleFromPreset(preset) : null;
    if (emitter) {
      setParticles((prev) => [...prev, emitter]);
      setSelectedParticleId(emitter.id);
      selectEditTarget('particle', emitter.id);
      if (activeClip) {
        setClips((prev) => prev.map((clip) => {
          if (clip.id !== activeClip.id) return clip;
          return ensureTrackForTarget(clip, emitter.id, emitter.name, 'particle', {
            position: emitter.position,
            rotation: emitter.rotation,
            scale: { x: 1, y: 1, z: 1 },
          });
        }));
      }
      setLeftTab('particles');
      setLeftCollapsed(false);
      return;
    }
    setEditingParticle(null);
    setParticleModalOpen(true);
    setLeftTab('particles');
    setLeftCollapsed(false);
  };

  const removeParticle = (id: string) => {
    setParticles((prev) => prev.filter((p) => p.id !== id));
    if (selectedParticleId === id) setSelectedParticleId('');
    if (editKind === 'particle' && editId === id) {
      setEditId('');
      setEditKind('camera');
    }
    if (activeClip) {
      setClips((prev) => prev.map((clip) => clip.id !== activeClip.id ? clip : {
        ...clip,
        tracks: clip.tracks.filter((t) => !(t.targetType === 'particle' && t.targetId === id)),
      }));
    }
  };

  const handleAddTrack = (targetId: string) => {
    if (!activeClip) return;
    const target = animationTargets.find((t) => t.id === targetId);
    if (!target) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        if (c.tracks.some((t) => t.targetId === targetId)) return c;
        return ensureTrackForTarget(c, target.id, target.name, target.targetType, {
          position: target.position,
          rotation: target.rotation,
          scale: target.scale,
        });
      }),
    );
    setSelectedTrackId(targetId);
  };

  const handleAddKeyframe = (
    channel: 'pos' | 'rot' | 'scl' | 'all',
    trackId = selectedTrackId,
  ) => {
    if (!activeClip) return;
    const target = animationTargets.find((t) => t.id === trackId);
    if (!target) return;
    const t = snapTime(currentTime);
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        let next = ensureTrackForTarget(c, target.id, target.name, target.targetType, {
          position: target.position,
          rotation: target.rotation,
          scale: target.scale,
        });
        if (channel === 'all') {
          return autoKeyTarget(next, target.id, target.targetType, target.name, {
            position: target.position,
            rotation: target.rotation,
            scale: target.scale,
          }, t);
        }
        const value = channel === 'pos' ? target.position : channel === 'rot' ? target.rotation : target.scale;
        return insertKeyframe(next, target.id, target.targetType, channel, t, value);
      }),
    );
  };

  const handleKeyTextureFrame = (trackId = selectedTrackId, frameIndex = 0) => {
    if (!activeClip) return;
    const t = snapTime(currentTime);
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        const track = c.tracks.find((tr) => tr.targetId === trackId && tr.targetType === 'mesh');
        if (!track) return c;
        return insertTexFrameKeyframe(c, trackId, t, frameIndex);
      }),
    );
  };

  const handleKeyTextureClip = (clipId: string, trackId = selectedTrackId, holdSeconds = 0.5) => {
    if (!activeClip) return;
    const t = snapTime(currentTime);
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        const track = c.tracks.find((tr) => tr.targetId === trackId && tr.targetType === 'mesh');
        if (!track) return c;
        return insertTextureClipKey(c, trackId, t, clipId, t + holdSeconds);
      }),
    );
  };

  const handleDeleteKeyframe = () => {
    if (!activeClip || !selectedKeyframeId) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        return {
          ...c,
          tracks: c.tracks.map((track) => ({
            ...track,
            posKeyframes: track.posKeyframes.filter((k) => k.id !== selectedKeyframeId),
            rotKeyframes: track.rotKeyframes.filter((k) => k.id !== selectedKeyframeId),
            sclKeyframes: track.sclKeyframes.filter((k) => k.id !== selectedKeyframeId),
            texFrameKeyframes: (track.texFrameKeyframes || []).filter((k) => k.id !== selectedKeyframeId),
            textureClipKeys: (track.textureClipKeys || []).filter((k) => k.id !== selectedKeyframeId),
          })),
        };
      }),
    );
    setSelectedKeyframeId(null);
  };

  const handleGraphPatchKeyframe = (
    channel: 'pos' | 'rot' | 'scl',
    keyframeId: string,
    patch: { time?: number; value?: Vector3D },
  ) => {
    if (!activeClip) return;
    const key = channel === 'pos' ? 'posKeyframes' : channel === 'rot' ? 'rotKeyframes' : 'sclKeyframes';
    const tid = selectedTrackId || activeClip.tracks[0]?.targetId;
    if (patch.time != null) {
      currentTimeRef.current = patch.time;
      updatePlayheadDom(patch.time);
      isPlayingRef.current = false;
      setIsPlaying(false);
      setCurrentTime(patch.time);
    }
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        return {
          ...c,
          tracks: c.tracks.map((track) => {
            if (tid && track.targetId !== tid) return track;
            const frames = track[key].map((kf) => {
              if (kf.id !== keyframeId) return kf;
              return {
                ...kf,
                time: patch.time != null ? patch.time : kf.time,
                value: patch.value ? { ...patch.value } : kf.value,
              };
            }).sort((a, b) => a.time - b.time);
            return { ...track, [key]: frames };
          }),
        };
      }),
    );
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
  };

  const handleGraphInsertKeyframe = (
    channel: 'pos' | 'rot' | 'scl',
    time: number,
    value: Vector3D,
  ) => {
    if (!activeClip || !selectedTrackId) return;
    const track = activeClip.tracks.find((t) => t.targetId === selectedTrackId);
    if (!track) return;
    setClips((prev) =>
      prev.map((c) => (c.id === activeClip.id ? insertKeyframe(c, track.targetId, track.targetType, channel, time, value) : c)),
    );
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
  };

  const handleRemoveTrack = (targetId: string) => {
    if (!activeClip) return;
    setClips((prev) =>
      prev.map((c) => (c.id === activeClip.id ? { ...c, tracks: c.tracks.filter((t) => t.targetId !== targetId) } : c)),
    );
  };

  const handleReorderDopeTrack = (targetId: string, direction: 'up' | 'down') => {
    if (!activeClip) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        const idx = c.tracks.findIndex((t) => t.targetId === targetId);
        if (idx < 0) return c;
        const swap = direction === 'up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= c.tracks.length) return c;
        const tracks = [...c.tracks];
        [tracks[idx], tracks[swap]] = [tracks[swap], tracks[idx]];
        return { ...c, tracks };
      }),
    );
  };

  const setActiveClipDuration = (duration: number) => {
    if (!activeClip) return;
    const next = Math.max(0.5, duration);
    setClips((prev) => prev.map((c) => (c.id === activeClip.id ? { ...c, duration: next } : c)));
    if (currentTimeRef.current > next) {
      currentTimeRef.current = next;
      updatePlayheadDom(next);
      setCurrentTime(next);
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  };

  const startResizeClipDuration = (e: React.PointerEvent) => {
    if (!activeClip) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const origin = activeClip.duration;
    const fps = activeClip.fps || 24;
    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / Math.max(1, pxPerSecRef.current);
      const raw = Math.max(0.5, origin + dt);
      const next = snapToFrames
        ? Math.max(0.5, Math.round(raw * fps) / fps)
        : Math.max(0.5, Math.round(raw * 100) / 100);
      setActiveClipDuration(next);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const untracked = animationTargets.filter(
    (t) => !(activeClip?.tracks.some((tr) => tr.targetId === t.id)),
  );

  const clipDuration = timelineTab === 'seq' && sequence
    ? sequenceEndTime(sequence)
    : (activeClip?.duration || (procAnimId ? 8 : 4));
  const clipFps = activeClip?.fps || 24;
  const timelineWidthPx = Math.max(480, Math.ceil(clipDuration * pxPerSec) + 40);

  const snapTime = (t: number) => {
    const clamped = Math.max(0, Math.min(clipDuration, t));
    if (!snapToFrames) return Math.round(clamped * 1000) / 1000;
    const frame = Math.round(clamped * clipFps);
    return Math.max(0, Math.min(clipDuration, frame / clipFps));
  };

  const setPlayhead = (t: number, pause = true) => {
    const next = snapTime(t);
    currentTimeRef.current = next;
    updatePlayheadDom(next);
    lastPoseSyncTimeRef.current = -1;
    setCurrentTime(next);
    if (pause) {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  };

  const stepFrames = (delta: number) => {
    setPlayhead(currentTimeRef.current + delta / clipFps);
  };

  const timeFromPointer = (clientX: number, laneEl: HTMLElement) => {
    const rect = laneEl.getBoundingClientRect();
    const x = clientX - rect.left;
    return snapTime(x / pxPerSec);
  };

  const startScrub = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const lane = e.currentTarget;
    lane.setPointerCapture(e.pointerId);
    setPlayhead(timeFromPointer(e.clientX, lane));
    const onMove = (ev: PointerEvent) => setPlayhead(timeFromPointer(ev.clientX, lane));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startDragKeyframe = (
    e: React.PointerEvent,
    kfId: string,
    laneEl: HTMLElement,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedKeyframeId(kfId);
    laneEl.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const t = timeFromPointer(ev.clientX, laneEl);
      setPlayhead(t, false);
      if (!activeClip) return;
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== activeClip.id) return c;
          const mapKeys = (keys: typeof c.tracks[0]['posKeyframes']) =>
            keys.map((k) => (k.id === kfId ? { ...k, time: t } : k));
          return {
            ...c,
            tracks: c.tracks.map((track) => ({
              ...track,
              posKeyframes: mapKeys(track.posKeyframes),
              rotKeyframes: mapKeys(track.rotKeyframes),
              sclKeyframes: mapKeys(track.sclKeyframes),
            })),
          };
        }),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const keyAllVisibleTracks = () => {
    if (!activeClip) return;
    activeClip.tracks.forEach((track) => handleAddKeyframe('all', track.targetId));
  };

  const zoomTimeline = (factor: number) => {
    setPxPerSec((z) => Math.max(40, Math.min(600, Math.round(z * factor))));
  };

  const getTimelineMaxHeight = () => {
    const root = layoutRootRef.current;
    if (!root) return Math.max(480, Math.floor(window.innerHeight * 0.75));
    return Math.max(280, Math.floor(root.clientHeight * 0.9));
  };

  const applyTimelineHeight = (height: number) => {
    const next = Math.max(160, Math.min(getTimelineMaxHeight(), Math.round(height)));
    setTimelineCollapsed(false);
    setTimelineHeight(next);
    requestAnimationFrame(() => syncRendererSizeRef.current());
  };

  /** Double-click / button: cycle Compact → Comfortable → Tall → Nearly full. */
  const cycleTimelineHeight = () => {
    const max = getTimelineMaxHeight();
    const steps = [200, 280, 400, Math.floor(max * 0.65), max];
    const idx = steps.findIndex((step) => timelineHeight < step - 12);
    applyTimelineHeight(idx < 0 ? steps[0] : steps[idx]);
  };

  const maximizeTimelineEditor = () => {
    applyTimelineHeight(getTimelineMaxHeight());
    setLeftCollapsed(true);
  };

  const extendClipDuration = (extraSeconds: number) => {
    if (!activeClip) return;
    setActiveClipDuration(activeClip.duration + extraSeconds);
  };

  const renderRulerTicks = () => {
    const ticks = [];
    const majorEvery = pxPerSec >= 160 ? 0.5 : pxPerSec >= 80 ? 1 : 2;
    const minorEvery = majorEvery / 5;
    for (let t = 0; t <= clipDuration + 1e-6; t += minorEvery) {
      const timeVal = Math.round(t * 1000) / 1000;
      const isMajor = Math.abs(timeVal % majorEvery) < 1e-6 || Math.abs((timeVal % majorEvery) - majorEvery) < 1e-6;
      ticks.push(
        <div
          key={timeVal}
          style={{ left: timeVal * pxPerSec }}
          className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
        >
          <div className={`w-px ${isMajor ? 'h-3 bg-[#ed7300]' : 'h-1.5 bg-[#3a3a3a]'}`} />
          {isMajor && (
            <span className="text-[8px] font-mono text-[#6a9fd8] mt-0.5 whitespace-nowrap">
              {timeVal.toFixed(timeVal % 1 === 0 ? 0 : 1)}s
            </span>
          )}
        </div>,
      );
    }
    return ticks;
  };

  // Blender-style G/R/S modal + Esc in animation editor
  const enterFocusPlayback = () => {
    if (!focusPlayback) {
      focusRestoreRef.current = {
        leftCollapsed,
        timelineCollapsed,
        timelineHeight,
        editPopupOpen,
      };
    }
    setLeftCollapsed(true);
    setTimelineCollapsed(true);
    setEditPopupOpen(false);
    setFocusPlayback(true);
    setViewMenuOpen(false);
    setToolsMenuOpen(false);
    setFxMenuOpen(false);
    requestAnimationFrame(() => syncRendererSizeRef.current());
  };

  const exitFocusPlayback = () => {
    const restore = focusRestoreRef.current;
    if (restore) {
      setLeftCollapsed(restore.leftCollapsed);
      setTimelineCollapsed(restore.timelineCollapsed);
      setTimelineHeight(restore.timelineHeight);
      setEditPopupOpen(restore.editPopupOpen);
    } else {
      setLeftCollapsed(false);
      setTimelineCollapsed(false);
      setEditPopupOpen(true);
    }
    focusRestoreRef.current = null;
    setFocusPlayback(false);
    requestAnimationFrame(() => syncRendererSizeRef.current());
  };

  const toggleFocusPlayback = () => {
    if (focusPlayback) exitFocusPlayback();
    else enterFocusPlayback();
  };

  const handleLightwaveFocusCenter = () => {
    const controls = controlsRef.current;
    const cam = freeCamRef.current;
    if (!controls || !cam) return;
    const target = new THREE.Vector3(0, 1, 0);
    if (editKind === 'mesh' && editId) {
      const m = meshes.find((x) => x.id === editId);
      if (m) target.set(m.position.x, m.position.y, m.position.z);
    } else if (editKind === 'camera' && editId) {
      const c = cameras.find((x) => x.id === editId);
      if (c) target.set(c.position.x, c.position.y, c.position.z);
    } else if (editKind === 'light' && editId) {
      const L = lights.find((x) => x.id === editId);
      if (L) target.set(L.position.x, L.position.y, L.position.z);
    } else if (editKind === 'particle' && editId) {
      const p = particles.find((x) => x.id === editId);
      if (p) target.set(p.position.x, p.position.y, p.position.z);
    }
    controls.target.copy(target);
    cam.lookAt(target);
    controls.update();
  };

  const handleLightwaveDragPan = (
    deltaX: number,
    deltaY: number,
    _button: 0 | 2,
    shiftKey: boolean,
  ) => {
    if (!controlsRef.current || !freeCamRef.current || cameraView) return;
    panCameraInScreenSpace(
      freeCamRef.current,
      controlsRef.current.target,
      deltaX,
      deltaY,
      containerRef.current?.clientHeight || 720,
      shiftKey,
    );
    controlsRef.current.update();
  };

  const handleLightwaveDragOrbit = (deltaX: number, deltaY: number) => {
    if (!controlsRef.current || !freeCamRef.current || cameraView) return;
    const factor = 0.005;
    const offset = new THREE.Vector3().subVectors(freeCamRef.current.position, controlsRef.current.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * factor;
    spherical.phi -= deltaY * factor;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    offset.setFromSpherical(spherical);
    freeCamRef.current.position.copy(controlsRef.current.target).add(offset);
    freeCamRef.current.lookAt(controlsRef.current.target);
    controlsRef.current.update();
  };

  const handleLightwaveDragZoom = (deltaX: number, deltaY: number) => {
    if (!freeCamRef.current || !controlsRef.current || cameraView) return;
    const delta = -(deltaX + deltaY) * 0.01;
    const dir = new THREE.Vector3();
    freeCamRef.current.getWorldDirection(dir);
    freeCamRef.current.position.addScaledVector(dir, delta * 0.5);
    controlsRef.current.update();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (modalTransform && modalSnapshotRef.current) {
          const obj = transformControlsRef.current?.object;
          if (obj) {
            obj.position.copy(modalSnapshotRef.current.position);
            obj.rotation.copy(modalSnapshotRef.current.rotation);
            obj.scale.copy(modalSnapshotRef.current.scale);
          }
          setModalTransform(null);
          modalSnapshotRef.current = null;
          setFxMenuOpen(false);
          setViewMenuOpen(false);
          setToolsMenuOpen(false);
          return;
        }
        if (focusPlayback) {
          exitFocusPlayback();
          return;
        }
        setModalTransform(null);
        modalSnapshotRef.current = null;
        setFxMenuOpen(false);
        setViewMenuOpen(false);
        setToolsMenuOpen(false);
        return;
      }

      if (e.key.toLowerCase() === 'f' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleFocusPlayback();
        return;
      }

      if (e.key.toLowerCase() === 't' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (timelineHeight >= getTimelineMaxHeight() - 24) {
          applyTimelineHeight(280);
          setLeftCollapsed(false);
        } else {
          maximizeTimelineEditor();
        }
        return;
      }

      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCameraView(false);
        setGizmoMode('translate');
        setModalTransform('translate');
        const obj = transformControlsRef.current?.object;
        if (obj) {
          modalSnapshotRef.current = {
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          };
        }
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCameraView(false);
        setGizmoMode('rotate');
        setModalTransform('rotate');
        const obj = transformControlsRef.current?.object;
        if (obj) {
          modalSnapshotRef.current = {
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          };
        }
      } else if (e.key.toLowerCase() === 's' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCameraView(false);
        setGizmoMode('scale');
        setModalTransform('scale');
        const obj = transformControlsRef.current?.object;
        if (obj) {
          modalSnapshotRef.current = {
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          };
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalTransform, focusPlayback, leftCollapsed, timelineCollapsed, timelineHeight, editPopupOpen]);

  // Modal mouse-move transform (anim editor)
  useEffect(() => {
    if (!modalTransform) return;
    const obj = transformControlsRef.current?.object;
    if (!obj) return;
    if (!modalSnapshotRef.current) {
      modalSnapshotRef.current = {
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale: obj.scale.clone(),
      };
    }
    const snap = modalSnapshotRef.current;
    let originX = 0;
    let originY = 0;
    let started = false;
    const sens = modalTransform === 'rotate' ? 0.012 : modalTransform === 'scale' ? 0.008 : 0.01;
    if (controlsRef.current) controlsRef.current.enabled = false;
    if (transformControlsRef.current) {
      transformControlsRef.current.enabled = false;
      transformControlsRef.current.visible = false;
      transformControlsRef.current.getHelper().visible = false;
    }
    const cam = freeCamRef.current;

    const onMove = (e: PointerEvent) => {
      if (!started) {
        originX = e.clientX;
        originY = e.clientY;
        started = true;
      }
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      if (modalTransform === 'translate') {
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3(0, 1, 0);
        if (cam) {
          right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
          up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
        }
        obj.position.copy(snap.position).addScaledVector(right, dx * sens).addScaledVector(up, -dy * sens);
      } else if (modalTransform === 'rotate') {
        obj.rotation.set(snap.rotation.x + dy * sens, snap.rotation.y + dx * sens, snap.rotation.z);
      } else {
        const f = Math.max(0.05, 1 + dx * sens - dy * sens * 0.35);
        obj.scale.set(snap.scale.x * f, snap.scale.y * f, snap.scale.z * f);
      }
      // Keep wire edges in sync while grabbing
      if (editKind === 'mesh' && editId) {
        const entry = viewportMeshesRef.current.get(editId);
        if (entry?.edges) {
          entry.edges.position.copy(obj.position);
          entry.edges.rotation.copy(obj.rotation);
          entry.edges.scale.copy(obj.scale);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0) {
        commitGizmoTransformRef.current();
        setModalTransform(null);
        modalSnapshotRef.current = null;
      } else if (e.button === 2) {
        obj.position.copy(snap.position);
        obj.rotation.copy(snap.rotation);
        obj.scale.copy(snap.scale);
        if (editKind === 'mesh' && editId) {
          const entry = viewportMeshesRef.current.get(editId);
          if (entry?.edges) {
            entry.edges.position.copy(obj.position);
            entry.edges.rotation.copy(obj.rotation);
            entry.edges.scale.copy(obj.scale);
          }
        }
        setModalTransform(null);
        modalSnapshotRef.current = null;
      }
    };
    const onCtx = (e: Event) => e.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('contextmenu', onCtx);
      if (controlsRef.current) {
        controlsRef.current.enabled = !cameraViewRef.current && !gizmoDraggingRef.current && !modalTransformRef.current;
      }
      if (transformControlsRef.current) {
        const tc = transformControlsRef.current;
        const show = !cameraViewRef.current && !!tc.object;
        tc.enabled = show;
        tc.visible = show;
        tc.getHelper().visible = show;
      }
    };
  }, [modalTransform, editId, editKind]);

  // Timeline hotkeys when focused / hovering timeline
  useEffect(() => {
    if (!timelineFocus) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrames(e.shiftKey ? -5 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrames(e.shiftKey ? 5 : 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPlayhead(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPlayhead(clipDuration);
      } else if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleAddKeyframe('all');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeyframeId) {
        e.preventDefault();
        handleDeleteKeyframe();
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomTimeline(1.2);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomTimeline(1 / 1.2);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timelineFocus, selectedKeyframeId, clipDuration, clipFps, pxPerSec, activeClip, selectedTrackId]);

  const maybeAutoKey = (
    targetId: string,
    targetType: 'mesh' | 'bone' | 'camera' | 'light' | 'particle',
    name: string,
    transform: { position: Vector3D; rotation: Vector3D; scale: Vector3D },
  ) => {
    if (!autoKey || !activeClip) return;
    const t = snapTime(currentTime);
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== activeClip.id) return c;
        return autoKeyTarget(c, targetId, targetType, name, transform, t);
      }),
    );
  };

  const patchCamera = (id: string, partial: Partial<CADCamera>, opts?: { selectTab?: boolean }) => {
    setCameras((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...partial };
        const transformChanged = partial.position != null || partial.rotation != null || partial.fov != null;
        if (transformChanged) {
          maybeAutoKey(next.id, 'camera', next.name, {
            position: next.position,
            rotation: next.rotation,
            scale: { x: next.fov, y: 1, z: 1 },
          });
        }
        return next;
      }),
    );
    setSelectedTrackId(id);
    if (opts?.selectTab) setLeftTab('cameras');
  };

  const patchBone = (id: string, partial: Partial<CADBone>) => {
    setBones((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...partial };
        maybeAutoKey(next.id, 'bone', next.name, {
          position: next.position,
          rotation: next.rotation,
          scale: next.scale,
        });
        return next;
      }),
    );
    setSelectedTrackId(id);
  };

  const patchMesh = (id: string, partial: Partial<CADMesh>) => {
    setMeshes((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...partial };
        maybeAutoKey(next.id, 'mesh', next.name, {
          position: next.position,
          rotation: next.rotation,
          scale: next.scale,
        });
        return next;
      }),
    );
    setSelectedTrackId(id);
  };

  const patchParticle = (id: string, partial: Partial<ParticleEmitter>) => {
    setParticles((prev) => prev.map((p) => (p.id === id ? { ...p, ...partial } : p)));
    setSelectedParticleId(id);
  };

  const patchLight = (id: string, partial: Partial<CADLight>) => {
    setLights((prev) =>
      prev.map((L) => {
        if (L.id !== id) return L;
        const next = { ...L, ...partial };
        const transformChanged = partial.position != null || partial.rotation != null || partial.scale != null;
        if (transformChanged) {
          maybeAutoKey(next.id, 'light', next.name, {
            position: next.position,
            rotation: next.rotation,
            scale: next.scale,
          });
        }
        return next;
      }),
    );
    setSelectedTrackId(id);
  };

  /** Live Three.js update while dragging a light slider (no React). */
  const liveLight = (id: string, partial: Partial<CADLight>) => {
    sliderDragRef.current = { kind: 'light', id };
    const entry = viewportLightsRef.current.get(id);
    if (entry) applyLiveLightProps(entry.light, partial);
  };

  const commitLight = (id: string, partial: Partial<CADLight>) => {
    const entry = viewportLightsRef.current.get(id);
    if (entry) applyLiveLightProps(entry.light, partial);
    sliderDragRef.current = null;
    patchLight(id, partial);
  };

  const liveCameraFov = (id: string, fov: number) => {
    sliderDragRef.current = { kind: 'camera', id };
    const cine = cineCamRef.current;
    if (cine && (activeCameraId === id || editId === id)) {
      cine.fov = fov;
      cine.updateProjectionMatrix();
    }
  };

  const commitCameraFov = (id: string, fov: number) => {
    const cine = cineCamRef.current;
    if (cine && (activeCameraId === id || editId === id)) {
      cine.fov = fov;
      cine.updateProjectionMatrix();
    }
    sliderDragRef.current = null;
    patchCamera(id, { fov });
  };

  const liveEnvironment = (partial: Partial<EnvironmentSettings>) => {
    sliderDragRef.current = { kind: 'env', id: 'environment' };
    const scene = sceneRef.current;
    const next = { ...environmentRef.current, ...partial };
    environmentRef.current = next;
    if (!scene) return;
    if (partial.fogDensity != null || partial.fogColor != null) {
      if (next.fogDensity > 0.001) {
        scene.fog = new THREE.FogExp2(next.fogColor, next.fogDensity);
      } else {
        scene.fog = null;
      }
    }
    if (sunRef.current && (partial.sunElevation != null || partial.sunAzimuth != null || partial.sunColor != null)) {
      const dir = sunDirectionFromAngles(next.sunElevation, next.sunAzimuth);
      sunRef.current.position.set(dir.x * 20, dir.y * 20, dir.z * 20);
      sunRef.current.color.set(next.sunColor);
    }
  };

  const commitEnvironment = (partial: Partial<EnvironmentSettings>) => {
    liveEnvironment(partial);
    sliderDragRef.current = null;
    setEnvironment((prev) => ({ ...prev, ...partial }));
  };

  const commitGizmoTransform = () => {
    const tc = transformControlsRef.current;
    const obj = tc?.object;
    if (!obj || !editId || !editKind) return;
    const position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    const rotation = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    const scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
    // Keep edges / helpers aligned
    if (editKind === 'mesh') {
      const entry = viewportMeshesRef.current.get(editId);
      if (entry?.edges) {
        entry.edges.position.copy(obj.position);
        entry.edges.rotation.copy(obj.rotation);
        entry.edges.scale.copy(obj.scale);
      }
      patchMesh(editId, { position, rotation, scale });
    } else if (editKind === 'bone') {
      patchBone(editId, { position, rotation, scale });
    } else if (editKind === 'camera') {
      patchCamera(editId, { position, rotation, lookAt: null });
    } else if (editKind === 'particle') {
      patchParticle(editId, { position, rotation });
    } else if (editKind === 'light') {
      const current = lights.find((x) => x.id === editId);
      const patch: Partial<CADLight> = { position, rotation, scale };
      if (current?.type === 'point' || current?.type === 'spot') {
        patch.distance = Math.max(0.5, ((scale.x + scale.y + scale.z) / 3) * 8);
      }
      if (current?.type === 'area') {
        patch.width = Math.max(0.1, scale.x * 2);
        patch.height = Math.max(0.1, scale.y * 2);
      }
      patchLight(editId, patch);
    }
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
  };
  commitGizmoTransformRef.current = commitGizmoTransform;

  const syncSequenceAudio = (time: number, playing: boolean) => {
    const seq = sequence;
    if (!seq) return;
    const active = audioClipsAtTime(seq, time);
    const activeIds = new Set(active.map((a) => a.clip.id));
    const gainById = new Map(active.map((a) => [a.clip.id, a.gain]));
    // Keep elements for every audio clip across all tracks
    seq.tracks.filter((t) => t.kind === 'audio').forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip.source.type !== 'audio') return;
        const asset = seq.audioAssets.find((a) => a.id === clip.source.refId);
        if (!asset) return;
        let el = audioElementsRef.current.get(clip.id);
        if (!el) {
          el = new Audio(asset.url);
          el.preload = 'auto';
          audioElementsRef.current.set(clip.id, el);
        }
        el.volume = gainById.get(clip.id) ?? 0;
        if (activeIds.has(clip.id) && playing) {
          const local = clip.inPoint + (time - clip.start);
          if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = Math.max(0, local);
          if (el.paused) void el.play().catch(() => undefined);
        } else if (!el.paused) {
          el.pause();
        }
      });
    });
  };
  syncSequenceAudioRef.current = syncSequenceAudio;

  const selectEditTarget = (kind: AnimEditKind, id: string) => {
    setEditKind(kind);
    setEditId(id);
    setSelectedTrackId(id);
    setEditPopupOpen(true);
    if (kind === 'mesh') {
      setSelectedMeshId(id);
      setLeftTab('meshes');
    } else if (kind === 'bone') {
      setSelectedBoneId(id);
      setLeftTab('bones');
    } else if (kind === 'camera') {
      setActiveCameraId(id);
      setLeftTab('cameras');
    } else if (kind === 'particle') {
      setSelectedParticleId(id);
      setLeftTab('particles');
    } else if (kind === 'light') {
      setLeftTab('lights');
    }
  };

  const clearEditSelection = () => {
    setEditId('');
    setSelectedTrackId('');
    setSelectedKeyframeId(null);
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
    const tc = transformControlsRef.current;
    if (tc) {
      tc.detach();
      tc.enabled = false;
      tc.visible = false;
      tc.getHelper().visible = false;
    }
  };

  const editTargets: AnimEditTarget[] = [
    ...meshes.map((m) => ({
      kind: 'mesh' as const,
      id: m.id,
      name: m.name,
      position: m.position,
      rotation: m.rotation,
      scale: m.scale,
    })),
    ...bones.map((b) => ({
      kind: 'bone' as const,
      id: b.id,
      name: b.name,
      position: b.position,
      rotation: b.rotation,
      scale: b.scale,
    })),
    ...cameras.map((c) => ({
      kind: 'camera' as const,
      id: c.id,
      name: c.name,
      position: c.position,
      rotation: c.rotation,
      scale: { x: 1, y: 1, z: 1 },
      fov: c.fov,
    })),
    ...particles.map((p) => ({
      kind: 'particle' as const,
      id: p.id,
      name: p.name,
      position: p.position,
      rotation: p.rotation,
      scale: p.shapeSize || { x: 1, y: 1, z: 1 },
      rate: p.rate,
      enabled: p.enabled,
    })),
    ...lights.map((L) => ({
      kind: 'light' as const,
      id: L.id,
      name: L.name,
      position: L.position,
      rotation: L.rotation,
      scale: L.scale,
    })),
  ];

  const activeEditTargetBase = editTargets.find((t) => t.kind === editKind && t.id === editId) || null;
  const activeEditTarget = (() => {
    if (!activeEditTargetBase) return null;
    const posed = resolvePosed(currentTime);
    if (editKind === 'mesh') {
      const m = posed.meshes.find((x) => x.id === editId);
      if (!m) return activeEditTargetBase;
      return { ...activeEditTargetBase, position: m.position, rotation: m.rotation, scale: m.scale };
    }
    if (editKind === 'bone') {
      const b = posed.bones.find((x) => x.id === editId);
      if (!b) return activeEditTargetBase;
      return { ...activeEditTargetBase, position: b.position, rotation: b.rotation, scale: b.scale };
    }
    if (editKind === 'camera') {
      const c = posed.cameras.find((x) => x.id === editId);
      if (!c) return activeEditTargetBase;
      return {
        ...activeEditTargetBase,
        position: c.position,
        rotation: c.rotation,
        scale: { x: 1, y: 1, z: 1 },
        fov: c.fov,
      };
    }
    return activeEditTargetBase;
  })();

  // Sync gizmo mode / visibility (pose follows live Three objects in syncViewportPose)
  useEffect(() => {
    const tc = transformControlsRef.current;
    if (!tc) return;
    tc.setMode(gizmoMode);
    const modalBusy = Boolean(modalTransformRef.current);
    const show = !cameraView && !!activeEditTarget && !modalBusy;
    tc.enabled = show;
    tc.visible = show;
    tc.getHelper().visible = show;
    if (!activeEditTarget) tc.detach();
    structureDirtyRef.current = true;
    lastPoseSyncTimeRef.current = -1;
  }, [activeEditTarget, gizmoMode, cameraView, currentTime, modalTransform]);

  // Live gizmo drag updates edges / light pose; CAD commit happens on pointer-up via commitGizmoTransform
  useEffect(() => {
    const tc = transformControlsRef.current;
    if (!tc) return;
    const onChange = () => {
      const obj = tc.object;
      if (!obj || !editId) return;
      if (editKind === 'mesh') {
        const entry = viewportMeshesRef.current.get(editId);
        if (entry?.edges) {
          entry.edges.position.copy(obj.position);
          entry.edges.rotation.copy(obj.rotation);
          entry.edges.scale.copy(obj.scale);
        }
      } else if (editKind === 'light') {
        const entry = viewportLightsRef.current.get(editId);
        if (!entry) return;
        entry.light.position.copy(obj.position);
        if (entry.light instanceof THREE.RectAreaLight) {
          entry.light.rotation.copy(obj.rotation);
        } else if (
          entry.light instanceof THREE.DirectionalLight
          || entry.light instanceof THREE.SpotLight
        ) {
          const dir = new THREE.Vector3(0, -1, 0).applyEuler(obj.rotation);
          entry.light.target.position.copy(obj.position).add(dir);
          entry.light.target.updateMatrixWorld();
        }
        if (entry.light instanceof THREE.RectAreaLight) {
          entry.light.width = Math.max(0.1, obj.scale.x * 2);
          entry.light.height = Math.max(0.1, obj.scale.y * 2);
        }
        if (entry.light instanceof THREE.PointLight || entry.light instanceof THREE.SpotLight) {
          entry.light.distance = Math.max(0.5, ((obj.scale.x + obj.scale.y + obj.scale.z) / 3) * 8);
        }
      }
    };
    tc.addEventListener('objectChange', onChange);
    return () => { tc.removeEventListener('objectChange', onChange); };
  }, [editId, editKind]);

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cameraView || !containerRef.current || !freeCamRef.current) return;
    if (e.button !== 0) return;
    if (transformControlsRef.current?.dragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, freeCamRef.current);

    // Don't clear / retarget when clicking the transform gizmo
    const helper = transformControlsRef.current?.getHelper();
    if (helper) {
      const gizmoHits = raycaster.intersectObject(helper, true);
      if (gizmoHits.length > 0) return;
    }

    const pickables: THREE.Object3D[] = [];
    [meshesGroupRef, camerasGroupRef, bonesGroupRef, particleMarkersRef].forEach((ref) => {
      if (ref.current) pickables.push(...ref.current.children);
    });
    viewportLightsRef.current.forEach((entry) => pickables.push(entry.helper));
    const hits = raycaster.intersectObjects(pickables, true);
    const hit = hits.find((h) => {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData?.animTarget && obj.userData?.targetId) return true;
        obj = obj.parent;
      }
      return false;
    });
    if (hit) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData?.animTarget && obj.userData?.targetId) {
          selectEditTarget(obj.userData.animTarget as AnimEditKind, obj.userData.targetId);
          e.stopPropagation();
          return;
        }
        obj = obj.parent;
      }
    } else if (!e.shiftKey && !e.ctrlKey) {
      // Click empty viewport → deselect (same as modeling modes)
      clearEditSelection();
      e.stopPropagation();
    }
  };

  const applyEditTransform = (partial: { position?: Vector3D; rotation?: Vector3D; scale?: Vector3D; fov?: number }) => {
    if (!editId) return;
    if (editKind === 'mesh') patchMesh(editId, partial);
    else if (editKind === 'bone') patchBone(editId, partial);
    else if (editKind === 'camera') {
      patchCamera(editId, {
        ...partial,
        ...(partial.position || partial.rotation ? { lookAt: null } : {}),
      });
    } else if (editKind === 'particle') {
      patchParticle(editId, {
        position: partial.position,
        rotation: partial.rotation,
        ...(partial.scale ? { shapeSize: partial.scale } : {}),
      });
    } else if (editKind === 'light') {
      const current = lights.find((x) => x.id === editId);
      const patch: Partial<CADLight> = { ...partial };
      if (partial.scale && current) {
        if (current.type === 'point' || current.type === 'spot') {
          patch.distance = Math.max(0.5, ((partial.scale.x + partial.scale.y + partial.scale.z) / 3) * 8);
        }
        if (current.type === 'area') {
          patch.width = Math.max(0.1, partial.scale.x * 2);
          patch.height = Math.max(0.1, partial.scale.y * 2);
        }
      }
      patchLight(editId, patch);
    }
  };

  const keyEditTargetNow = () => {
    if (!editId || editKind === 'particle') return;
    handleAddKeyframe('all', editId);
  };

  useEffect(() => {
    if (!isPlaying) {
      syncSequenceAudioRef.current(currentTimeRef.current, false);
    }
  }, [isPlaying]);

  const startResizeLeft = (e: React.PointerEvent) => {
    e.preventDefault();
    layoutResizingRef.current = true;
    const startX = e.clientX;
    const startW = leftPanelRef.current?.offsetWidth ?? leftWidth;
    let latest = startW;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(200, Math.min(480, startW + (ev.clientX - startX)));
      if (leftPanelRef.current) leftPanelRef.current.style.width = `${latest}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLeftWidth(latest);
      layoutResizingRef.current = false;
      // One crisp buffer sync after layout settles.
      requestAnimationFrame(() => syncRendererSizeRef.current());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResizeTimeline = (e: React.PointerEvent) => {
    e.preventDefault();
    layoutResizingRef.current = true;
    const startY = e.clientY;
    const startH = timelinePanelRef.current?.offsetHeight ?? timelineHeight;
    const maxH = getTimelineMaxHeight();
    let latest = startH;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(160, Math.min(maxH, startH - (ev.clientY - startY)));
      if (timelinePanelRef.current) timelinePanelRef.current.style.height = `${latest}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setTimelineHeight(latest);
      layoutResizingRef.current = false;
      requestAnimationFrame(() => syncRendererSizeRef.current());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const selectedBone = bones.find((b) => b.id === selectedBoneId) || bones[0];
  const selectedMesh = meshes.find((m) => m.id === selectedMeshId) || meshes[0];
  const selectedParticle =
    particles.find((p) => p.id === (editKind === 'particle' ? editId : selectedParticleId)) || particles[0] || null;

  const PanelHead = ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-[#9a9a9a]">{title}</span>
      {action}
    </div>
  );

  const Section = ({ label, children, right }: { label?: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="space-y-1">
      {(label || right) && (
        <div className="flex items-center justify-between gap-1 px-0.5">
          {label ? <span className="text-[8px] uppercase tracking-wider text-[#6e6e6e]">{label}</span> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  );

  const rowCls = (active: boolean, tone: 'blue' | 'orange' | 'teal' = 'blue') => {
    const tones = {
      blue: active ? 'bg-[#ed7300]/20 text-white' : 'text-[#a8a8a8] hover:bg-[#252525] hover:text-[#e8e8e8]',
      orange: active ? 'bg-[#e68619]/18 text-white' : 'text-[#a8a8a8] hover:bg-[#252525] hover:text-[#e8e8e8]',
      teal: active ? 'bg-[#2d9d78]/20 text-white' : 'text-[#a8a8a8] hover:bg-[#252525] hover:text-[#e8e8e8]',
    };
    return `w-full h-6 px-1.5 rounded flex items-center gap-1.5 text-left text-[10px] ${tones[tone]}`;
  };

  const chipCls = (active: boolean) =>
    `h-6 px-1.5 rounded text-[9px] font-medium border transition-colors ${
      active
        ? 'border-[#ed7300] bg-[#ed7300]/20 text-white'
        : 'border-[#1a1a1a] bg-[#1a1a1a] text-[#9a9a9a] hover:border-[#4d4d4d] hover:text-[#d0d0d0]'
    }`;

  const miniBtn = 'h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] text-[#b0b0b0] hover:border-[#4d4d4d] hover:text-white disabled:opacity-40 inline-flex items-center justify-center gap-1';
  const primaryBtn = (color: string) =>
    `w-full h-6 rounded text-[9px] font-semibold text-white inline-flex items-center justify-center gap-1 ${color}`;

  const Vec3Fields = ({
    label,
    value,
    onChange,
    step = 0.1,
  }: {
    label: string;
    value: Vector3D;
    onChange: (next: Vector3D) => void;
    step?: number;
  }) => (
    <div className="space-y-0.5">
      <div className="text-[8px] uppercase tracking-wider text-[#6e6e6e]">{label}</div>
      <div className="grid grid-cols-3 gap-0.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label key={axis} className="flex items-center gap-0.5 h-6 rounded bg-[#262626] border border-[#1a1a1a] px-1">
            <span className="text-[8px] text-[#5a5a5a] uppercase">{axis}</span>
            <input
              type="number"
              step={step}
              className="w-full min-w-0 bg-transparent outline-none text-right text-[10px] text-[#d8d8d8]"
              value={Number(value[axis].toFixed(3))}
              onChange={(e) => onChange({ ...value, [axis]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </div>
  );

  const leftTabs: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
    { id: 'outliner', label: 'Tree', icon: <Layers className="w-3 h-3" /> },
    { id: 'clips', label: 'Clips', icon: <Film className="w-3 h-3" /> },
    { id: 'cameras', label: 'Cams', icon: <Camera className="w-3 h-3" /> },
    { id: 'lights', label: 'Lights', icon: <Lightbulb className="w-3 h-3" /> },
    { id: 'bones', label: 'Bones', icon: <Bone className="w-3 h-3" /> },
    { id: 'meshes', label: 'Mesh', icon: <Box className="w-3 h-3" /> },
    { id: 'particles', label: 'FX', icon: <Sparkles className="w-3 h-3" /> },
    { id: 'weather', label: 'Sky', icon: <CloudRain className="w-3 h-3" /> },
  ];

  const boneChildrenOf = (parentId: string | null) =>
    bones.filter((b) => (b.parentId || null) === parentId);

  const boneMatchesQuery = (bone: CADBone, q: string): boolean => {
    if (!q) return true;
    if (bone.name.toLowerCase().includes(q)) return true;
    return boneChildrenOf(bone.id).some((child) => boneMatchesQuery(child, q));
  };

  const toggleBoneCollapse = (boneId: string) => {
    setCollapsedBones((prev) => ({ ...prev, [boneId]: !prev[boneId] }));
  };

  const expandAllBones = () => setCollapsedBones({});
  const collapseAllBones = () => {
    const next: Record<string, boolean> = {};
    bones.forEach((b) => {
      if (boneChildrenOf(b.id).length) next[b.id] = true;
    });
    setCollapsedBones(next);
  };

  const renderBoneTree = (parentId: string | null, depth = 0): React.ReactNode => {
    const q = outlinerQuery.trim().toLowerCase();
    return boneChildrenOf(parentId)
      .filter((bone) => boneMatchesQuery(bone, q))
      .map((bone) => {
        const kids = boneChildrenOf(bone.id);
        const hasKids = kids.length > 0;
        const collapsed = !!collapsedBones[bone.id];
        const active = bone.id === selectedBone?.id || (editKind === 'bone' && editId === bone.id);
        return (
          <div key={bone.id}>
            <div
              className={`group flex items-center h-5.5 min-h-[22px] rounded ${
                active ? 'bg-[#ed7300]/18 text-white' : 'text-[#a0a0a0] hover:bg-[#222] hover:text-[#e4e4e4]'
              }`}
              style={{ paddingLeft: 2 + depth * 10 }}
            >
              <button
                type="button"
                className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center ${hasKids ? 'text-[#666]' : 'opacity-0 pointer-events-none'}`}
                onClick={(e) => { e.stopPropagation(); toggleBoneCollapse(bone.id); }}
              >
                {collapsed ? <ChevronRight className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
              </button>
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-1 text-left h-full pr-1"
                onClick={() => selectEditTarget('bone', bone.id)}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: bone.color || '#ed7300' }} />
                <span className="truncate text-[10px]">{bone.name}</span>
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-[#666] hover:text-[#ed7300]"
                title="Key bone"
                onClick={(e) => { e.stopPropagation(); handleAddKeyframe('all', bone.id); }}
              >
                <Key className="w-2.5 h-2.5" />
              </button>
            </div>
            {hasKids && !collapsed && renderBoneTree(bone.id, depth + 1)}
          </div>
        );
      });
  };

  useEffect(() => {
    if (!viewMenuOpen && !toolsMenuOpen && !fxMenuOpen) return;
    const close = () => {
      setViewMenuOpen(false);
      setToolsMenuOpen(false);
      setFxMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [viewMenuOpen, toolsMenuOpen, fxMenuOpen]);

  return (
    <div ref={layoutRootRef} className="flex flex-col h-full w-full bg-[#2b2b2b] text-[#e0e0e0] font-sans select-none overflow-hidden">
      {/* Top toolbar — hidden in focus/enlarge mode */}
      {!focusPlayback && (
      <div className="h-9 shrink-0 bg-[#262626] border-b border-[#4d4d4d] px-2 flex items-center gap-2 text-[10px] font-mono z-20">
        <div className="flex items-center gap-1.5 bg-[#0f0f0f] px-2 py-0.5 rounded border border-[#1a1a1a] shrink-0">
          <Layers className="w-3.5 h-3.5 text-[#e68619]" />
          {scenes.length > 1 && setActiveSceneId && activeSceneId ? (
            <select
              value={activeSceneId}
              onChange={(e) => setActiveSceneId(e.target.value)}
              className="bg-transparent font-mono text-[10px] text-[#e68619] font-bold outline-none cursor-pointer max-w-[180px]"
              title="Active scene"
            >
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id} className="bg-[#262626] text-[#e68619]">
                  {scene.name} ({scene.meshCount} objects)
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[#e68619] font-bold whitespace-nowrap">
              {sceneName} ({meshes.length} object{meshes.length === 1 ? '' : 's'})
            </span>
          )}
        </div>

        <div className="h-4 w-px bg-[#1a1a1a] shrink-0" />

        <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] text-[#b8b8b8] hover:text-white hover:border-[#1a1a1a] inline-flex items-center gap-1" onClick={() => setLeftCollapsed((v) => !v)} title="Toggle tools panel">
          {leftCollapsed ? <PanelLeft className="w-3 h-3" /> : <PanelLeftClose className="w-3 h-3" />}
          Tools
        </button>
        <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] text-[#b8b8b8] hover:text-white hover:border-[#1a1a1a] inline-flex items-center gap-1" onClick={() => setTimelineCollapsed((v) => !v)} title="Toggle timeline">
          <ChevronsDownUp className="w-3 h-3" />
          Timeline
        </button>

        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className={`h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] inline-flex items-center gap-1 ${viewMenuOpen ? 'text-[#ed7300] border-[#ed7300]/40' : 'text-[#b8b8b8] hover:text-white'}`} onClick={() => { setViewMenuOpen((v) => !v); setToolsMenuOpen(false); }}>
            <Eye className="w-3 h-3" /> View
          </button>
          {viewMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] py-1 rounded border border-[#4d4d4d] bg-[#2a2a2a] shadow-xl text-[10px]">
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setCameraView(true); setViewMenuOpen(false); }}>Camera View</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setCameraView(false); setViewMenuOpen(false); }}>Free Orbit (edit)</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setShowBones((v) => !v); setViewMenuOpen(false); }}>{showBones ? 'Hide Bones' : 'Show Bones'}</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setShowLightwaveTools((v) => !v); setViewMenuOpen(false); }}>{showLightwaveTools ? 'Hide LightWave Tools' : 'Show LightWave Tools'}</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { enterFocusPlayback(); setViewMenuOpen(false); }}>Enlarge Viewport (Shift+F)</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { maximizeTimelineEditor(); setViewMenuOpen(false); }}>Maximize Timeline / Dope (Shift+T)</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { applyTimelineHeight(320); setViewMenuOpen(false); }}>Comfortable Timeline</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setEditPopupOpen(true); setViewMenuOpen(false); }}>Show Anim Edit Popup</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setLeftCollapsed(false); setViewMenuOpen(false); }}>Show Tools Panel</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { applyTimelineHeight(300); setViewMenuOpen(false); }}>Show Timeline</button>
            </div>
          )}
        </div>

        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className={`h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] inline-flex items-center gap-1 ${toolsMenuOpen ? 'text-[#e68619] border-[#e68619]/40' : 'text-[#b8b8b8] hover:text-white'}`} onClick={() => { setToolsMenuOpen((v) => !v); setViewMenuOpen(false); }}>
            <Settings2 className="w-3 h-3" /> Animate
          </button>
          {toolsMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] py-1 rounded border border-[#4d4d4d] bg-[#2a2a2a] shadow-xl text-[10px]">
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { animationTargets.forEach((t) => handleAddTrack(t.id)); setToolsMenuOpen(false); }}>Add All Tracks</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { handleAddKeyframe('all'); setToolsMenuOpen(false); }}>Key Selected (+ ALL)</button>
              <div className="border-t border-[#4d4d4d] my-1" />
              <div className="px-3 py-1 text-[8px] uppercase tracking-wider text-[#8c8c8c] font-bold">UV & Character Dialog</div>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d] text-emerald-400 font-semibold flex items-center justify-between"
                onClick={() => {
                  if (activeMeshId) {
                    const selMesh = meshes.find((m) => m.id === activeMeshId);
                    const talkClip = selMesh?.textureAnimation?.clips?.find((c) => c.name.toLowerCase().includes('talk'))?.id || 'talk';
                    const t = Math.round(currentTime * 100) / 100;
                    if (activeClip) {
                      setClips((prev) => prev.map((c) => (c.id === activeClip.id ? insertTextureClipKey(c, activeMeshId, t, talkClip) : c)));
                    }
                  }
                  setToolsMenuOpen(false);
                }}
              >
                <span>Trigger Talk UV Clip</span>
                <span className="text-[8px] opacity-60">Mouth</span>
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d] text-cyan-400 font-semibold flex items-center justify-between"
                onClick={() => {
                  if (activeMeshId) {
                    const selMesh = meshes.find((m) => m.id === activeMeshId);
                    const blinkClip = selMesh?.textureAnimation?.clips?.find((c) => c.name.toLowerCase().includes('blink'))?.id || 'blink';
                    const t = Math.round(currentTime * 100) / 100;
                    if (activeClip) {
                      setClips((prev) => prev.map((c) => (c.id === activeClip.id ? insertTextureClipKey(c, activeMeshId, t, blinkClip) : c)));
                    }
                  }
                  setToolsMenuOpen(false);
                }}
              >
                <span>Trigger Blink Loop</span>
                <span className="text-[8px] opacity-60">Eyes</span>
              </button>
              <div className="border-t border-[#4d4d4d] my-1" />
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setAutoKey((v) => !v); setToolsMenuOpen(false); }}>{autoKey ? 'Disable' : 'Enable'} Auto-Key</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { addParticleEffect(); setToolsMenuOpen(false); }}>Add Custom Particle…</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setLeftTab('particles'); setLeftCollapsed(false); setToolsMenuOpen(false); }}>Open FX / Effects Panel</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setEnvModalOpen(true); setToolsMenuOpen(false); }}>Environment Settings…</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setLeftTab('outliner'); setLeftCollapsed(false); setToolsMenuOpen(false); }}>Open Outliner Tree</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setLeftTab('bones'); setLeftCollapsed(false); setToolsMenuOpen(false); }}>Edit Bones</button>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]" onClick={() => { setLeftTab('cameras'); setLeftCollapsed(false); setToolsMenuOpen(false); }}>Edit Cameras</button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] font-bold inline-flex items-center gap-1 ${autoKey ? 'border-[#e68619]/50 bg-[#e68619]/15 text-[#e68619]' : 'border-[#1a1a1a] text-[#8c8c8c]'}`}
          onClick={() => setAutoKey((v) => !v)}
          title="When on, changing transforms inserts keys at the playhead"
        >
          <Key className="w-3 h-3" />
          Auto-Key
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] inline-flex items-center gap-1 ${showBones ? 'border-[#ed7300]/40 text-[#6a9fd8]' : 'border-[#1a1a1a] text-[#666]'}`}
          title="Show / hide bone markers"
          onClick={() => setShowBones((v) => !v)}
        >
          <Bone className="w-3 h-3" />
          {showBones ? 'Bones' : 'Bones Off'}
        </button>

        <button
          type="button"
          className="h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] text-[#e68619] hover:border-[#e68619]/40 inline-flex items-center gap-1"
          title="Add particles & effects"
          onClick={() => { setLeftTab('particles'); setLeftCollapsed(false); }}
        >
          <Sparkles className="w-3 h-3" /> FX
        </button>

        <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] inline-flex items-center gap-1 ${fxMenuOpen ? 'text-[#e68619] border-[#e68619]/40' : 'text-[#b8b8b8] hover:text-white'}`}
            title="Quick-add particle effect"
            onClick={() => { setFxMenuOpen((v) => !v); setViewMenuOpen(false); setToolsMenuOpen(false); }}
          >
            <Plus className="w-3 h-3" /> Effect
          </button>
          {fxMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] py-1 rounded border border-[#4d4d4d] bg-[#2a2a2a] shadow-xl text-[10px]">
              {PARTICLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d]"
                  title={preset.hint}
                  onClick={() => { addParticleEffect(preset.id); setFxMenuOpen(false); }}
                >
                  {preset.label}
                </button>
              ))}
              <div className="border-t border-[#4d4d4d] my-1" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-[#4d4d4d] text-[#e68619]"
                onClick={() => { addParticleEffect(); setFxMenuOpen(false); }}
              >
                Custom Particle Studio…
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] inline-flex items-center gap-1 ${envModalOpen ? 'border-[#6a9fd8]/50 text-[#6a9fd8]' : 'border-[#1a1a1a] text-[#b8b8b8] hover:text-white'}`}
          title="Environment settings"
          onClick={() => setEnvModalOpen(true)}
        >
          <CloudRain className="w-3 h-3" /> Env
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] inline-flex items-center gap-1 ${
            litPreview
              ? 'border-[#f1c40f]/60 bg-[#f1c40f]/18 text-[#f1c40f]'
              : 'border-[#1a1a1a] bg-[#1a1a1a] text-[#b8b8b8] hover:text-white'
          }`}
          title="Cinematic mode — only scene lights (Key/Fill/…). Studio fill off. Zero lights = pitch black."
          onClick={() => {
            setLitPreview((v) => {
              const next = !v;
              if (next) {
                setLeftTab('lights');
                setShowLightHelpers(false);
                setEnvironment((prev) => ({
                  ...prev,
                  backgroundMode: 'solid',
                  backgroundColor: prev.backgroundColor || '#000000',
                }));
              } else {
                setShowLightHelpers(true);
              }
              return next;
            });
          }}
        >
          <Aperture className="w-3 h-3" />
          Cinematic
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] inline-flex items-center gap-1 ${
            showLightHelpers
              ? 'border-[#ed7300]/50 bg-[#ed7300]/15 text-[#6ec8ff]'
              : 'border-[#1a1a1a] bg-[#1a1a1a] text-[#8c8c8c] hover:text-white'
          }`}
          title="Show / hide light gizmos in the viewport"
          onClick={() => setShowLightHelpers((v) => !v)}
        >
          <Lightbulb className="w-3 h-3" />
          Lamps {showLightHelpers ? 'On' : 'Off'}
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] inline-flex items-center gap-1 ${editPopupOpen ? 'text-[#ed7300] border-[#ed7300]/40' : 'text-[#b8b8b8] hover:text-white'}`}
          onClick={() => setEditPopupOpen((v) => !v)}
          title="Transform editor popup"
        >
          <SlidersHorizontal className="w-3 h-3" />
          Edit
        </button>

        <button
          type="button"
          className={`h-6 px-1.5 rounded border text-[9px] inline-flex items-center gap-1 ${
            showLightwaveTools
              ? 'border-[#ed7300]/50 bg-[#ed7300]/15 text-[#6ec8ff]'
              : 'border-[#1a1a1a] bg-[#1a1a1a] text-[#8c8c8c] hover:text-white'
          }`}
          title="Show / hide LightWave move · orbit · zoom tools"
          onClick={() => setShowLightwaveTools((v) => !v)}
        >
          <Crosshair className="w-3 h-3" />
          LW {showLightwaveTools ? 'On' : 'Off'}
        </button>

        <button
          type="button"
          className="h-6 px-1.5 rounded border border-[#e68619]/50 bg-[#e68619]/15 text-[#e68619] text-[9px] font-bold inline-flex items-center gap-1 hover:bg-[#e68619]/25"
          title="Enlarge viewport — hide tools & timeline (Shift+F). Esc to restore."
          onClick={enterFocusPlayback}
        >
          <Maximize2 className="w-3 h-3" />
          Enlarge
        </button>

        <div className="flex bg-[#2b2b2b] p-0.5 rounded border border-[#1a1a1a]">
          {([
            { id: 'translate' as const, icon: <Move className="w-3 h-3" />, title: 'Move (G)' },
            { id: 'rotate' as const, icon: <RotateCw className="w-3 h-3" />, title: 'Rotate (R)' },
            { id: 'scale' as const, icon: <Maximize2 className="w-3 h-3" />, title: 'Scale (S)' },
          ]).map((mode) => (
            <button
              key={mode.id}
              type="button"
              title={mode.title}
              className={`h-5 w-6 flex items-center justify-center rounded ${gizmoMode === mode.id ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c] hover:text-white'}`}
              onClick={() => { setGizmoMode(mode.id); setCameraView(false); setEditPopupOpen(true); setModalTransform(null); }}
            >
              {mode.icon}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-[#8c8c8c]">
          <span ref={(el) => { timeLabelElsRef.current[0] = el; }}>{currentTime.toFixed(2)}s / {(activeClip?.duration || 0).toFixed(2)}s</span>
          <button type="button" className={`h-6 px-1.5 rounded border border-[#1a1a1a] bg-[#1a1a1a] text-[9px] inline-flex items-center gap-1 ${cameraView ? 'text-[#ed7300] border-[#ed7300]/40' : 'text-[#b8b8b8] hover:text-white'}`} onClick={() => setCameraView((v) => !v)}>
            {cameraView ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {cameraView ? 'Camera' : 'Orbit'}
          </button>
        </div>
      </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left tools — resizable, tabbed, scrollable */}
        {!leftCollapsed && !focusPlayback && (
          <>
            <aside
              ref={(el) => { leftPanelRef.current = el; }}
              style={{ width: leftWidth }}
              className="shrink-0 bg-[#2a2a2a] border-r border-[#1a1a1a] flex flex-col text-[10px] font-mono min-w-0"
            >
              <div className="flex border-b border-[#1a1a1a] overflow-x-auto custom-scrollbar shrink-0 bg-[#262626]">
                {leftTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLeftTab(tab.id)}
                    title={tab.label}
                    className={`h-7 px-2 shrink-0 flex items-center gap-1 border-b text-[9px] ${
                      leftTab === tab.id
                        ? 'border-[#ed7300] text-white bg-[#333333]'
                        : 'border-transparent text-[#7a7a7a] hover:text-[#c8c8c8]'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
                <button
                  type="button"
                  title="Environment settings"
                  onClick={() => setEnvModalOpen(true)}
                  className={`h-7 px-2 shrink-0 flex items-center gap-1 border-b text-[9px] ${
                    envModalOpen
                      ? 'border-[#6a9fd8] text-[#6a9fd8] bg-[#333333]'
                      : 'border-transparent text-[#7a7a7a] hover:text-[#c8c8c8]'
                  }`}
                >
                  <CloudRain className="w-3 h-3" />
                  Env
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2.5">
                {leftTab === 'outliner' && (
                  <>
                    <PanelHead
                      title="Outliner"
                      action={<span className="text-[8px] text-[#555]">{meshes.length}m · {bones.length}b</span>}
                    />
                    <input
                      value={outlinerQuery}
                      onChange={(e) => setOutlinerQuery(e.target.value)}
                      placeholder="Filter…"
                      className="w-full h-6 px-2 rounded bg-[#3a3a3a] border border-[#1a1a1a] text-[10px] outline-none focus:border-[#ed7300]"
                    />
                    <Section label="Meshes">
                      <div className="space-y-0.5">
                        {meshes
                          .filter((m) => !outlinerQuery.trim() || m.name.toLowerCase().includes(outlinerQuery.trim().toLowerCase()))
                          .map((mesh) => (
                            <button
                              key={mesh.id}
                              type="button"
                              onClick={() => selectEditTarget('mesh', mesh.id)}
                              className={rowCls(mesh.id === selectedMesh?.id || (editKind === 'mesh' && editId === mesh.id), 'orange')}
                            >
                              <Box className="w-3 h-3 text-[#e68619] shrink-0" />
                              <span className="truncate">{mesh.name}</span>
                            </button>
                          ))}
                        {!meshes.length && <div className="text-[9px] text-[#555] px-1 py-2">No meshes</div>}
                      </div>
                    </Section>
                    <Section
                      label="Skeleton"
                      right={(
                        <div className="flex gap-0.5">
                          <button type="button" className={miniBtn} onClick={expandAllBones}>+</button>
                          <button type="button" className={miniBtn} onClick={collapseAllBones}>−</button>
                        </div>
                      )}
                    >
                      <div className="rounded bg-[#3a3a3a] border border-[#242424] p-0.5 max-h-[46vh] overflow-y-auto custom-scrollbar">
                        {bones.length ? renderBoneTree(null) : (
                          <div className="text-[9px] text-[#555] px-2 py-3 text-center">No skeleton yet</div>
                        )}
                      </div>
                    </Section>
                    {selectedBone && (
                      <Section label={selectedBone.name}>
                        <div className="text-[8px] text-[#555] mb-1">
                          {bones.find((b) => b.id === selectedBone.parentId)?.name || 'Root'}
                        </div>
                        <div className="space-y-1.5">
                          <Vec3Fields label="Position" value={selectedBone.position} onChange={(position) => patchBone(selectedBone.id, { position })} />
                          <Vec3Fields label="Rotation" value={selectedBone.rotation} onChange={(rotation) => patchBone(selectedBone.id, { rotation })} step={0.05} />
                          <button type="button" className={primaryBtn('bg-[#ed7300] hover:bg-[#3a8ef0]')} onClick={() => handleAddKeyframe('all', selectedBone.id)}>
                            <Key className="w-3 h-3" /> Key
                          </button>
                        </div>
                      </Section>
                    )}
                  </>
                )}

                {leftTab === 'clips' && (
                  <>
                    <PanelHead
                      title="Clips"
                      action={(
                        <button type="button" className={miniBtn} onClick={() => {
                          const clip = createDefaultClip(meshes, bones, `Shot ${clips.length + 1}`);
                          setClips((prev) => [...prev, clip]);
                          setActiveClipId(clip.id);
                        }}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    />
                    <div className="space-y-0.5">
                      {clips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => { setActiveClipId(clip.id); setCurrentTime(0); }}
                          className={rowCls(clip.id === activeClip?.id)}
                        >
                          <Film className="w-3 h-3 text-[#ed7300] shrink-0" />
                          <span className="truncate flex-1">{clip.name}</span>
                          <span className="text-[8px] text-[#555]">{clip.duration}s</span>
                        </button>
                      ))}
                    </div>
                      {activeClip && (
                        <Section label="Active">
                          <div className="flex items-center justify-between gap-2 h-7 text-[9px] text-[#888]">
                            Duration
                            <LengthField
                              value={activeClip.duration}
                              snapStep={0.1}
                              onChange={setActiveClipDuration}
                            />
                          </div>
                          <button type="button" className={`${miniBtn} w-full mt-1`} onClick={() => animationTargets.forEach((t) => handleAddTrack(t.id))}>
                            Ensure tracks
                          </button>
                        </Section>
                      )}
                  </>
                )}

                {leftTab === 'cameras' && (
                  <>
                    <PanelHead
                      title="Cameras"
                      action={(
                        <button type="button" className={miniBtn} onClick={() => {
                          const cam = createCamera(`Cam ${cameras.length + 1}`);
                          setCameras((prev) => [...prev, cam]);
                          setActiveCameraId(cam.id);
                          handleAddTrack(cam.id);
                          selectEditTarget('camera', cam.id);
                        }}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    />
                    <div className="space-y-0.5">
                      {cameras.map((cam) => (
                        <button key={cam.id} type="button" onClick={() => selectEditTarget('camera', cam.id)} className={rowCls(cam.id === activeCamera?.id)}>
                          <Camera className="w-3 h-3 text-[#ed7300] shrink-0" />
                          <span className="truncate flex-1">{cam.name}</span>
                          <span className="text-[8px] text-[#555]">{cam.fov}°</span>
                        </button>
                      ))}
                    </div>
                    {activeCamera && (
                      <Section label="Transform">
                        <label className="flex items-center gap-2 min-h-[22px] text-[9px] text-[#888] mb-1.5">
                          FOV
                          <SmoothSlider
                            min={20}
                            max={90}
                            step={1}
                            value={activeCamera.fov}
                            onLiveChange={(fov) => liveCameraFov(activeCamera.id, fov)}
                            onChange={(fov) => commitCameraFov(activeCamera.id, fov)}
                            formatValue={(v) => `${Math.round(v)}`}
                          />
                        </label>
                        <div className="space-y-1.5">
                          <Vec3Fields label="Position" value={activeCamera.position} onChange={(position) => patchCamera(activeCamera.id, { position, lookAt: null })} />
                          <Vec3Fields label="Rotation" value={activeCamera.rotation} onChange={(rotation) => patchCamera(activeCamera.id, { rotation, lookAt: null })} step={0.05} />
                        </div>
                        <div className="grid grid-cols-2 gap-1 mt-1.5">
                          <button type="button" className={miniBtn} onClick={() => { setCameraView(false); setGizmoMode('translate'); selectEditTarget('camera', activeCamera.id); }}>
                            <Move className="w-3 h-3" /> Move
                          </button>
                          <button type="button" className={primaryBtn('bg-[#ed7300] hover:bg-[#ed7300]')} onClick={() => handleAddKeyframe('all', activeCamera.id)}>
                            <Key className="w-3 h-3" /> Key
                          </button>
                        </div>
                      </Section>
                    )}
                  </>
                )}

                {leftTab === 'bones' && (
                  <>
                    <PanelHead title="Skeleton" />
                    <Section label="Presets">
                      <div className="grid grid-cols-4 gap-0.5">
                        {SKELETON_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            title={preset.description}
                            className={chipCls(false)}
                            onClick={() => applyPresetInStudio(preset.id)}
                          >
                            {preset.label.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`${miniBtn} w-full mt-1 text-[#c45c5c]`}
                        disabled={!bones.length}
                        onClick={() => {
                          if (!window.confirm('Remove skeleton? Mesh is kept.')) return;
                          setBones([]);
                          setSelectedBoneId('');
                          setProcAnimId(null);
                          if (skinTarget) setMeshes((c) => c.map((m) => m.id === skinTarget.id ? unbindSkin(m) : m));
                        }}
                      >
                        Remove
                      </button>
                    </Section>
                    <Section label={`Bind · ${skinTarget?.name || '—'}`}>
                      <div className="grid grid-cols-2 gap-0.5">
                        <button
                          type="button"
                          disabled={!skinTarget || !bones.length}
                          className={chipCls(isBound)}
                          onClick={() => {
                            if (!skinTarget) return;
                            setMeshes((c) => c.map((m) => m.id === skinTarget.id ? bindSkinToSkeleton(m, bones) : m));
                          }}
                        >
                          Bind ON
                        </button>
                        <button
                          type="button"
                          disabled={!skinTarget}
                          className={chipCls(!isBound)}
                          onClick={() => {
                            if (!skinTarget) return;
                            setMeshes((c) => c.map((m) => m.id === skinTarget.id ? unbindSkin(m) : m));
                            setBones((b) => resetPoseToRest(b));
                          }}
                        >
                          Bind OFF
                        </button>
                      </div>
                    </Section>
                    <Section label="Procedural">
                      <select
                        className="w-full h-6 px-1.5 rounded bg-[#3a3a3a] border border-[#1a1a1a] text-[10px] outline-none"
                        value={procAnimId || ''}
                        onChange={(e) => setProcAnimId((e.target.value || null) as ProcAnimId | null)}
                      >
                        <option value="">Off</option>
                        {(procOptions.length ? procOptions : PROC_ANIMATIONS).map((anim) => (
                          <option key={anim.id} value={anim.id}>{anim.label}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 mt-1 text-[9px] text-[#777]">
                        Speed
                        <SmoothSlider
                          min={0.1}
                          max={3}
                          step={0.05}
                          value={procSpeed}
                          onChange={setProcSpeed}
                          accent="#ed7300"
                        />
                        <span className="w-7 text-right text-white">{procSpeed.toFixed(1)}×</span>
                      </label>
                    </Section>
                    <Section
                      label="Hierarchy"
                      right={(
                        <div className="flex gap-0.5">
                          <button type="button" className={miniBtn} onClick={expandAllBones}>+</button>
                          <button type="button" className={miniBtn} onClick={collapseAllBones}>−</button>
                        </div>
                      )}
                    >
                      <div className="rounded bg-[#3a3a3a] border border-[#242424] p-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                        {bones.length ? renderBoneTree(null) : (
                          <div className="text-[9px] text-[#555] px-2 py-2 text-center">Apply a preset</div>
                        )}
                      </div>
                    </Section>
                    {selectedBone && (
                      <Section label={selectedBone.name}>
                        <div className="space-y-1.5">
                          <Vec3Fields label="Position" value={selectedBone.position} onChange={(position) => patchBone(selectedBone.id, { position })} />
                          <Vec3Fields label="Rotation" value={selectedBone.rotation} onChange={(rotation) => patchBone(selectedBone.id, { rotation })} step={0.05} />
                          <Vec3Fields label="Scale" value={selectedBone.scale} onChange={(scale) => patchBone(selectedBone.id, { scale })} />
                          <button type="button" className={primaryBtn('bg-[#ed7300] hover:bg-[#3a8ef0]')} onClick={() => handleAddKeyframe('all', selectedBone.id)}>
                            <Key className="w-3 h-3" /> Key
                          </button>
                        </div>
                      </Section>
                    )}
                  </>
                )}

                {leftTab === 'meshes' && (
                  <>
                    <PanelHead title="Meshes" />
                    <div className="space-y-0.5">
                      {meshes.map((mesh) => (
                        <button key={mesh.id} type="button" onClick={() => selectEditTarget('mesh', mesh.id)} className={rowCls(mesh.id === selectedMesh?.id, 'orange')}>
                          <Box className="w-3 h-3 text-[#e68619] shrink-0" />
                          <span className="truncate">{mesh.name}</span>
                        </button>
                      ))}
                    </div>
                    {selectedMesh && (
                      <Section label="Transform">
                        <div className="space-y-1.5">
                          <Vec3Fields label="Position" value={selectedMesh.position} onChange={(position) => patchMesh(selectedMesh.id, { position })} />
                          <Vec3Fields label="Rotation" value={selectedMesh.rotation} onChange={(rotation) => patchMesh(selectedMesh.id, { rotation })} step={0.05} />
                          <Vec3Fields label="Scale" value={selectedMesh.scale} onChange={(scale) => patchMesh(selectedMesh.id, { scale })} />
                          <button type="button" className={primaryBtn('bg-[#e68619] hover:bg-[#f0942e]')} onClick={() => handleAddKeyframe('all', selectedMesh.id)}>
                            <Key className="w-3 h-3" /> Key
                          </button>
                        </div>
                      </Section>
                    )}
                  </>
                )}

                {leftTab === 'particles' && (
                  <>
                    <PanelHead
                      title="Effects"
                      action={(
                        <button type="button" className={miniBtn} onClick={() => addParticleEffect()} title="Custom particle">
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    />
                    <Section label="Presets">
                      <div className="grid grid-cols-4 gap-0.5">
                        {PARTICLE_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            title={preset.hint}
                            className={chipCls(false)}
                            onClick={() => addParticleEffect(preset.id)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </Section>
                    <Section label={`Emitters · ${particles.length}`}>
                      <div className="space-y-0.5">
                        {particles.map((p) => {
                          const active = p.id === selectedParticleId || (editKind === 'particle' && editId === p.id);
                          return (
                            <div key={p.id} className={`rounded px-1 py-0.5 ${active ? 'bg-[#e68619]/12' : ''}`}>
                              <div className="flex items-center gap-1">
                                <button type="button" className="flex-1 min-w-0 h-6 flex items-center gap-1.5 text-left text-[10px] text-[#c8c8c8]" onClick={() => selectEditTarget('particle', p.id)}>
                                  <Sparkles className="w-3 h-3 text-[#e68619] shrink-0" />
                                  <span className="truncate">{p.name}</span>
                                  {!p.enabled && <span className="text-[8px] text-[#666]">off</span>}
                                </button>
                                <button type="button" className={miniBtn} onClick={() => { setEditingParticle(p); setParticleModalOpen(true); }}>Edit</button>
                                <button type="button" className={miniBtn} onClick={() => patchParticle(p.id, { enabled: !p.enabled })}>{p.enabled ? 'On' : 'Off'}</button>
                                <button type="button" className={`${miniBtn} text-[#c45c5c]`} onClick={() => removeParticle(p.id)}><Trash2 className="w-3 h-3" /></button>
                              </div>
                            </div>
                          );
                        })}
                        {!particles.length && <div className="text-[9px] text-[#555] px-1 py-2">Add a preset above</div>}
                      </div>
                    </Section>
                    {selectedParticle && (
                      <Section label={selectedParticle.name}>
                        <div className="space-y-1.5">
                          <Vec3Fields label="Position" value={selectedParticle.position} onChange={(position) => { patchParticle(selectedParticle.id, { position }); selectEditTarget('particle', selectedParticle.id); }} />
                          <Vec3Fields label="Rotation" value={selectedParticle.rotation} onChange={(rotation) => patchParticle(selectedParticle.id, { rotation })} step={0.05} />
                          <div className="grid grid-cols-2 gap-0.5">
                            <label className="flex items-center gap-1 h-6 px-1.5 rounded bg-[#262626] border border-[#1a1a1a] text-[8px] text-[#666]">
                              Start
                              <input type="number" step={0.1} className="w-full bg-transparent outline-none text-right text-[10px] text-[#d8d8d8]"
                                value={selectedParticle.emitStart ?? 0}
                                onChange={(e) => patchParticle(selectedParticle.id, { emitStart: Number(e.target.value) })} />
                            </label>
                            <label className="flex items-center gap-1 h-6 px-1.5 rounded bg-[#262626] border border-[#1a1a1a] text-[8px] text-[#666]">
                              End
                              <input type="number" step={0.1} className="w-full bg-transparent outline-none text-right text-[10px] text-[#d8d8d8]"
                                value={selectedParticle.emitEnd ?? 999}
                                onChange={(e) => patchParticle(selectedParticle.id, { emitEnd: Number(e.target.value) })} />
                            </label>
                          </div>
                          <button type="button" className={`${miniBtn} w-full`} onClick={() => { setEditingParticle(selectedParticle); setParticleModalOpen(true); }}>
                            Particle Studio
                          </button>
                        </div>
                      </Section>
                    )}
                    <Section label="Weather">
                      <div className="grid grid-cols-3 gap-0.5">
                        {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
                          <button key={w} type="button" onClick={() => applyWeather(w)} className={`${chipCls(environment.weather === w)} capitalize`}>
                            {w}
                          </button>
                        ))}
                      </div>
                    </Section>
                  </>
                )}

                {leftTab === 'lights' && (
                  <>
                    <PanelHead
                      title="Lights"
                      action={(
                        <div className="flex gap-0.5 flex-wrap justify-end">
                          {([
                            ['point', 'Point'],
                            ['directional', 'Sun'],
                            ['spot', 'Spot'],
                            ['area', 'Area'],
                            ['ambient', 'Amb'],
                          ] as [CADLightType, string][]).map(([type, label]) => (
                            <button
                              key={type}
                              type="button"
                              className={miniBtn}
                              title={`Add ${CAD_LIGHT_TYPE_LABELS[type]}`}
                              onClick={() => {
                                const L = createCADLight(type);
                                setLights((prev) => [...prev, L]);
                                selectEditTarget('light', L.id);
                                setShowLightHelpers(true);
                                if (activeClip) {
                                  setClips((prev) => prev.map((c) => (
                                    c.id !== activeClip.id ? c : ensureTrackForTarget(c, L.id, L.name, 'light', {
                                      position: L.position,
                                      rotation: L.rotation,
                                      scale: L.scale,
                                    })
                                  )));
                                }
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    />
                    <Section label="Cinematic lighting">
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          className={`${chipCls(litPreview)} w-full justify-center font-bold`}
                          onClick={() => {
                            setLitPreview((v) => {
                              const next = !v;
                              if (next) {
                                setShowLightHelpers(false);
                                setEnvironment((prev) => ({
                                  ...prev,
                                  backgroundMode: 'solid',
                                  backgroundColor: prev.backgroundColor || '#000000',
                                }));
                              } else {
                                setShowLightHelpers(true);
                              }
                              return next;
                            });
                          }}
                        >
                          {litPreview ? 'CINEMATIC ON' : 'CINEMATIC OFF'}
                        </button>
                        <p className="text-[8px] text-[#888] leading-relaxed">
                          {litPreview
                            ? 'Only your scene lights render (Key, Fill, Spot…). Studio fill is off — turn every light to 0 for pitch black. Use Lamps On to show gizmos while editing.'
                            : 'Edit mode uses studio fill so meshes stay visible. Turn Cinematic ON for real cutscene lighting.'}
                        </p>
                        <button
                          type="button"
                          className={`${miniBtn} w-full justify-center`}
                          title="Replace lights with warm Key, cool Fill, and warm Rim"
                          onClick={() => {
                            const next = createDramaticThreePointLights();
                            setLights(next);
                            selectEditTarget('light', next[0].id);
                            setShowLightHelpers(true);
                            setLitPreview(true);
                            setEnvironment((prev) => ({
                              ...prev,
                              backgroundMode: 'solid',
                              backgroundColor: prev.backgroundColor || '#000000',
                            }));
                            if (activeClip) {
                              setClips((prev) => prev.map((c) => {
                                if (c.id !== activeClip.id) return c;
                                let clip = c;
                                next.forEach((L) => {
                                  clip = ensureTrackForTarget(clip, L.id, L.name, 'light', {
                                    position: L.position,
                                    rotation: L.rotation,
                                    scale: L.scale,
                                  });
                                });
                                return clip;
                              }));
                            }
                          }}
                        >
                          Dramatic 3-Point
                        </button>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            className={chipCls(environment.backgroundMode !== 'solid')}
                            onClick={() => setEnvironment((prev) => ({ ...prev, backgroundMode: 'sky' }))}
                          >
                            Sky BG
                          </button>
                          <button
                            type="button"
                            className={chipCls(environment.backgroundMode === 'solid')}
                            onClick={() => setEnvironment((prev) => ({
                              ...prev,
                              backgroundMode: 'solid',
                              backgroundColor: prev.backgroundColor || '#000000',
                            }))}
                          >
                            Solid BG
                          </button>
                        </div>
                        {environment.backgroundMode === 'solid' && (
                          <label className="flex items-center gap-2 text-[9px] text-[#888]">
                            Color
                            <input
                              type="color"
                              value={environment.backgroundColor || '#000000'}
                              className="h-6 w-10 bg-transparent border-0"
                              onChange={(e) => setEnvironment((prev) => ({
                                ...prev,
                                backgroundMode: 'solid',
                                backgroundColor: e.target.value,
                              }))}
                            />
                          </label>
                        )}
                      </div>
                    </Section>
                    <Section label={`Scene lights · ${lights.length}`}>
                      <div className="space-y-0.5">
                        {lights.map((L) => {
                          const active = editKind === 'light' && editId === L.id;
                          return (
                            <div key={L.id} className={`rounded px-1 py-0.5 ${active ? 'bg-[#f1c40f]/12' : ''}`}>
                              <div className="flex items-center gap-1">
                                <button type="button" className="flex-1 min-w-0 h-6 flex items-center gap-1.5 text-left text-[10px] text-[#c8c8c8]" onClick={() => selectEditTarget('light', L.id)}>
                                  <Sun className="w-3 h-3 text-[#f1c40f] shrink-0" />
                                  <span className="truncate">{L.name}</span>
                                  <span className="text-[8px] text-[#666]">{CAD_LIGHT_TYPE_LABELS[L.type] || L.type}</span>
                                </button>
                                <button type="button" className={miniBtn} onClick={() => patchLight(L.id, { visible: L.visible === false })}>{L.visible === false ? 'Off' : 'On'}</button>
                                <button
                                  type="button"
                                  className={`${miniBtn} text-[#c45c5c]`}
                                  onClick={() => {
                                    setLights((prev) => prev.filter((x) => x.id !== L.id));
                                    if (editId === L.id) setEditId('');
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {!lights.length && <div className="text-[9px] text-[#555] px-1 py-2">Add Point / Sun / Spot / Area above</div>}
                      </div>
                    </Section>
                    {editKind === 'light' && editId && (() => {
                      const L = lights.find((x) => x.id === editId);
                      if (!L) return null;
                      return (
                        <Section label={L.name}>
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-2 text-[9px] text-[#888]">
                              Type
                              <select
                                className="cad-input h-6 flex-1 px-1"
                                value={L.type}
                                onChange={(e) => {
                                  const type = e.target.value as CADLightType;
                                  const fresh = createCADLight(type, L.name, L.position);
                                  patchLight(L.id, {
                                    type,
                                    rotation: fresh.rotation,
                                    intensity: fresh.intensity,
                                    distance: fresh.distance,
                                    angle: fresh.angle,
                                    penumbra: fresh.penumbra,
                                    decay: fresh.decay,
                                    width: fresh.width,
                                    height: fresh.height,
                                    castShadow: fresh.castShadow,
                                    scale: fresh.scale,
                                    color: L.color,
                                  });
                                }}
                              >
                                {(Object.keys(CAD_LIGHT_TYPE_LABELS) as CADLightType[]).map((type) => (
                                  <option key={type} value={type}>{CAD_LIGHT_TYPE_LABELS[type]}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2 text-[9px] text-[#888]">
                              Color
                              <input type="color" value={L.color} className="h-6 w-10 bg-transparent border-0" onChange={(e) => patchLight(L.id, { color: e.target.value })} />
                            </label>
                            <label className="flex items-center gap-2 text-[9px] text-[#888]">
                              Intensity
                              <SmoothSlider
                                min={0}
                                max={8}
                                step={0.05}
                                value={L.intensity}
                                accent="#f1c40f"
                                onLiveChange={(intensity) => liveLight(L.id, { intensity })}
                                onChange={(intensity) => commitLight(L.id, { intensity })}
                                formatValue={(v) => v.toFixed(2)}
                              />
                            </label>
                            {(L.type === 'point' || L.type === 'spot') && (
                              <>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Range
                                  <SmoothSlider
                                    min={1}
                                    max={60}
                                    step={0.5}
                                    value={L.distance}
                                    accent="#f1c40f"
                                    onLiveChange={(distance) => liveLight(L.id, { distance })}
                                    onChange={(distance) => commitLight(L.id, { distance })}
                                    formatValue={(v) => v.toFixed(0)}
                                  />
                                </label>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Decay
                                  <SmoothSlider
                                    min={0}
                                    max={3}
                                    step={0.05}
                                    value={L.decay ?? 2}
                                    accent="#f1c40f"
                                    onLiveChange={(decay) => liveLight(L.id, { decay })}
                                    onChange={(decay) => commitLight(L.id, { decay })}
                                    formatValue={(v) => v.toFixed(2)}
                                  />
                                </label>
                              </>
                            )}
                            {L.type === 'spot' && (
                              <>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Angle
                                  <SmoothSlider
                                    min={0.05}
                                    max={1.4}
                                    step={0.02}
                                    value={L.angle}
                                    accent="#f1c40f"
                                    onLiveChange={(angle) => liveLight(L.id, { angle })}
                                    onChange={(angle) => commitLight(L.id, { angle })}
                                    formatValue={(v) => v.toFixed(2)}
                                  />
                                </label>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Soft
                                  <SmoothSlider
                                    min={0}
                                    max={1}
                                    step={0.02}
                                    value={L.penumbra}
                                    accent="#f1c40f"
                                    onLiveChange={(penumbra) => liveLight(L.id, { penumbra })}
                                    onChange={(penumbra) => commitLight(L.id, { penumbra })}
                                    formatValue={(v) => v.toFixed(2)}
                                  />
                                </label>
                              </>
                            )}
                            {L.type === 'area' && (
                              <>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Width
                                  <SmoothSlider
                                    min={0.2}
                                    max={12}
                                    step={0.1}
                                    value={L.width ?? L.scale.x * 2}
                                    accent="#f1c40f"
                                    onLiveChange={(width) => liveLight(L.id, { width, scale: { ...L.scale, x: width / 2 } })}
                                    onChange={(width) => commitLight(L.id, { width, scale: { ...L.scale, x: width / 2 } })}
                                    formatValue={(v) => v.toFixed(1)}
                                  />
                                </label>
                                <label className="flex items-center gap-2 text-[9px] text-[#888]">
                                  Height
                                  <SmoothSlider
                                    min={0.2}
                                    max={12}
                                    step={0.1}
                                    value={L.height ?? L.scale.y * 2}
                                    accent="#f1c40f"
                                    onLiveChange={(height) => liveLight(L.id, { height, scale: { ...L.scale, y: height / 2 } })}
                                    onChange={(height) => commitLight(L.id, { height, scale: { ...L.scale, y: height / 2 } })}
                                    formatValue={(v) => v.toFixed(1)}
                                  />
                                </label>
                              </>
                            )}
                            {L.type !== 'ambient' && (
                              <button
                                type="button"
                                className={`${chipCls(L.castShadow !== false)} w-full justify-center`}
                                onClick={() => patchLight(L.id, { castShadow: L.castShadow === false })}
                              >
                                Shadows {L.castShadow === false ? 'Off' : 'On'}
                              </button>
                            )}
                            <Vec3Fields label="Position" value={L.position} onChange={(position) => patchLight(L.id, { position })} />
                            <Vec3Fields label="Rotation" value={L.rotation} onChange={(rotation) => patchLight(L.id, { rotation })} step={0.05} />
                            <Vec3Fields label="Scale" value={L.scale} onChange={(scale) => {
                              const patch: Partial<CADLight> = { scale };
                              if (L.type === 'point' || L.type === 'spot') {
                                patch.distance = Math.max(0.5, ((scale.x + scale.y + scale.z) / 3) * 8);
                              }
                              if (L.type === 'area') {
                                patch.width = Math.max(0.1, scale.x * 2);
                                patch.height = Math.max(0.1, scale.y * 2);
                              }
                              patchLight(L.id, patch);
                            }} step={0.05} />
                            <div className="flex gap-1">
                              {([
                                { id: 'translate' as const, label: 'Move', icon: <Move className="w-3 h-3" /> },
                                { id: 'rotate' as const, label: 'Rot', icon: <RotateCw className="w-3 h-3" /> },
                                { id: 'scale' as const, label: 'Scale', icon: <Maximize2 className="w-3 h-3" /> },
                              ]).map((mode) => (
                                <button
                                  key={mode.id}
                                  type="button"
                                  className={`${chipCls(gizmoMode === mode.id)} flex-1 justify-center gap-1`}
                                  onClick={() => {
                                    setGizmoMode(mode.id);
                                    setCameraView(false);
                                    setShowLightHelpers(true);
                                    setEditPopupOpen(true);
                                  }}
                                >
                                  {mode.icon}{mode.label}
                                </button>
                              ))}
                            </div>
                            <button type="button" className={primaryBtn('bg-[#f1c40f] hover:bg-[#f4d03f] text-black')} onClick={() => handleAddKeyframe('all', L.id)}>
                              <Key className="w-3 h-3" /> Key Light
                            </button>
                          </div>
                        </Section>
                      );
                    })()}
                  </>
                )}

                {leftTab === 'weather' && (
                  <>
                    <PanelHead title="Sky / Environment" />
                    <Section label="Weather">
                      <div className="grid grid-cols-3 gap-0.5">
                        {(['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'] as WeatherPreset[]).map((w) => (
                          <button key={w} type="button" onClick={() => applyWeather(w)} className={`${chipCls(environment.weather === w)} capitalize`}>
                            {w}
                          </button>
                        ))}
                      </div>
                    </Section>
                    <Section label="Fog">
                      <label className="flex items-center gap-2 text-[9px] text-[#888]">
                        Density
                        <SmoothSlider min={0} max={0.12} step={0.001} value={environment.fogDensity}
                          onLiveChange={(fogDensity) => liveEnvironment({ fogDensity })}
                          onChange={(fogDensity) => commitEnvironment({ fogDensity })} />
                      </label>
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Color
                        <input type="color" value={environment.fogColor} className="h-6 w-10 bg-transparent border-0"
                          onChange={(e) => setEnvironment((prev) => ({ ...prev, fogColor: e.target.value }))} />
                      </label>
                    </Section>
                    <Section label="Sun">
                      <label className="flex items-center gap-2 text-[9px] text-[#888]">
                        Elevation
                        <SmoothSlider min={-10} max={90} step={1} value={environment.sunElevation} accent="#e68619"
                          onLiveChange={(sunElevation) => liveEnvironment({ sunElevation })}
                          onChange={(sunElevation) => commitEnvironment({ sunElevation })} />
                      </label>
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Azimuth
                        <SmoothSlider min={0} max={360} step={1} value={environment.sunAzimuth} accent="#e68619"
                          onLiveChange={(sunAzimuth) => liveEnvironment({ sunAzimuth })}
                          onChange={(sunAzimuth) => commitEnvironment({ sunAzimuth })} />
                      </label>
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Color
                        <input type="color" value={environment.sunColor} className="h-6 w-10 bg-transparent border-0"
                          onChange={(e) => setEnvironment((prev) => ({ ...prev, sunColor: e.target.value }))} />
                      </label>
                    </Section>
                    <Section label="Sky / Ambient">
                      <label className="flex items-center gap-2 text-[9px] text-[#888]">
                        Top
                        <input type="color" value={environment.skyTopColor} className="h-6 w-10 bg-transparent border-0"
                          onChange={(e) => setEnvironment((prev) => ({ ...prev, skyTopColor: e.target.value }))} />
                      </label>
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Horizon
                        <input type="color" value={environment.skyHorizonColor} className="h-6 w-10 bg-transparent border-0"
                          onChange={(e) => setEnvironment((prev) => ({ ...prev, skyHorizonColor: e.target.value }))} />
                      </label>
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Ambient
                        <input type="color" value={environment.ambientColor} className="h-6 w-10 bg-transparent border-0"
                          onChange={(e) => setEnvironment((prev) => ({ ...prev, ambientColor: e.target.value }))} />
                      </label>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <button
                          type="button"
                          className={chipCls(environment.backgroundMode !== 'solid')}
                          onClick={() => setEnvironment((prev) => ({ ...prev, backgroundMode: 'sky' }))}
                        >
                          Sky BG
                        </button>
                        <button
                          type="button"
                          className={chipCls(environment.backgroundMode === 'solid')}
                          onClick={() => setEnvironment((prev) => ({
                            ...prev,
                            backgroundMode: 'solid',
                            backgroundColor: prev.backgroundColor || '#000000',
                          }))}
                        >
                          Solid BG
                        </button>
                      </div>
                      {environment.backgroundMode === 'solid' && (
                        <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                          BG Color
                          <input type="color" value={environment.backgroundColor || '#000000'} className="h-6 w-10 bg-transparent border-0"
                            onChange={(e) => setEnvironment((prev) => ({
                              ...prev,
                              backgroundMode: 'solid',
                              backgroundColor: e.target.value,
                            }))} />
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-[9px] text-[#888] mt-1">
                        Wind
                        <SmoothSlider min={0} max={4} step={0.05} value={environment.windStrength} accent="#6a9fd8"
                          onChange={(windStrength) => commitEnvironment({ windStrength })} />
                      </label>
                    </Section>
                  </>
                )}
              </div>
            </aside>
            <div
              role="separator"
              onPointerDown={startResizeLeft}
              onDoubleClick={() => setLeftWidth(280)}
              className="w-1.5 shrink-0 cursor-col-resize bg-[#1a1a1a] hover:bg-[#ed7300]/50 border-r border-[#4d4d4d]"
              title="Drag to resize tools · Double-click reset"
            />
          </>
        )}

        {/* Viewport */}
        <div className="flex-1 relative bg-[#1b1b1b] min-w-0">
          <div
            ref={containerRef}
            className="absolute inset-0"
            onPointerDown={handleViewportPointerDown}
          />
          {/* Sequence cinematic FX: transition veil + titles/subtitles */}
          <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
            <div ref={seqBlackRef} className="absolute inset-0 bg-black opacity-0 transition-none" />
            <div ref={seqTitlesRef} className="absolute inset-0" />
          </div>
          <div className="absolute top-2 left-2 flex gap-2 z-10 pointer-events-none flex-wrap max-w-[70%]">
            <span className="cad-card px-2 py-1 text-[#e68619] font-bold font-mono text-[10px] flex items-center gap-1">
              <Layers className="w-3 h-3" /> {sceneName}
            </span>
            <span className="cad-card px-2 py-1 text-[#ed7300] font-bold font-mono text-[10px] flex items-center gap-1">
              <Film className="w-3 h-3" /> {focusPlayback ? 'FOCUS PLAYBACK' : 'CUTSCENE VIEW'}
            </span>
            <span
              ref={(el) => { timeLabelElsRef.current[1] = el; }}
              className="cad-card px-2 py-1 text-[#8c8c8c] font-mono text-[10px]"
            >
              {currentTime.toFixed(2)}s / {clipDuration.toFixed(2)}s
            </span>
            {!cameraView && !focusPlayback && (
              <span className="cad-card px-2 py-1 text-[#2d9d78] font-mono text-[10px]">
                Click to select · Gizmo edit · G/R/S grab
              </span>
            )}
            {modalTransform && (
              <span className="cad-card px-2 py-1 text-[#e68619] font-mono text-[10px] font-bold animate-pulse">
                {modalTransform === 'translate' ? 'GRAB (G)' : modalTransform === 'rotate' ? 'ROTATE (R)' : 'SCALE (S)'}
                {' · move mouse · LMB confirm · Esc/RMB cancel'}
              </span>
            )}
          </div>

          {focusPlayback && (
            <div className="absolute top-2 right-2 z-40 flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                className="h-8 px-3 rounded-md border border-[#e68619]/60 bg-[#1a1208]/95 text-[#e68619] text-[11px] font-mono font-bold inline-flex items-center gap-1.5 shadow-xl hover:bg-[#e68619]/20"
                title="Restore tools & timeline (Esc)"
                onClick={exitFocusPlayback}
              >
                <Minimize2 className="w-3.5 h-3.5" />
                Exit Enlarge
              </button>
              <button
                type="button"
                className={`h-8 w-8 rounded-md border flex items-center justify-center shadow-xl ${
                  isPlaying ? 'border-[#e68619] bg-[#e68619] text-white' : 'border-[#ed7300]/50 bg-[#0f1620]/95 text-[#6ec8ff]'
                }`}
                title="Play / Pause (Space)"
                onClick={() => setIsPlaying((p) => !p)}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                className={`h-8 px-2 rounded-md border text-[10px] font-mono inline-flex items-center gap-1 shadow-xl ${
                  showLightwaveTools
                    ? 'border-[#ed7300]/50 bg-[#0f1620]/95 text-[#6ec8ff]'
                    : 'border-[#333] bg-[#3a3a3a]/90 text-[#777]'
                }`}
                title="Toggle LightWave tools"
                onClick={() => setShowLightwaveTools((v) => !v)}
              >
                <Crosshair className="w-3 h-3" />
                LW
              </button>
            </div>
          )}

          {showLightwaveTools && (
            <LightwaveNavToolbar
              onFocusCenter={handleLightwaveFocusCenter}
              onDragPan={handleLightwaveDragPan}
              onDragOrbit={handleLightwaveDragOrbit}
              onDragZoom={handleLightwaveDragZoom}
              onMaximize={toggleFocusPlayback}
              isMaximized={focusPlayback}
              showOrbit={!cameraView}
              maximizeTitle={focusPlayback ? 'Restore editor UI (Esc)' : 'Enlarge viewport — hide UI (Shift+F)'}
            />
          )}

          <AnimEditPopup
            isOpen={editPopupOpen && !focusPlayback}
            onClose={() => setEditPopupOpen(false)}
            target={activeEditTarget}
            targets={editTargets}
            onSelectTarget={selectEditTarget}
            gizmoMode={gizmoMode}
            onGizmoMode={(mode) => { setGizmoMode(mode); setCameraView(false); }}
            onChangeTransform={applyEditTransform}
            onKeyNow={keyEditTargetNow}
            onOpenParticleStudio={() => {
              const p = particles.find((x) => x.id === editId) || null;
              setEditingParticle(p);
              setParticleModalOpen(true);
            }}
          />
        </div>
      </div>

      {/* Timeline resize handle */}
      {!timelineCollapsed && !focusPlayback && (
        <div
          role="separator"
          onPointerDown={startResizeTimeline}
          onDoubleClick={(e) => {
            e.preventDefault();
            cycleTimelineHeight();
          }}
          className="h-2 shrink-0 cursor-row-resize bg-[#1a1a1a] hover:bg-[#ed7300]/60 border-t border-[#4d4d4d] flex items-center justify-center group relative"
          title="Drag to resize · Double-click cycle size · Shift+T maximize"
        >
          <div className="w-16 h-0.5 rounded-full bg-[#3a3a3a] group-hover:bg-[#ed7300] transition" />
          <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 pointer-events-auto">
            {[
              { label: 'S', h: 200 },
              { label: 'M', h: 300 },
              { label: 'L', h: 420 },
              { label: 'Max', h: -1 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="h-5 min-w-[22px] px-1 rounded bg-[#222] border border-[#1a1a1a] text-[8px] font-mono font-bold text-[#9a9a9a] hover:text-white hover:border-[#ed7300]"
                title={preset.label === 'Max' ? 'Maximize timeline (Shift+T)' : `Timeline height ${preset.h}px`}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (preset.h < 0) maximizeTimelineEditor();
                  else applyTimelineHeight(preset.h);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {timelineCollapsed && !focusPlayback && (
        <button
          type="button"
          className="h-8 shrink-0 border-t border-[#4d4d4d] bg-[#333333] text-[10px] font-mono text-[#8c8c8c] hover:text-[#ed7300] flex items-center justify-center gap-2"
          onClick={() => applyTimelineHeight(320)}
        >
          <ChevronsDownUp className="w-3.5 h-3.5" /> Show Timeline · {currentTime.toFixed(2)}s / {(activeClip?.duration || 0).toFixed(2)}s
        </button>
      )}

      {/* Timeline editor */}
      {!timelineCollapsed && !focusPlayback && (
        <div
          ref={timelinePanelRef}
          style={{ height: timelineHeight }}
          className="shrink-0 bg-[#0b0d12] border-t border-[#1a1a1a] flex flex-col select-none"
          onPointerEnter={() => setTimelineFocus(true)}
          onPointerLeave={() => setTimelineFocus(false)}
          tabIndex={0}
        >
          {/* Transport toolbar */}
          <div className="h-9 bg-[#2b2b2b] border-b border-[#1a1a1a] px-2 flex items-center gap-1.5 font-mono text-[10px] shrink-0 overflow-x-auto custom-scrollbar">
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Start (Home)" onClick={() => setPlayhead(0)}>
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Prev frame (←)" onClick={() => stepFrames(-1)}>
                <StepBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className={`p-1.5 rounded-full text-white ${isPlaying ? 'bg-[#e68619]' : 'bg-[#ed7300]'}`}
                title="Play / Pause (Space)"
                onClick={() => setIsPlaying((p) => !p)}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Next frame (→)" onClick={() => stepFrames(1)}>
                <StepForward className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="End (End)" onClick={() => setPlayhead(clipDuration)}>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            <label className="flex items-center gap-1 h-6 px-1.5 rounded bg-[#3a3a3a] border border-[#1a1a1a] shrink-0" title="Jump to time">
              <span className="text-[#555]">T</span>
              <input
                type="number"
                step={snapToFrames ? 1 / clipFps : 0.01}
                min={0}
                max={clipDuration}
                value={Number(currentTime.toFixed(3))}
                onChange={(e) => setPlayhead(Number(e.target.value))}
                className="w-14 bg-transparent outline-none text-right text-[#d0d0d0]"
              />
              <span className="text-[#555]">/ {clipDuration.toFixed(1)}s</span>
            </label>

            {timelineTab === 'seq' && sequence ? (
              <LengthField
                value={sequence.duration}
                snapStep={snapToFrames ? 1 / clipFps : 0.1}
                onChange={(next) => setSequence((prev) => (prev ? setSequenceDuration(prev, next) : prev))}
                title="Sequence length — drag to change · click number to type"
              />
            ) : activeClip && timelineTab !== 'seq' ? (
              <LengthField
                value={activeClip.duration}
                snapStep={snapToFrames ? 1 / clipFps : 0.1}
                onChange={setActiveClipDuration}
                title="Clip length — drag to change · click number to type · or drag the orange end on the ruler"
              />
            ) : null}

            <button
              type="button"
              className={`h-6 px-1.5 rounded border text-[9px] ${snapToFrames ? 'border-[#ed7300] bg-[#ed7300]/20 text-white' : 'border-[#1a1a1a] text-[#888]'}`}
              title="Snap playhead & keys to frames"
              onClick={() => setSnapToFrames((v) => !v)}
            >
              {clipFps} fps · Snap {snapToFrames ? 'ON' : 'OFF'}
            </button>

            {activeClip && (
              <select
                className="h-6 px-1 rounded bg-[#3a3a3a] border border-[#1a1a1a] text-[9px] outline-none"
                value={activeClip.loopMode}
                onChange={(e) => setClips((prev) => prev.map((c) => c.id === activeClip.id ? { ...c, loopMode: e.target.value as typeof c.loopMode } : c))}
                title="Loop mode"
              >
                <option value="loop">Loop</option>
                <option value="once">Once</option>
                <option value="hold">Hold</option>
              </select>
            )}

            <div className="flex items-center gap-0.5 bg-[#3a3a3a] p-0.5 rounded border border-[#1a1a1a] shrink-0">
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Zoom out (−)" onClick={() => zoomTimeline(1 / 1.25)}>
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <SmoothSlider
                min={40}
                max={600}
                step={1}
                value={pxPerSec}
                onChange={setPxPerSec}
                className="w-20"
                title="Timeline zoom (horizontal)"
              />
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Zoom in (+)" onClick={() => zoomTimeline(1.25)}>
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-[8px] text-[#555] w-10 text-right">{pxPerSec}px</span>
            </div>

            <div className="flex items-center gap-0.5 bg-[#3a3a3a] p-0.5 rounded border border-[#1a1a1a] shrink-0" title="Timeline / dope sheet height">
              <button type="button" className="h-5 px-1.5 rounded text-[8px] font-bold text-[#8c8c8c] hover:text-white hover:bg-[#2a2a2a]" onClick={() => applyTimelineHeight(Math.max(160, timelineHeight - 80))} title="Shorter">
                −H
              </button>
              {[
                { label: 'S', h: 200 },
                { label: 'M', h: 300 },
                { label: 'L', h: 420 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`h-5 min-w-[18px] px-1 rounded text-[8px] font-bold ${
                    Math.abs(timelineHeight - preset.h) < 20 ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c] hover:text-white hover:bg-[#2a2a2a]'
                  }`}
                  onClick={() => applyTimelineHeight(preset.h)}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`h-5 px-1.5 rounded text-[8px] font-bold ${
                  timelineHeight >= getTimelineMaxHeight() - 30 ? 'bg-[#e68619] text-white' : 'text-[#e68619] hover:bg-[#e68619]/20'
                }`}
                title="Maximize dope / timeline (Shift+T)"
                onClick={maximizeTimelineEditor}
              >
                Max
              </button>
              <button type="button" className="h-5 px-1.5 rounded text-[8px] font-bold text-[#8c8c8c] hover:text-white hover:bg-[#2a2a2a]" onClick={() => applyTimelineHeight(Math.min(getTimelineMaxHeight(), timelineHeight + 80))} title="Taller">
                +H
              </button>
            </div>

            {activeClip && timelineTab !== 'seq' && (
              <div className="flex items-center gap-0.5 bg-[#3a3a3a] p-0.5 rounded border border-[#1a1a1a] shrink-0" title="Extend clip length">
                <span className="text-[8px] text-[#666] px-1">Len</span>
                <button type="button" className="h-5 px-1 rounded text-[8px] font-bold text-[#8c8c8c] hover:text-white hover:bg-[#2a2a2a]" onClick={() => extendClipDuration(-1)} title="−1s">
                  −1s
                </button>
                <button type="button" className="h-5 px-1 rounded text-[8px] font-bold text-[#e68619] hover:bg-[#e68619]/20" onClick={() => extendClipDuration(1)} title="+1s">
                  +1s
                </button>
                <button type="button" className="h-5 px-1 rounded text-[8px] font-bold text-[#e68619] hover:bg-[#e68619]/20" onClick={() => extendClipDuration(2)} title="+2s">
                  +2s
                </button>
              </div>
            )}

            <div className="flex bg-[#3a3a3a] p-0.5 rounded border border-[#1a1a1a] shrink-0">
              <button type="button" className={`px-2 py-0.5 rounded text-[9px] font-bold ${timelineTab === 'dope' ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c]'}`} onClick={() => setTimelineTab('dope')}>DOPE</button>
              <button type="button" className={`px-2 py-0.5 rounded text-[9px] font-bold ${timelineTab === 'graph' ? 'bg-[#ed7300] text-white' : 'text-[#8c8c8c]'}`} onClick={() => setTimelineTab('graph')}>GRAPH</button>
              <button type="button" className={`px-2 py-0.5 rounded text-[9px] font-bold ${timelineTab === 'seq' ? 'bg-[#e68619] text-white' : 'text-[#8c8c8c]'}`} onClick={() => {
                setSequence((prev) => ensureMovieSequenceTracks(
                  prev || createEmptySequence('Cutscene', Math.max(8, activeClip?.duration || 8), clipFps),
                ));
                setTimelineTab('seq');
              }}
              >
                SEQ
              </button>
            </div>

            {timelineTab === 'seq' && (
              <>
                <div className="h-4 w-px bg-[#1a1a1a] shrink-0" />
                <button
                  type="button"
                  className="h-6 px-1.5 rounded border border-[#ed7300]/40 text-[9px] text-[#6a9fd8] shrink-0"
                  title="Drop active anim clip on Video track"
                  onClick={() => {
                    if (!activeClip) return;
                    setSequence((prev) => {
                      let seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      let track = seq.tracks.find((t) => t.kind === 'video' && !t.locked) || seq.tracks.find((t) => t.kind === 'video');
                      if (!track) {
                        seq = addSequenceTrack(seq, 'video');
                        track = seq.tracks.find((t) => t.kind === 'video')!;
                      }
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, activeClip.name, { type: 'animClip', refId: activeClip.id }, currentTime, activeClip.duration, SEQ_CLIP_COLORS.animClip),
                      );
                    });
                  }}
                >
                  + Anim
                </button>
                <select
                  className="h-6 max-w-[88px] px-1 rounded border border-[#e68619]/40 bg-[#3a3a3a] text-[9px] text-[#e68619] shrink-0"
                  title="Add particle FX cue"
                  defaultValue=""
                  onChange={(e) => {
                    const pid = e.target.value;
                    e.target.value = '';
                    const p = particles.find((x) => x.id === pid);
                    if (!p) return;
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'fx' && !t.locked) || seq.tracks.find((t) => t.kind === 'fx');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, p.name, { type: 'particle', refId: p.id }, currentTime, 2, SEQ_CLIP_COLORS.particle),
                      );
                    });
                  }}
                >
                  <option value="" disabled>+ FX</option>
                  {particles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select
                  className="h-6 max-w-[100px] px-1 rounded border border-[#6a9fd8]/40 bg-[#3a3a3a] text-[9px] text-[#6a9fd8] shrink-0"
                  title="Add weather cue"
                  defaultValue=""
                  onChange={(e) => {
                    const weather = e.target.value;
                    e.target.value = '';
                    if (!weather) return;
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'env');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, weather, { type: 'weather', refId: weather }, currentTime, 3, SEQ_CLIP_COLORS.weather),
                      );
                    });
                  }}
                >
                  <option value="" disabled>+ Weather</option>
                  {['clear', 'fog', 'rain', 'snow', 'storm', 'overcast'].map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
                <select
                  className="h-6 max-w-[100px] px-1 rounded border border-[#9b59b6]/40 bg-[#3a3a3a] text-[9px] text-[#c39bd3] shrink-0"
                  title="Add camera shot (set transition in inspector)"
                  defaultValue=""
                  onChange={(e) => {
                    const cid = e.target.value;
                    e.target.value = '';
                    const cam = cameras.find((c) => c.id === cid);
                    if (!cam) return;
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'camera');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, cam.name, { type: 'cameraShot', refId: cam.id }, currentTime, 2, SEQ_CLIP_COLORS.cameraShot),
                      );
                    });
                  }}
                >
                  <option value="" disabled>+ Cam</option>
                  {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select
                  className="h-6 max-w-[100px] px-1 rounded border border-[#f1c40f]/40 bg-[#3a3a3a] text-[9px] text-[#f1c40f] shrink-0"
                  title="Add light cue"
                  defaultValue=""
                  onChange={(e) => {
                    const lid = e.target.value;
                    e.target.value = '';
                    const L = lights.find((x) => x.id === lid);
                    if (!L) return;
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'light');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, L.name, { type: 'lightCue', refId: L.id }, currentTime, 2, SEQ_CLIP_COLORS.lightCue),
                      );
                    });
                  }}
                >
                  <option value="" disabled>+ Light</option>
                  {lights.map((L) => <option key={L.id} value={L.id}>{L.name}</option>)}
                </select>
                <button
                  type="button"
                  className="h-6 px-1.5 rounded border border-[#ec5b62]/40 text-[9px] text-[#ec5b62] shrink-0"
                  title="Add title card on Titles track"
                  onClick={() => {
                    const text = window.prompt('Title text', 'Chapter One') || 'Title';
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'overlay');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, text.slice(0, 24), { type: 'title', refId: text }, currentTime, 3, SEQ_CLIP_COLORS.title),
                      );
                    });
                  }}
                >
                  + Title
                </button>
                <button
                  type="button"
                  className="h-6 px-1.5 rounded border border-[#c45c9a]/40 text-[9px] text-[#c45c9a] shrink-0"
                  title="Add subtitle / dialogue caption"
                  onClick={() => {
                    const text = window.prompt('Subtitle text', '…') || 'Subtitle';
                    setSequence((prev) => {
                      const seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', 10, clipFps));
                      const track = seq.tracks.find((t) => t.kind === 'overlay');
                      if (!track) return seq;
                      return addClipToTrack(
                        seq,
                        track.id,
                        createSequenceClip(track.id, text.slice(0, 24), { type: 'subtitle', refId: text }, currentTime, 2.5, SEQ_CLIP_COLORS.subtitle),
                      );
                    });
                  }}
                >
                  + Sub
                </button>
                <label className="h-6 px-1.5 rounded border border-[#2d9d78]/40 text-[9px] text-[#2d9d78] shrink-0 flex items-center gap-1 cursor-pointer">
                  <Music className="w-3 h-3" /> Audio
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      const url = URL.createObjectURL(file);
                      const audio = new Audio(url);
                      await new Promise<void>((resolve) => {
                        audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
                        audio.addEventListener('error', () => resolve(), { once: true });
                      });
                      const dur = Number.isFinite(audio.duration) ? audio.duration : 4;
                      setSequence((prev) => {
                        let seq = ensureMovieSequenceTracks(prev || createEmptySequence('Cutscene', Math.max(10, currentTime + dur), clipFps));
                        seq = addAudioAsset(seq, { name: file.name, url, duration: dur });
                        const asset = seq.audioAssets[seq.audioAssets.length - 1];
                        const track = seq.tracks.find((t) => t.kind === 'audio' && t.name.toLowerCase().includes('music'))
                          || seq.tracks.find((t) => t.kind === 'audio');
                        if (!track || !asset) return seq;
                        return addClipToTrack(
                          seq,
                          track.id,
                          createSequenceClip(track.id, file.name, { type: 'audio', refId: asset.id }, currentTime, dur, SEQ_CLIP_COLORS.audio),
                        );
                      });
                    }}
                  />
                </label>
              </>
            )}

            {timelineTab !== 'seq' && (
              <>
            <div className="h-4 w-px bg-[#1a1a1a] shrink-0" />

            <button type="button" className="h-6 px-1.5 rounded bg-[#ed7300] text-white text-[9px] font-bold flex items-center gap-1 shrink-0" title="Key selected (K)" onClick={() => handleAddKeyframe('all')}>
              <Key className="w-3 h-3" /> Key
            </button>
            <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] text-[9px] text-[#b0b0b0] hover:text-white shrink-0" title="Key all tracks at playhead" onClick={keyAllVisibleTracks}>
              Column
            </button>
            <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] text-[9px] text-[#6a9fd8] shrink-0" onClick={() => handleAddKeyframe('pos')}>Pos</button>
            <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] text-[9px] text-[#ec5b62] shrink-0" onClick={() => handleAddKeyframe('rot')}>Rot</button>
            <button type="button" className="h-6 px-1.5 rounded border border-[#1a1a1a] text-[9px] text-[#e68619] shrink-0" onClick={() => handleAddKeyframe('scl')}>Scl</button>
            {selectedKeyframeId && (
              <button type="button" className="h-6 px-1.5 rounded bg-[#ec5b62] text-white text-[9px] font-bold flex items-center gap-1 shrink-0" onClick={handleDeleteKeyframe}>
                <Trash2 className="w-3 h-3" /> Del
              </button>
            )}
            {untracked.length > 0 && (
              <button type="button" className="h-6 px-1.5 rounded border border-[#e68619]/40 text-[9px] text-[#e68619] shrink-0" onClick={() => handleAddTrack(untracked[0].id)}>
                + Track
              </button>
            )}

            <label className="flex items-center gap-1 text-[9px] text-[#777] shrink-0 ml-1" title="Procedural speed">
              Spd
              <SmoothSlider min={0.1} max={3} step={0.05} value={procSpeed} onChange={setProcSpeed} className="w-14" />
            </label>
              </>
            )}

            <div className="flex items-center gap-1 ml-auto shrink-0">
              {timelineTab === 'seq' && (
                <select
                  className="h-6 px-1 rounded border border-[#1a1a1a] bg-[#3a3a3a] text-[9px] text-[#888]"
                  title="Record capture frame rate"
                  value={recordFps}
                  onChange={(e) => setRecordFps(Number(e.target.value))}
                >
                  <option value={24}>Rec 24fps</option>
                  <option value={30}>Rec 30fps</option>
                  <option value={60}>Rec 60fps</option>
                </select>
              )}
              {!isRecording ? (
                <button type="button" className="h-6 px-2 rounded border border-[#ec5b62]/50 text-[#ec5b62] text-[9px] font-bold flex items-center gap-1" onClick={startRecording} title="Record cutscene to WebM (plays from start)">
                  <Video className="w-3 h-3" /> Rec
                </button>
              ) : (
                <button type="button" className="h-6 px-2 rounded bg-[#ec5b62] text-white text-[9px] font-bold flex items-center gap-1" onClick={stopRecording}>
                  <Download className="w-3 h-3" /> Stop
                </button>
              )}
              <button
                type="button"
                className="h-6 px-1.5 rounded border border-[#1a1a1a] text-[8px] font-bold text-[#8c8c8c] hover:text-[#ed7300] hover:border-[#ed7300]/40"
                title="Cycle timeline size"
                onClick={cycleTimelineHeight}
              >
                Size
              </button>
              <button type="button" className="p-1 rounded hover:bg-[#2a2a2a] text-[#8c8c8c]" title="Minimize timeline" onClick={() => setTimelineCollapsed(true)}>
                <ChevronsDownUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Dope / Graph / Sequence body */}
          <div className="flex-1 min-h-0 flex flex-col">
            {timelineTab === 'seq' ? (
              sequence ? (
                <SequenceTimeline
                  sequence={sequence}
                  currentTime={currentTime}
                  pxPerSec={pxPerSec}
                  snapToFrames={snapToFrames}
                  selectedClipId={selectedSeqClipId}
                  onSelectClip={setSelectedSeqClipId}
                  onChangeSequence={(next) => setSequence(next)}
                  onScrub={setPlayhead}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-[10px] font-mono text-[#555] bg-[#080a0f]">
                  <button type="button" className="h-8 px-3 rounded bg-[#e68619] text-white text-[10px] font-bold" onClick={() => setSequence(ensureMovieSequenceTracks(createEmptySequence('Cutscene', 10, clipFps)))}>
                    Create Sequence
                  </button>
                </div>
              )
            ) : timelineTab === 'graph' ? (
              activeClip ? (
                <AnimGraphEditor
                  clip={activeClip}
                  track={activeClip.tracks.find((t) => t.targetId === selectedTrackId) || activeClip.tracks[0] || null}
                  currentTime={currentTime}
                  pxPerSec={pxPerSec}
                  snapToFrames={snapToFrames}
                  selectedKeyframeId={selectedKeyframeId}
                  onSelectKeyframe={setSelectedKeyframeId}
                  onScrub={setPlayhead}
                  onPatchKeyframe={handleGraphPatchKeyframe}
                  onInsertKeyframe={handleGraphInsertKeyframe}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-[10px] font-mono text-[#555] bg-[#080a0f]">
                  Create or select a clip to edit curves
                </div>
              )
            ) : (
              <div className="flex-1 min-h-0 flex">
                {/* Fixed track labels */}
                <div className="w-44 shrink-0 border-r border-[#1a1a1a] bg-[#3a3a3a] flex flex-col min-h-0">
                  <div className="h-7 px-2 border-b border-[#1a1a1a] text-[8px] uppercase tracking-wider text-[#666] flex items-center gap-1 shrink-0">
                    <Layers className="w-3 h-3 text-[#ed7300]" /> Tracks
                  </div>
                  <div
                    ref={trackLabelScrollRef}
                    className="flex-1 overflow-y-auto custom-scrollbar"
                    onScroll={(e) => {
                      if (timelineScrollRef.current) timelineScrollRef.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                  >
                    {!activeClip || activeClip.tracks.length === 0 ? (
                      <div className="p-3 text-[9px] text-[#555] space-y-2">
                        <div>No tracks yet.</div>
                        <button type="button" className="h-6 px-2 rounded bg-[#ed7300] text-white text-[9px] font-bold" onClick={() => animationTargets.forEach((t) => handleAddTrack(t.id))}>
                          Add all tracks
                        </button>
                      </div>
                    ) : (
                      activeClip.tracks.map((track) => {
                        const isSelected = track.targetId === selectedTrackId;
                        const isExpanded = expandedTracks[track.targetId] ?? false;
                        return (
                          <div key={`label_${track.targetType}_${track.targetId}`} className="border-b border-[#1a1a1a]">
                            <div
                              className={`h-7 px-1.5 flex items-center gap-1 cursor-pointer ${isSelected ? 'bg-[#ed7300]/18' : 'hover:bg-[#1a1a1a]'}`}
                              onClick={() => setSelectedTrackId(track.targetId)}
                            >
                              <button
                                type="button"
                                className="text-[#666]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedTracks((prev) => ({ ...prev, [track.targetId]: !prev[track.targetId] }));
                                }}
                              >
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                              {track.targetType === 'bone' && <Bone className="w-3 h-3 text-[#ed7300] shrink-0" />}
                              {track.targetType === 'camera' && <Camera className="w-3 h-3 text-[#ed7300] shrink-0" />}
                              {track.targetType === 'mesh' && <Box className="w-3 h-3 text-[#e68619] shrink-0" />}
                              {track.targetType === 'particle' && <Sparkles className="w-3 h-3 text-[#e68619] shrink-0" />}
                              <span className="truncate flex-1 text-[10px] text-[#d0d0d0]">{track.targetName}</span>
                              <button type="button" className="p-0.5 text-[#555] hover:text-white" title="Move up" onClick={(e) => { e.stopPropagation(); handleReorderDopeTrack(track.targetId, 'up'); }}>
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button type="button" className="p-0.5 text-[#555] hover:text-white" title="Move down" onClick={(e) => { e.stopPropagation(); handleReorderDopeTrack(track.targetId, 'down'); }}>
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              <button type="button" className="p-0.5 text-[#555] hover:text-[#ed7300]" onClick={(e) => { e.stopPropagation(); handleAddKeyframe('all', track.targetId); }}>
                                <Key className="w-3 h-3" />
                              </button>
                              <button type="button" className="p-0.5 text-[#555] hover:text-[#ec5b62]" onClick={(e) => { e.stopPropagation(); handleRemoveTrack(track.targetId); }}>
                                <Minus className="w-3 h-3" />
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="bg-[#0e0e0e] text-[9px] text-[#777]">
                                {['Position', 'Rotation', track.targetType === 'camera' ? 'FOV' : 'Scale'].map((label) => (
                                  <div key={label} className="h-5 pl-7 flex items-center border-t border-[#1a1a1a]">{label}</div>
                                ))}
                                {track.targetType === 'mesh' && (
                                  <>
                                    <div className="h-5 pl-7 flex items-center justify-between gap-1 border-t border-[#1a1a1a] pr-1">
                                      <span>Tex Frame</span>
                                      <button
                                        type="button"
                                        className="h-4 px-1 rounded bg-[#ed7300]/30 text-[#94e2ff]"
                                        title="Key current texture frame index at playhead"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const mesh = meshes.find((m) => m.id === track.targetId);
                                          const idx = mesh?.textureAnimation?.frames.findIndex(
                                            (f) => f.dataUrl === mesh.textureCanvasDataUrl,
                                          );
                                          handleKeyTextureFrame(track.targetId, Math.max(0, idx ?? 0));
                                        }}
                                      >
                                        Key
                                      </button>
                                    </div>
                                    <div className="pl-7 py-1 border-t border-[#1a1a1a] space-y-0.5 pr-1">
                                      <div className="text-[#555]">Tex Clip</div>
                                      {(meshes.find((m) => m.id === track.targetId)?.textureAnimation?.clips || []).map((tc) => (
                                        <button
                                          key={tc.id}
                                          type="button"
                                          className="w-full h-5 px-1 rounded text-left hover:bg-[#ed7300]/25 text-[#e68619]"
                                          title={`Trigger ${tc.name} at playhead`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleKeyTextureClip(tc.id, track.targetId);
                                          }}
                                        >
                                          {tc.name}
                                        </button>
                                      ))}
                                      {!(meshes.find((m) => m.id === track.targetId)?.textureAnimation?.clips?.length) && (
                                        <div className="text-[8px] text-[#444]">No clips — tag frames in Paint</div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Scrollable time lanes */}
                <div
                  ref={timelineScrollRef}
                  className="flex-1 min-w-0 overflow-auto custom-scrollbar bg-[#0e1016]"
                  onScroll={(e) => {
                    if (trackLabelScrollRef.current) trackLabelScrollRef.current.scrollTop = e.currentTarget.scrollTop;
                  }}
                >
                  <div style={{ width: timelineWidthPx }} className="min-h-full relative">
                    {/* Ruler */}
                    <div
                      className="h-7 sticky top-0 z-20 bg-[#2d2d2d] border-b border-[#1a1a1a] relative cursor-ew-resize"
                      onPointerDown={startScrub}
                      title="Drag to scrub"
                    >
                      {renderRulerTicks()}
                      {/* Clip duration handle — wide hit target, doesn't fight scrub */}
                      {activeClip && (
                        <div
                          style={{ left: activeClip.duration * pxPerSec }}
                          className="absolute top-0 bottom-0 w-4 -translate-x-1/2 z-40 cursor-ew-resize group"
                          title="Drag to change clip length"
                          onPointerDown={startResizeClipDuration}
                        >
                          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-[#e68619] group-hover:w-1.5 group-hover:bg-[#ff9a2e] pointer-events-none" />
                          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-sm bg-[#e68619] rotate-45 shadow-md pointer-events-none group-hover:scale-110 transition" />
                          <div className="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[8px] font-mono text-[#e68619] whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100">
                            {activeClip.duration.toFixed(2)}s
                          </div>
                        </div>
                      )}
                      <div
                        ref={(el) => { playheadElsRef.current[0] = el; }}
                        style={{ left: currentTime * pxPerSec }}
                        className="absolute top-0 bottom-0 w-0.5 bg-[#ec5b62] z-30 pointer-events-none"
                      >
                        <div className="w-2.5 h-2.5 bg-[#ec5b62] -translate-x-1/2 rotate-45 -top-0.5 absolute rounded-sm" />
                      </div>
                    </div>

                    {/* Full-height playhead for lanes (DOM-updated during playback) */}
                    <div
                      ref={(el) => { playheadElsRef.current[1] = el; }}
                      style={{ left: currentTime * pxPerSec }}
                      className="absolute top-7 bottom-0 w-px bg-[#ec5b62]/55 z-20 pointer-events-none"
                    />
                    {activeClip && (
                      <div
                        style={{ left: activeClip.duration * pxPerSec }}
                        className="absolute top-7 bottom-0 w-px bg-[#e68619]/35 z-10 pointer-events-none"
                      />
                    )}
                    {/* Track lanes */}
                    {!activeClip || activeClip.tracks.length === 0 ? (
                      <div className="h-24 flex items-center justify-center text-[9px] text-[#555]">Add tracks to start keyframing</div>
                    ) : (
                      activeClip.tracks.map((track) => {
                        const isSelected = track.targetId === selectedTrackId;
                        const isExpanded = expandedTracks[track.targetId] ?? false;
                        const allTimes = Array.from(new Set([
                          ...track.posKeyframes.map((k) => k.time),
                          ...track.rotKeyframes.map((k) => k.time),
                          ...track.sclKeyframes.map((k) => k.time),
                          ...(track.texFrameKeyframes || []).map((k) => k.time),
                          ...(track.textureClipKeys || []).map((k) => k.time),
                        ]));
                        return (
                          <div key={`lane_${track.targetType}_${track.targetId}`} className="border-b border-[#1a1f2a]">
                            <div
                              className={`h-7 relative cursor-crosshair ${isSelected ? 'bg-[#ed7300]/10' : 'hover:bg-[#151a24]'}`}
                              onPointerDown={startScrub}
                              onDoubleClick={(e) => {
                                const t = timeFromPointer(e.clientX, e.currentTarget);
                                setPlayhead(t);
                                handleAddKeyframe('all', track.targetId);
                              }}
                              title="Click scrub · Double-click to key"
                            >
                              {/* frame grid */}
                              {Array.from({ length: Math.floor(clipDuration * clipFps) + 1 }).map((_, i) => (
                                i % Math.max(1, Math.round(clipFps / (pxPerSec >= 120 ? 4 : 2))) === 0 ? (
                                  <div key={i} style={{ left: (i / clipFps) * pxPerSec }} className="absolute top-0 bottom-0 w-px bg-[#1a1a1a] pointer-events-none" />
                                ) : null
                              ))}
                              {allTimes.map((t) => (
                                <div
                                  key={t}
                                  style={{ left: t * pxPerSec }}
                                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-[#ed7300] rotate-45 border border-[#0e1016] z-20 cursor-ew-resize hover:bg-[#5aa0ff]"
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    // find any keyframe at this time to drag
                                    const kf = [...track.posKeyframes, ...track.rotKeyframes, ...track.sclKeyframes].find((k) => k.time === t);
                                    if (kf) startDragKeyframe(e, kf.id, e.currentTarget.parentElement as HTMLElement);
                                    else setPlayhead(t);
                                  }}
                                />
                              ))}
                            </div>
                            {isExpanded && (
                              <div>
                                {([
                                  { key: 'posKeyframes' as const, color: 'bg-[#ed7300]' },
                                  { key: 'rotKeyframes' as const, color: 'bg-[#ec5b62]' },
                                  { key: 'sclKeyframes' as const, color: 'bg-[#e68619]' },
                                ]).map((row) => (
                                  <div
                                    key={row.key}
                                    className="h-5 relative border-t border-[#151515] cursor-crosshair"
                                    onPointerDown={startScrub}
                                  >
                                    {track[row.key].map((kf) => (
                                      <div
                                        key={kf.id}
                                        style={{ left: kf.time * pxPerSec }}
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                          startDragKeyframe(e, kf.id, e.currentTarget.parentElement as HTMLElement);
                                        }}
                                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border border-[#0e1016] z-20 cursor-ew-resize ${row.color} ${
                                          selectedKeyframeId === kf.id ? 'ring-2 ring-white scale-110' : ''
                                        }`}
                                      />
                                    ))}
                                  </div>
                                ))}
                                {track.targetType === 'mesh' && (
                                  <>
                                    <div className="h-5 relative border-t border-[#151515]" onPointerDown={startScrub}>
                                      {(track.texFrameKeyframes || []).map((kf) => (
                                        <div
                                          key={kf.id}
                                          style={{ left: kf.time * pxPerSec }}
                                          title={`Tex frame ${Math.round(kf.value.x)}`}
                                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-[#94e2ff] border border-[#0e1016] z-20"
                                          onPointerDown={(e) => {
                                            e.stopPropagation();
                                            setSelectedKeyframeId(kf.id);
                                            setPlayhead(kf.time);
                                          }}
                                        />
                                      ))}
                                    </div>
                                    <div className="h-5 relative border-t border-[#151515]" onPointerDown={startScrub}>
                                      {(track.textureClipKeys || []).map((ck) => (
                                        <div
                                          key={ck.id}
                                          style={{
                                            left: ck.time * pxPerSec,
                                            width: Math.max(8, ((ck.holdUntil ?? ck.time + 0.25) - ck.time) * pxPerSec),
                                          }}
                                          title="Texture clip"
                                          className="absolute top-1 bottom-1 rounded-sm bg-[#e68619]/50 border border-[#e68619] z-20"
                                          onPointerDown={(e) => {
                                            e.stopPropagation();
                                            setSelectedKeyframeId(ck.id);
                                            setPlayhead(ck.time);
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="h-5 shrink-0 border-t border-[#1a1a1a] bg-[#3a3a3a] px-2 flex items-center justify-between text-[8px] font-mono text-[#555]">
            <span>Space play · ←→ frame · Len drag orange end · K key · Del remove · SEQ: +Track / Sub / reorder</span>
            <span>{timelineFocus ? 'Timeline focused · Shift+T max · drag bar to resize' : 'Hover timeline · Shift+T maximize · S/M/L/Max sizes'}</span>
          </div>
        </div>
      )}

      <ParticleStudioModal
        isOpen={particleModalOpen}
        onClose={() => setParticleModalOpen(false)}
        emitter={editingParticle}
        onSave={(emitter) => {
          setParticles((prev) => {
            const idx = prev.findIndex((p) => p.id === emitter.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = emitter;
              return next;
            }
            return [...prev, emitter];
          });
          setSelectedParticleId(emitter.id);
          setEditKind('particle');
          setEditId(emitter.id);
          setLeftTab('particles');
          if (activeClip) {
            setClips((prev) => prev.map((clip) => {
              if (clip.id !== activeClip.id) return clip;
              return ensureTrackForTarget(clip, emitter.id, emitter.name, 'particle', {
                position: emitter.position,
                rotation: emitter.rotation,
                scale: { x: 1, y: 1, z: 1 },
              });
            }));
          }
        }}
      />

      <EnvironmentSettingsModal
        isOpen={envModalOpen}
        onClose={() => setEnvModalOpen(false)}
        environment={environment}
        setEnvironment={setEnvironment}
      />
    </div>
  );
};

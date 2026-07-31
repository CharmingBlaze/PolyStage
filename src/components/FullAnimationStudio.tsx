import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { applyStandardOrbitMouseButtons, bindBlockbenchOrbitModifiers } from '../utils/viewportNav';
import { applyThemedTransformGizmo, VIEWPORT_THEME } from '../utils/viewportTheme';
import {
  Play,
  Pause,
  RotateCcw,
  Film,
  Sparkles,
  Layers,
  Activity,
  Move,
  RotateCw,
  Maximize2,
  Trash2,
  ChevronRight,
  ChevronDown,
  Key,
  Plus,
  Minus,
  Spline,
  SlidersHorizontal,
  Bone,
  Image as ImageIcon,
  Tag,
  Repeat,
  Clapperboard,
} from 'lucide-react';
import type {
  AnimationClip,
  AnimInterpolation,
  AnimKeyframe,
  AnimTrack,
  CADBone,
  CADMesh,
  TextureClipKey,
} from '../types/cad';
import { buildThreeGeometry, buildLogicalEdgeGeometry } from '../utils/meshUtils';
import { attachMeshBvh } from '../utils/bvh';
import { createEmptyClip, evaluateClipAtTime, sampleChannel, insertTextureClipKey, insertTexFrameKeyframe } from '../utils/animation';
import { resolveMeshTextureAtTime } from '../utils/textureAnimation';
import { deformMeshWithBones } from '../utils/rigging';

interface FullAnimationStudioProps {
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  bones?: CADBone[];
  setBones?: React.Dispatch<React.SetStateAction<CADBone[]>>;
  clips: AnimationClip[];
  setClips: React.Dispatch<React.SetStateAction<AnimationClip[]>>;
  activeClipId: string | null;
  setActiveClipId: (id: string | null) => void;
}

export const FullAnimationStudio: React.FC<FullAnimationStudioProps> = ({
  meshes,
  setMeshes,
  bones = [],
  setBones,
  clips,
  setClips,
  activeClipId,
  setActiveClipId,
}) => {
  void setMeshes;
  void setBones;
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const meshesGroupRef = useRef<THREE.Group | null>(null);
  const bonesGroupRef = useRef<THREE.Group | null>(null);
  const meshObjectsRef = useRef<Map<string, { mesh: THREE.Mesh; wire: THREE.LineSegments }>>(new Map());
  const currentTimeRef = useRef(0);
  const activeClipRef = useRef<AnimationClip | null>(null);
  const easingRef = useRef<'smooth' | 'linear' | 'bounce' | 'elastic'>('smooth');
  const needsAnimRenderRef = useRef(true);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0.0);
  const [selectedMeshId, setSelectedMeshId] = useState<string>(meshes[0]?.id || '');
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [timelineMode, setTimelineMode] = useState<'dopesheet' | 'graph'>('dopesheet');
  const [easingCurve, setEasingCurve] = useState<AnimInterpolation>('smooth');
  const [expandedTracks, setExpandedTracks] = useState<Record<string, boolean>>({});
  const [uvClipMenuOpen, setUvClipMenuOpen] = useState(false);

  const handleAddTextureClipKey = (meshId: string, clipId: string) => {
    const t = Math.round(currentTime * 100) / 100;
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          return insertTextureClipKey(c, meshId, t, clipId);
        }
        return c;
      })
    );
    setUvClipMenuOpen(false);
  };

  const handleAddTexFrameKeyframe = (meshId: string, frameIndex = 0) => {
    const t = Math.round(currentTime * 100) / 100;
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          return insertTexFrameKeyframe(c, meshId, t, frameIndex);
        }
        return c;
      })
    );
  };

  const emptyClipFallback = useRef(createEmptyClip('Idle')).current;
  const activeClip = clips.find((c) => c.id === activeClipId) || clips[0] || emptyClipFallback;
  const hasRealClip = clips.length > 0;
  const animationTargets = [
    ...meshes.map((mesh) => ({ id: mesh.id, name: mesh.name, targetType: 'mesh' as const, position: mesh.position, rotation: mesh.rotation, scale: mesh.scale })),
    ...bones.map((bone) => ({ id: bone.id, name: bone.name, targetType: 'bone' as const, position: bone.position, rotation: bone.rotation, scale: bone.scale })),
  ];

  useEffect(() => { currentTimeRef.current = currentTime; needsAnimRenderRef.current = true; }, [currentTime]);
  useEffect(() => { activeClipRef.current = activeClip; needsAnimRenderRef.current = true; }, [activeClip]);
  useEffect(() => { easingRef.current = easingCurve; }, [easingCurve]);
  useEffect(() => {
    if (!hasRealClip || !activeClip || activeClip.interpolation === easingCurve) return;
    setClips((prev) => {
      let changed = false;
      const next = prev.map((clip) => {
        if (clip.id !== activeClip.id || clip.interpolation === easingCurve) return clip;
        changed = true;
        return { ...clip, interpolation: easingCurve };
      });
      return changed ? next : prev;
    });
  }, [activeClip, easingCurve, hasRealClip, setClips]);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2b2b2b');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    rendererRef.current = renderer;

    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    applyStandardOrbitMouseButtons(controls);
    const unbindNavMods = bindBlockbenchOrbitModifiers(controls, renderer.domElement);
    controlsRef.current = controls;

    const tControls = new TransformControls(camera, renderer.domElement);
    applyThemedTransformGizmo(tControls);
    scene.add(tControls.getHelper());
    transformControlsRef.current = tControls;

    tControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
    });

    const gridHelper = new THREE.GridHelper(10, 20, VIEWPORT_THEME.gridMajor, VIEWPORT_THEME.gridMinor);
    gridHelper.position.y = -0.001;
    scene.add(gridHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const mGroup = new THREE.Group();
    scene.add(mGroup);
    meshesGroupRef.current = mGroup;
    const bGroup = new THREE.Group();
    scene.add(bGroup);
    bonesGroupRef.current = bGroup;

    let animationFrameId = 0;
    let visible = document.visibilityState === 'visible';
    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) needsAnimRenderRef.current = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    controls.addEventListener('change', () => { needsAnimRenderRef.current = true; });

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (!visible) return;
      controls.update();
      if (needsAnimRenderRef.current) {
        renderer.render(scene, camera);
        needsAnimRenderRef.current = false;
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      unbindNavMods();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      tControls.dispose();
      controls.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!meshesGroupRef.current || !activeClip) return;
    const mGroup = meshesGroupRef.current;
    const posed = evaluateClipAtTime(activeClip, currentTime, bones, meshes);

    while (mGroup.children.length > 0) {
      const child = mGroup.children[0];
      mGroup.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
    meshObjectsRef.current.clear();

    posed.meshes.forEach((posedMesh) => {
      const skinnedMesh = deformMeshWithBones(posedMesh, posed.bones);
      const geometry = attachMeshBvh(buildThreeGeometry(skinnedMesh));
      const isSelected = posedMesh.id === selectedMeshId;
      const track = activeClip.tracks.find((t) => t.targetId === posedMesh.id && t.targetType === 'mesh');
      const tex = resolveMeshTextureAtTime(posedMesh, track, currentTime);
      const material = new THREE.MeshStandardMaterial({
        vertexColors: !tex.dataUrl,
        roughness: 0.6,
        metalness: 0.2,
      });

      if (tex.dataUrl) {
        const img = new Image();
        img.onload = () => {
          const texture = new THREE.Texture(img);
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = true;
          texture.needsUpdate = true;
          material.map = texture;
          material.needsUpdate = true;
          needsAnimRenderRef.current = true;
        };
        img.src = tex.dataUrl;
      }

      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.position.set(posedMesh.position.x, posedMesh.position.y, posedMesh.position.z);
      meshObj.rotation.set(posedMesh.rotation.x, posedMesh.rotation.y, posedMesh.rotation.z);
      meshObj.scale.set(posedMesh.scale.x, posedMesh.scale.y, posedMesh.scale.z);
      mGroup.add(meshObj);

      const wireGeo = buildLogicalEdgeGeometry(skinnedMesh);
      const wireMat = new THREE.LineBasicMaterial({
        color: isSelected ? VIEWPORT_THEME.hover : VIEWPORT_THEME.idleHandle,
      });
      const wireframe = new THREE.LineSegments(wireGeo, wireMat);
      wireframe.position.copy(meshObj.position);
      wireframe.rotation.copy(meshObj.rotation);
      wireframe.scale.copy(meshObj.scale);
      mGroup.add(wireframe);

      meshObjectsRef.current.set(posedMesh.id, { mesh: meshObj, wire: wireframe });

      if (isSelected && transformControlsRef.current) {
        transformControlsRef.current.attach(meshObj);
      }
    });
    needsAnimRenderRef.current = true;
  }, [meshes, bones, activeClip, currentTime, selectedMeshId]);

  useEffect(() => {
    if (!bonesGroupRef.current || !activeClip) return;
    const group = bonesGroupRef.current;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((object) => {
        const rendered = object as THREE.Mesh;
        rendered.geometry?.dispose();
        const material = rendered.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    }

    const posedBones = evaluateClipAtTime(activeClip, currentTime, bones, meshes).bones;
    const matrices = new Map<string, THREE.Matrix4>();
    const resolve = (bone: CADBone, visiting = new Set<string>()): THREE.Matrix4 => {
      const cached = matrices.get(bone.id);
      if (cached) return cached;
      if (visiting.has(bone.id)) return new THREE.Matrix4();
      visiting.add(bone.id);
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(bone.position.x, bone.position.y, bone.position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(bone.rotation.x, bone.rotation.y, bone.rotation.z)),
        new THREE.Vector3(bone.scale.x, bone.scale.y, bone.scale.z),
      );
      const parent = bone.parentId ? posedBones.find((candidate) => candidate.id === bone.parentId) : null;
      const world = parent ? resolve(parent, visiting).clone().multiply(local) : local;
      matrices.set(bone.id, world);
      return world;
    };
    posedBones.filter((bone) => bone.visible !== false).forEach((bone) => {
      const world = resolve(bone);
      const start = new THREE.Vector3().setFromMatrixPosition(world);
      const end = new THREE.Vector3(0, bone.length, 0).applyMatrix4(world);
      const direction = end.clone().sub(start);
      const length = Math.max(.04, direction.length());
      const selected = bone.id === selectedMeshId;
      const color = new THREE.Color(selected ? '#ffffff' : bone.color || '#ed7300');
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(length * .035, length * .12, length, 6),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: .9 }),
      );
      shaft.position.copy(start).add(end).multiplyScalar(.5);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      shaft.renderOrder = 20;
      group.add(shaft);
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? .1 : .065, 10, 7),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      joint.position.copy(start);
      joint.renderOrder = 21;
      group.add(joint);
    });
    needsAnimRenderRef.current = true;
  }, [bones, meshes, activeClip, currentTime, selectedMeshId]);

  useEffect(() => {
    if (!activeClip) return;
    const clip = activeClip;
    const time = currentTime;

    meshObjectsRef.current.forEach((entry, meshId) => {
      const source = meshes.find((m) => m.id === meshId);
      if (!source) return;
      const track = clip.tracks.find((t) => t.targetId === meshId && t.targetType === 'mesh');

      let pos = { ...source.position };
      let rot = { ...source.rotation };
      let scale = { ...source.scale };

      if (track) {
        pos = sampleChannel(track.posKeyframes, time, clip.interpolation || easingCurve) || source.position;
        rot = sampleChannel(track.rotKeyframes, time, clip.interpolation || easingCurve) || source.rotation;
        scale = sampleChannel(track.sclKeyframes, time, clip.interpolation || easingCurve) || source.scale;
      }

      entry.mesh.position.set(pos.x, pos.y, pos.z);
      entry.mesh.rotation.set(rot.x, rot.y, rot.z);
      entry.mesh.scale.set(scale.x, scale.y, scale.z);
      entry.wire.position.copy(entry.mesh.position);
      entry.wire.rotation.copy(entry.mesh.rotation);
      entry.wire.scale.copy(entry.mesh.scale);
    });
    needsAnimRenderRef.current = true;
  }, [currentTime, activeClip, easingCurve, meshes]);


  useEffect(() => {
    if (!isPlaying || !activeClip) return;

    let raf = 0;
    let last = performance.now();
    let uiAcc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = (now - last) / 1000;
      last = now;
      let next = currentTimeRef.current + delta;
      if (next >= activeClip.duration) {
        if (activeClip.loopMode === 'loop') next = next % activeClip.duration;
        else {
          next = activeClip.duration;
          setIsPlaying(false);
        }
      }
      currentTimeRef.current = next;
      uiAcc += delta;
      // Throttle React state for scrubber UI (~24fps), apply transforms every frame via effect/ref
      if (uiAcc >= 1 / 24 || next === activeClip.duration) {
        uiAcc = 0;
        setCurrentTime(next);
      } else {
        needsAnimRenderRef.current = true;
        // Apply transforms immediately without waiting for React
        const clip = activeClipRef.current;
        if (clip) {
          meshObjectsRef.current.forEach((entry, meshId) => {
            const source = meshes.find((m) => m.id === meshId);
            if (!source) return;
            const track = clip.tracks.find((t) => t.targetId === meshId && t.targetType === 'mesh');
            if (!track) return;
            const interpolation = clip.interpolation || easingRef.current;
            const pos = sampleChannel(track.posKeyframes, next, interpolation) || source.position;
            const rot = sampleChannel(track.rotKeyframes, next, interpolation) || source.rotation;
            const scale = sampleChannel(track.sclKeyframes, next, interpolation) || source.scale;
            entry.mesh.position.set(pos.x, pos.y, pos.z);
            entry.mesh.rotation.set(rot.x, rot.y, rot.z);
            entry.mesh.scale.set(scale.x, scale.y, scale.z);
            entry.wire.position.copy(entry.mesh.position);
            entry.wire.rotation.copy(entry.mesh.rotation);
            entry.wire.scale.copy(entry.mesh.scale);
          });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeClip, meshes]);

  const handleAddTrack = (meshId: string) => {
    const targetMesh = animationTargets.find((target) => target.id === meshId);
    if (!targetMesh) return;

    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          if (c.tracks.some((t) => t.targetId === meshId)) return c;
          const newTrack: AnimTrack = {
            targetId: targetMesh.id,
            targetName: targetMesh.name,
            targetType: targetMesh.targetType,
            posKeyframes: [{ id: `pos_init_${targetMesh.id}`, time: 0, value: { ...targetMesh.position } }],
            rotKeyframes: [{ id: `rot_init_${targetMesh.id}`, time: 0, value: { ...targetMesh.rotation } }],
            sclKeyframes: [{ id: `scl_init_${targetMesh.id}`, time: 0, value: { ...targetMesh.scale } }],
          };
          return { ...c, tracks: [...c.tracks, newTrack] };
        }
        return c;
      })
    );
  };

  const handleSubtractTrack = (meshId: string) => {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          return { ...c, tracks: c.tracks.filter((t) => t.targetId !== meshId) };
        }
        return c;
      })
    );
  };

  const handleAddChannelKeyframe = (meshId: string, channel: 'pos' | 'rot' | 'scl' | 'all') => {
    const targetMesh = animationTargets.find((target) => target.id === meshId);
    if (!targetMesh) return;

    const t = Math.round(currentTime * 100) / 100;

    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          const updatedTracks = c.tracks.map((track) => {
            if (track.targetId === meshId) {
              const nextTrack = { ...track };
              if (channel === 'pos' || channel === 'all') {
                const filtered = track.posKeyframes.filter((k) => Math.abs(k.time - t) > 0.02);
                const keyframe: AnimKeyframe = { id: `pos_${Date.now()}`, time: t, value: { ...targetMesh.position } };
                nextTrack.posKeyframes = [
                  ...filtered,
                  keyframe,
                ].sort((a, b) => a.time - b.time);
              }
              if (channel === 'rot' || channel === 'all') {
                const filtered = track.rotKeyframes.filter((k) => Math.abs(k.time - t) > 0.02);
                const keyframe: AnimKeyframe = { id: `rot_${Date.now()}`, time: t, value: { ...targetMesh.rotation } };
                nextTrack.rotKeyframes = [
                  ...filtered,
                  keyframe,
                ].sort((a, b) => a.time - b.time);
              }
              if (channel === 'scl' || channel === 'all') {
                const filtered = track.sclKeyframes.filter((k) => Math.abs(k.time - t) > 0.02);
                const keyframe: AnimKeyframe = { id: `scl_${Date.now()}`, time: t, value: { ...targetMesh.scale } };
                nextTrack.sclKeyframes = [
                  ...filtered,
                  keyframe,
                ].sort((a, b) => a.time - b.time);
              }
              return nextTrack;
            }
            return track;
          });
          return { ...c, tracks: updatedTracks };
        }
        return c;
      })
    );
  };

  const handleDeleteSelectedKeyframe = () => {
    if (!selectedKeyframeId) return;

    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === activeClip.id) {
          const updatedTracks = c.tracks.map((t) => ({
            ...t,
            posKeyframes: t.posKeyframes.filter((k) => k.id !== selectedKeyframeId),
            rotKeyframes: t.rotKeyframes.filter((k) => k.id !== selectedKeyframeId),
            sclKeyframes: t.sclKeyframes.filter((k) => k.id !== selectedKeyframeId),
          }));
          return { ...c, tracks: updatedTracks };
        }
        return c;
      })
    );
    setSelectedKeyframeId(null);
  };

  const renderRulerTicks = () => {
    const ticks = [];
    const step = 0.2;
    const count = Math.floor(activeClip.duration / step);

    for (let i = 0; i <= count; i++) {
      const timeVal = i * step;
      const pct = (timeVal / activeClip.duration) * 100;
      const isMajor = i % 5 === 0;

      ticks.push(
        <div key={i} style={{ left: `${pct}%` }} className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none">
          <div className={`w-px ${isMajor ? 'h-3 bg-[#ed7300]' : 'h-1.5 bg-[#404040]'}`} />
          {isMajor && <span className="text-[9px] font-mono text-[#ed7300] mt-0.5">{timeVal.toFixed(1)}s</span>}
        </div>
      );
    }
    return ticks;
  };

  const unTrackedMeshes = animationTargets.filter((target) => !activeClip.tracks.some((track) => track.targetId === target.id));

  return (
    <div className="flex flex-col h-full w-full bg-[#2b2b2b] text-[#e8e8e8] font-sans select-none overflow-hidden">
      {/* Upper Area: 3D Viewport + Left Clip Inspector */}
      <div className="flex-1 flex overflow-hidden border-b border-[#4d4d4d] relative">
        <div className="w-60 bg-[#333333] border-r border-[#4d4d4d] flex flex-col z-10">
          <div className="h-8 bg-[#333333] border-b border-[#4d4d4d] px-3 flex items-center justify-between font-mono text-[10px] text-[#ed7300] font-bold">
            <span className="flex items-center gap-1.5 uppercase">
              <Film className="w-3.5 h-3.5 text-[#ed7300]" />
              CLIPS LIBRARY
            </span>
            <button
              onClick={() => {
                const newClip: AnimationClip = {
                  ...createEmptyClip(`Clip ${clips.length + 1}`, 2.0, 24),
                  tracks: animationTargets.map((m): AnimTrack => ({
                    targetId: m.id,
                    targetName: m.name,
                    targetType: m.targetType,
                    posKeyframes: [{ id: `pos_s_${m.id}`, time: 0, value: { ...m.position } }],
                    rotKeyframes: [{ id: `rot_s_${m.id}`, time: 0, value: { ...m.rotation } }],
                    sclKeyframes: [{ id: `scl_s_${m.id}`, time: 0, value: { ...m.scale } }],
                  })),
                };
                setClips((prev) => [...prev, newClip]);
                setActiveClipId(newClip.id);
              }}
              className="px-2 py-0.5 cad-button text-[#ed7300] text-[9px] font-bold"
            >
              + Clip
            </button>
          </div>

          <div className="p-2 space-y-3 overflow-y-auto custom-scrollbar flex-1">
            <div className="space-y-1">
              {clips.map((clip) => {
                const isActive = clip.id === activeClipId;
                return (
                  <div
                    key={clip.id}
                    onClick={() => {
                      setActiveClipId(clip.id);
                      setCurrentTime(0);
                    }}
                    className={`p-2 rounded border flex items-center justify-between cursor-pointer font-mono text-xs transition ${
                      isActive
                        ? 'bg-[rgba(20,115,230,0.22)] border-[#ed7300] text-[#ed7300] font-bold shadow-md shadow-none'
                        : 'bg-[#262626] border-[#4d4d4d] text-[#b3b3b3] hover:border-[#4d4d4d]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className={`w-3.5 h-3.5 ${isActive ? 'text-[#ed7300]' : 'text-[#8c8c8c]'}`} />
                      <span>{clip.name}</span>
                    </div>
                    <span className="text-[10px] text-[#8c8c8c] font-mono">{clip.duration}s</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 h-full relative bg-[#2b2b2b]">
          <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none z-10 font-mono text-[10px]">
            <span className="cad-card px-2.5 py-1 text-[#ed7300] font-bold border-[#4d4d4d] uppercase flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#ed7300]" />
              ANIMATION STUDIO VIEWPORT
            </span>
            <span className="cad-card px-2.5 py-1 text-[#ed7300]">
              SCRUB: {currentTime.toFixed(2)}s / {activeClip?.duration}s
            </span>
          </div>
        </div>
      </div>

      {/* Lower Area: Professional Multi-Track Timecode Timeline Container */}
      <div className="h-72 bg-[#0a0d14] border-t border-[#4d4d4d] flex flex-col select-none">
        {/* Top Transport & Action Toolbar */}
        <div className="h-10 bg-[#333333] border-b border-[#4d4d4d] px-4 flex items-center justify-between font-mono text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-1.5 rounded-full shadow-lg transition flex items-center justify-center ${
                isPlaying ? 'bg-[#e68619] text-white shadow-none' : 'bg-[#ed7300] text-white shadow-none'
              }`}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={() => {
                setIsPlaying(false);
                setCurrentTime(0);
              }}
              className="p-1.5 cad-button text-[#8c8c8c] hover:text-white"
              title="Rewind to 0.0s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <div className="font-mono text-xs font-bold text-[#ed7300] bg-[#2b2b2b] px-3 py-1 rounded border border-[#4d4d4d]">
              {currentTime.toFixed(2)}s / {activeClip.duration.toFixed(2)}s
            </div>

            {/* Dope Sheet vs Graph Curve View Switcher */}
            <div className="flex items-center gap-1 bg-[#2b2b2b] p-0.5 rounded border border-[#4d4d4d]">
              <button
                onClick={() => setTimelineMode('dopesheet')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                  timelineMode === 'dopesheet' ? 'bg-[#ed7300] text-white shadow-sm' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>DOPE SHEET</span>
              </button>
              <button
                onClick={() => setTimelineMode('graph')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                  timelineMode === 'graph' ? 'bg-[#ed7300] text-white shadow-sm' : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                <Spline className="w-3 h-3" />
                <span>GRAPH CURVES</span>
              </button>
            </div>

            <div className="flex items-center gap-1 bg-[#2b2b2b] px-2 py-0.5 rounded border border-[#4d4d4d]">
              <span className="text-[9px] text-[#8c8c8c] uppercase">CURVE:</span>
              <button
                onClick={() => setEasingCurve('smooth')}
                className={`px-1.5 py-0.5 rounded text-[9px] ${
                  easingCurve === 'smooth' ? 'bg-[#ed7300] text-white font-bold' : 'text-[#8c8c8c]'
                }`}
              >
                SMOOTH
              </button>
              <button
                onClick={() => setEasingCurve('bounce')}
                className={`px-1.5 py-0.5 rounded text-[9px] ${
                  easingCurve === 'bounce' ? 'bg-[#ed7300] text-white font-bold' : 'text-[#8c8c8c]'
                }`}
              >
                BOUNCE
              </button>
            </div>
          </div>

          {/* Keyframe & Track Actions */}
          <div className="flex items-center gap-2">
            {/* Add / Subtract Track Selector */}
            {unTrackedMeshes.length > 0 && (
              <button
                onClick={() => handleAddTrack(unTrackedMeshes[0].id)}
                className="px-2 py-1 cad-button text-[#e68619] font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
                title="Add Track for Mesh"
              >
                <Plus className="w-3 h-3 text-[#e68619]" />
                <span>+ TRACK</span>
              </button>
            )}

            <button
              onClick={() => handleAddChannelKeyframe(selectedMeshId, 'pos')}
              className="px-2 py-1 cad-button text-[#ed7300] font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
            >
              <Move className="w-3 h-3 text-[#ed7300]" />
              <span>+ POS</span>
            </button>
            <button
              onClick={() => handleAddChannelKeyframe(selectedMeshId, 'rot')}
              className="px-2 py-1 cad-button text-[#ec5b62] font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
            >
              <RotateCw className="w-3 h-3 text-[#ec5b62]" />
              <span>+ ROT</span>
            </button>
            <button
              onClick={() => handleAddChannelKeyframe(selectedMeshId, 'scl')}
              className="px-2 py-1 cad-button text-[#e68619] font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
            >
              <Maximize2 className="w-3 h-3 text-[#e68619]" />
              <span>+ SCL</span>
            </button>
            <button
              onClick={() => handleAddChannelKeyframe(selectedMeshId, 'all')}
              className="px-2.5 py-1 bg-[#ed7300] text-white font-bold rounded shadow-md shadow-none text-[10px] flex items-center gap-1"
            >
              <Key className="w-3 h-3 text-white" />
              <span>+ ALL KEY</span>
            </button>

            {/* UV Texture Animation Clip Trigger Key */}
            <div className="relative">
              <button
                onClick={() => setUvClipMenuOpen((v) => !v)}
                className="px-2 py-1 cad-button text-emerald-400 font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
                title="Trigger UV Texture Animation Clip (Talk, Blink, Dialog, etc.)"
              >
                <Clapperboard className="w-3 h-3 text-emerald-400" />
                <span>+ UV CLIP</span>
              </button>

              {uvClipMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-[#1a1a1a] border border-[#4d4d4d] rounded shadow-2xl p-1.5 text-xs font-mono">
                  <div className="text-[9px] uppercase tracking-wide text-[#8c8c8c] px-1 py-0.5 border-b border-[#1a1a1a] mb-1 font-bold">
                    Select UV Animation Clip
                  </div>
                  {(() => {
                    const selMesh = meshes.find((m) => m.id === selectedMeshId);
                    const clipsList = selMesh?.textureAnimation?.clips?.length
                      ? selMesh.textureAnimation.clips
                      : [
                          { id: 'idle', name: 'Idle', loop: true },
                          { id: 'talk', name: 'Talk', loop: true },
                          { id: 'blink', name: 'Blink', loop: false },
                        ];
                    return clipsList.map((clip) => (
                      <button
                        key={clip.id}
                        onClick={() => handleAddTextureClipKey(selectedMeshId, clip.id)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-[#ed7300]/20 hover:text-[#ed7300] flex items-center justify-between text-[11px] font-semibold text-[#d8d8d8]"
                      >
                        <span className="truncate">{clip.name}</span>
                        <span className="text-[8px] opacity-60 uppercase">{clip.loop ? 'loop' : 'once'}</span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>

            <button
              onClick={() => handleAddTexFrameKeyframe(selectedMeshId, 0)}
              className="px-2 py-1 cad-button text-cyan-400 font-bold border-[#4d4d4d] text-[10px] flex items-center gap-1"
              title="Add Texture Frame Index Keyframe"
            >
              <ImageIcon className="w-3 h-3 text-cyan-400" />
              <span>+ TEX FRAME</span>
            </button>

            {selectedKeyframeId && (
              <button
                onClick={handleDeleteSelectedKeyframe}
                className="px-2 py-1 bg-[#ec5b62] text-white font-bold rounded text-[10px] flex items-center gap-1"
                title="Delete Selected Keyframe"
              >
                <Trash2 className="w-3 h-3" />
                <span>DEL KEY</span>
              </button>
            )}
          </div>
        </div>

        {/* Timeline Tracks Header & Time Ruler Scale */}
        <div className="flex border-b border-[#4d4d4d] bg-[#2d2d2d]">
          <div className="w-56 px-3 py-1 border-r border-[#4d4d4d] font-mono text-[10px] text-[#8c8c8c] uppercase font-bold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#ed7300]" />
            <span>TRACKS & SUBTRACKS</span>
          </div>

          <div className="flex-1 relative h-6 overflow-hidden">
            {renderRulerTicks()}

            <div
              style={{ left: `${(currentTime / activeClip.duration) * 100}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-[#ec5b62] z-30 shadow-md shadow-none"
            >
              <div className="w-2.5 h-2.5 bg-[#ec5b62] transform -translate-x-1/2 rotate-45 -top-1 absolute rounded-sm" />
            </div>
          </div>
        </div>

        {/* Timeline Mode Switcher View: DOPE SHEET vs GRAPH CURVES */}
        {timelineMode === 'graph' ? (
          /* Graph Curve Vector Mode View */
          <div className="flex-1 relative bg-[#06090f] p-4 flex items-center justify-center">
            <svg className="w-full h-full overflow-visible">
              {/* Grid Lines */}
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#404040" strokeDasharray="4 4" />

              {/* Real-Time SVG Easing Curves for Active Selected Mesh Track */}
              {activeClip.tracks
                .filter((t) => t.targetId === selectedMeshId)
                .map((t) => {
                  const posPath = t.posKeyframes
                    .sort((a, b) => a.time - b.time)
                    .map((k, idx) => {
                      const x = (k.time / activeClip.duration) * 800;
                      const y = 100 - k.value.y * 30;
                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                    })
                    .join(' ');

                  return (
                    <g key={t.targetId}>
                      <path d={posPath} fill="none" stroke="#ed7300" strokeWidth="2.5" />
                    </g>
                  );
                })}
            </svg>
            <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-[10px] font-mono text-[#ed7300] border border-[#4d4d4d]">
              BEZIER CURVE GRAPH VIEW
            </div>
          </div>
        ) : (
          /* Standard Multi-Track Dope Sheet View */
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#3a3a3a]">
            {activeClip.tracks.map((track) => {
              const isSelected = track.targetId === selectedMeshId;
              const isExpanded = expandedTracks[track.targetId] ?? false;

              return (
                <div key={track.targetId} className="border-b border-[#182333]">
                  {/* Master Object Track Row */}
                  <div
                    onClick={() => setSelectedMeshId(track.targetId)}
                    className={`flex h-8 items-center transition cursor-pointer font-mono text-xs ${
                      isSelected ? 'bg-[rgba(237,115,0,0.18)]/40 border-l-2 border-[#ed7300]' : 'bg-[#0f1622] hover:bg-[#151f2e]'
                    }`}
                  >
                    <div className="w-56 px-3 flex items-center justify-between border-r border-[#4d4d4d]">
                      <div
                        className="flex items-center gap-1.5 font-bold truncate flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTracks((prev) => ({ ...prev, [track.targetId]: !prev[track.targetId] }));
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#ed7300]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                        )}
                        {track.targetType === 'bone' && <Bone className="w-3 h-3 text-[#ed7300]"/>}
                        <span className={isSelected ? 'text-[#ed7300]' : 'text-[#e8e8e8]'}>{track.targetName}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSubtractTrack(track.targetId);
                          }}
                          className="p-1 text-[#8c8c8c] hover:text-[#ec5b62]"
                          title="Subtract / Remove Track"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddChannelKeyframe(track.targetId, 'all');
                          }}
                          className="p-1 text-[#8c8c8c] hover:text-[#ed7300]"
                          title="Key All Channels"
                        >
                          <Key className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Master Keyframe Track Line */}
                    <div className="flex-1 relative h-full flex items-center px-2">
                      <div className="absolute inset-x-0 h-px bg-[#1a1a1a]" />

                      {Array.from(
                        new Set([
                          ...track.posKeyframes.map((k) => k.time),
                          ...track.rotKeyframes.map((k) => k.time),
                          ...track.sclKeyframes.map((k) => k.time),
                        ])
                      ).map((t) => {
                        const pct = (t / activeClip.duration) * 100;
                        return (
                          <div
                            key={t}
                            style={{ left: `${pct}%` }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentTime(t);
                            }}
                            className="absolute transform -translate-x-1/2 w-3.5 h-3.5 bg-[#ed7300] rotate-45 border-2 border-[#1a1a1a] cursor-pointer hover:bg-[#ed7300] transition z-20 shadow-md shadow-none"
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Sub-Track Channels (POSITION, ROTATION, SCALE) */}
                  {isExpanded && (
                    <div className="bg-[#3a3a3a] space-y-px">
                      {/* Position Sub-Track */}
                      <div className="flex h-6 items-center font-mono text-[10px]">
                        <div className="w-56 pl-8 pr-3 flex items-center gap-1.5 text-[#ed7300] font-bold border-r border-[#4d4d4d]">
                          <Move className="w-3 h-3 text-[#ed7300]" />
                          <span>Position (XYZ)</span>
                        </div>
                        <div className="flex-1 relative h-full flex items-center px-2">
                          <div className="absolute inset-x-0 h-px bg-[rgba(237,115,0,0.18)]" />
                          {track.posKeyframes.map((kf) => {
                            const pct = (kf.time / activeClip.duration) * 100;
                            const isKfSelected = selectedKeyframeId === kf.id;
                            return (
                              <div
                                key={kf.id}
                                style={{ left: `${pct}%` }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedKeyframeId(kf.id);
                                  setCurrentTime(kf.time);
                                }}
                                className={`absolute transform -translate-x-1/2 w-3 h-3 bg-[#ed7300] rotate-45 border border-[#1a1a1a] cursor-pointer transition z-20 ${
                                  isKfSelected ? 'ring-2 ring-white bg-white scale-125 z-30' : 'hover:bg-[#ed7300]'
                                }`}
                                title={`Position Keyframe at ${kf.time.toFixed(2)}s`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Rotation Sub-Track */}
                      <div className="flex h-6 items-center font-mono text-[10px]">
                        <div className="w-56 pl-8 pr-3 flex items-center gap-1.5 text-[#ec5b62] font-bold border-r border-[#4d4d4d]">
                          <RotateCw className="w-3 h-3 text-[#ec5b62]" />
                          <span>Rotation (XYZ)</span>
                        </div>
                        <div className="flex-1 relative h-full flex items-center px-2">
                          <div className="absolute inset-x-0 h-px bg-[rgba(237,115,0,0.12)]" />
                          {track.rotKeyframes.map((kf) => {
                            const pct = (kf.time / activeClip.duration) * 100;
                            const isKfSelected = selectedKeyframeId === kf.id;
                            return (
                              <div
                                key={kf.id}
                                style={{ left: `${pct}%` }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedKeyframeId(kf.id);
                                  setCurrentTime(kf.time);
                                }}
                                className={`absolute transform -translate-x-1/2 w-3 h-3 bg-[#ed7300] rotate-45 border border-[#1a1a1a] cursor-pointer transition z-20 ${
                                  isKfSelected ? 'ring-2 ring-white bg-[#3a3a3a] scale-125 z-30' : 'hover:bg-[#ed7300]'
                                }`}
                                title={`Rotation Keyframe at ${kf.time.toFixed(2)}s`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Scale Sub-Track */}
                      <div className="flex h-6 items-center font-mono text-[10px]">
                        <div className="w-56 pl-8 pr-3 flex items-center gap-1.5 text-[#e68619] font-bold border-r border-[#4d4d4d]">
                          <Maximize2 className="w-3 h-3 text-[#e68619]" />
                          <span>Scale (XYZ)</span>
                        </div>
                        <div className="flex-1 relative h-full flex items-center px-2">
                          <div className="absolute inset-x-0 h-px bg-[rgba(230,134,25,0.12)]" />
                          {track.sclKeyframes.map((kf) => {
                            const pct = (kf.time / activeClip.duration) * 100;
                            const isKfSelected = selectedKeyframeId === kf.id;
                            return (
                              <div
                                key={kf.id}
                                style={{ left: `${pct}%` }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedKeyframeId(kf.id);
                                  setCurrentTime(kf.time);
                                }}
                                className={`absolute transform -translate-x-1/2 w-3 h-3 bg-[#e68619] rotate-45 border border-[#1a1a1a] cursor-pointer transition z-20 ${
                                  isKfSelected ? 'ring-2 ring-white bg-[#3a3a3a] scale-125 z-30' : 'hover:bg-[#e68619]'
                                }`}
                                title={`Scale Keyframe at ${kf.time.toFixed(2)}s`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* UV Texture Clips Sub-Track (Mesh targets only) */}
                      {track.targetType === 'mesh' && (
                        <div className="flex h-6 items-center font-mono text-[10px]">
                          <div className="w-56 pl-8 pr-3 flex items-center gap-1.5 text-emerald-400 font-bold border-r border-[#4d4d4d]">
                            <Clapperboard className="w-3 h-3 text-emerald-400" />
                            <span>UV Texture Clips</span>
                          </div>
                          <div className="flex-1 relative h-full flex items-center px-2">
                            <div className="absolute inset-x-0 h-px bg-emerald-500/20" />
                            {(track.textureClipKeys || []).map((ck) => {
                              const pct = (ck.time / activeClip.duration) * 100;
                              const targetMesh = meshes.find((m) => m.id === track.targetId);
                              const foundClip = targetMesh?.textureAnimation?.clips?.find((c) => c.id === ck.clipId);
                              const clipName = foundClip?.name || ck.clipId;
                              return (
                                <div
                                  key={ck.id}
                                  style={{ left: `${pct}%` }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentTime(ck.time);
                                  }}
                                  className="absolute transform -translate-x-1/2 px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[8px] font-bold cursor-pointer hover:bg-emerald-500 transition z-20 shadow-md border border-[#1a1a1a] flex items-center gap-1"
                                  title={`UV Clip Trigger '${clipName}' at ${ck.time.toFixed(2)}s`}
                                >
                                  <Repeat className="w-2.5 h-2.5" />
                                  <span>{clipName}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* UV Frame Index Sub-Track (Mesh targets only) */}
                      {track.targetType === 'mesh' && track.texFrameKeyframes && track.texFrameKeyframes.length > 0 && (
                        <div className="flex h-6 items-center font-mono text-[10px]">
                          <div className="w-56 pl-8 pr-3 flex items-center gap-1.5 text-cyan-400 font-bold border-r border-[#4d4d4d]">
                            <ImageIcon className="w-3 h-3 text-cyan-400" />
                            <span>UV Frame Index</span>
                          </div>
                          <div className="flex-1 relative h-full flex items-center px-2">
                            <div className="absolute inset-x-0 h-px bg-[rgba(237,115,0,0.16)]" />
                            {track.texFrameKeyframes.map((kf) => {
                              const pct = (kf.time / activeClip.duration) * 100;
                              return (
                                <div
                                  key={kf.id}
                                  style={{ left: `${pct}%` }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentTime(kf.time);
                                  }}
                                  className="absolute transform -translate-x-1/2 px-1 py-0.2 bg-cyan-600 text-white rounded text-[8px] font-mono font-bold cursor-pointer hover:bg-cyan-500 transition z-20 border border-[#1a1a1a]"
                                  title={`Texture Frame ${kf.value.x} at ${kf.time.toFixed(2)}s`}
                                >
                                  f{kf.value.x}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

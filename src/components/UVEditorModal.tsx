import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildThreeGeometry } from '../utils/meshUtils';
import {
  Box, Check, Compass, Download, FilePlus, FlipHorizontal, FlipVertical, Grid3X3, ImagePlus, Layers,
  Maximize2, Minimize2, Move, RotateCcw, RotateCw, ScanSearch, Sparkles,
  X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { CADMesh, Face, UVCoord } from '../types/cad';

interface UV3DPreviewProps {
  mesh: CADMesh;
  selectedFaceIds: string[];
  textureCanvas: HTMLCanvasElement | null;
}

const UV3DPreview: React.FC<UV3DPreviewProps> = ({ mesh, selectedFaceIds, textureCanvas }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const wireframeRef = useRef<THREE.LineSegments | null>(null);
  const highlightsGroupRef = useRef<THREE.Group | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111318');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000);
    camera.position.set(2.5, 2, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.65);
    keyLight.position.set(5, 8, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 4, -5);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(6, 12, 0x3b3f46, 0x212327);
    grid.position.y = -0.001;
    scene.add(grid);

    const highlights = new THREE.Group();
    scene.add(highlights);
    highlightsGroupRef.current = highlights;

    let active = true;
    const animate = () => {
      if (!active) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
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
      active = false;
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      if (Array.isArray(meshRef.current.material)) {
        meshRef.current.material.forEach((m) => m.dispose());
      } else {
        meshRef.current.material.dispose();
      }
      meshRef.current = null;
    }
    if (wireframeRef.current) {
      scene.remove(wireframeRef.current);
      wireframeRef.current.geometry.dispose();
      (wireframeRef.current.material as THREE.Material).dispose();
      wireframeRef.current = null;
    }
    if (highlightsGroupRef.current) {
      while (highlightsGroupRef.current.children.length > 0) {
        const child = highlightsGroupRef.current.children[0] as THREE.Mesh;
        highlightsGroupRef.current.remove(child);
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const geo = buildThreeGeometry(mesh);

    let texture = textureRef.current;
    if (textureCanvas) {
      if (!texture) {
        texture = new THREE.CanvasTexture(textureCanvas);
        textureRef.current = texture;
      } else {
        texture.image = textureCanvas;
        texture.needsUpdate = true;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture || null,
      color: texture ? 0xffffff : 0xa5a6a8,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const mMesh = new THREE.Mesh(geo, material);
    scene.add(mMesh);
    meshRef.current = mMesh;

    const box = new THREE.Box3().setFromObject(mMesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    mMesh.position.sub(center);

    const wireGeo = new THREE.WireframeGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x3b3f46, linewidth: 1 });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    scene.add(wireframe);
    wireframeRef.current = wireframe;

    if (highlightsGroupRef.current && selectedFaceIds.length > 0) {
      const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
      mesh.faces.forEach((f) => {
        if (!selectedFaceIds.includes(f.id)) return;
        const fVerts = f.vertexIds.map((vId) => vertMap.get(vId)!).filter(Boolean);
        if (fVerts.length < 3) return;

        const positions: number[] = [];
        for (let i = 1; i < fVerts.length - 1; i++) {
          const p0 = fVerts[0];
          const p1 = fVerts[i];
          const p2 = fVerts[i + 1];
          positions.push(
            p0.x - center.x, p0.y - center.y, p0.z - center.z,
            p1.x - center.x, p1.y - center.y, p1.z - center.z,
            p2.x - center.x, p2.y - center.y, p2.z - center.z
          );
        }

        const faceGeo = new THREE.BufferGeometry();
        faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        faceGeo.computeVertexNormals();

        const faceMat = new THREE.MeshBasicMaterial({
          color: 0xed7300,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });

        const faceMesh = new THREE.Mesh(faceGeo, faceMat);
        highlightsGroupRef.current?.add(faceMesh);
      });
    }
  }, [mesh, selectedFaceIds, textureCanvas]);

  return <div ref={containerRef} className="w-full h-full absolute inset-0 overflow-hidden" />;
};
import {
  boxUnwrapFaces,
  cylindricalUnwrapFaces,
  fitUVsToUnitSquare,
  getFaceUVBounds,
  mirrorFaceUVs,
  packUVIslandsGrid,
  planarProjectFaces,
  rotateUVs,
  scaleUVs,
  smartUnwrapFaces,
  snapFacesToGrid,
  sphericalUnwrapFaces,
  translateUVs,
} from '../utils/uvAdvanced';
import { resetMeshUVs } from '../utils/uvUnwrapUtils';

interface UVEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  meshes?: CADMesh[];
  activeMeshId?: string;
  onSelectMesh?: (meshId: string) => void;
  selectedFaceIds: string[];
  setSelectedFaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  textureCanvas: HTMLCanvasElement | null;
  onTextureUpdated?: (canvas: HTMLCanvasElement) => void;
}

type SelectMode = 'face' | 'vertex' | 'island';
type DragState =
  | { type: 'pan'; x: number; y: number; startX: number; startY: number }
  | { type: 'faces'; u: number; v: number; ids: string[] }
  | { type: 'vertex'; faceId: string; index: number }
  | null;

const clamp = (n: number) => Math.max(0, Math.min(1, n));

function pointInFace(u: number, v: number, face: Face) {
  let inside = false;
  for (let i = 0, j = face.uvs.length - 1; i < face.uvs.length; j = i++) {
    const a = face.uvs[i], b = face.uvs[j];
    if ((a.v > v) !== (b.v > v) && u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

function islandFor(mesh: CADMesh, seedId: string) {
  const uvConnected = (a: Face, b: Face) => {
    const shared = a.vertexIds.filter((id) => b.vertexIds.includes(id));
    if (shared.length < 2) return false;
    return shared.every((id) => {
      const ai = a.vertexIds.indexOf(id);
      const bi = b.vertexIds.indexOf(id);
      const auv = a.uvs[ai], buv = b.uvs[bi];
      return auv && buv && Math.hypot(auv.u - buv.u, auv.v - buv.v) < 0.0001;
    });
  };
  const result = new Set([seedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const face of mesh.faces) {
      if (result.has(face.id)) continue;
      const touches = mesh.faces.some((selected) => result.has(selected.id) && uvConnected(selected, face));
      if (touches) {
        result.add(face.id);
        changed = true;
      }
    }
  }
  return [...result];
}

function overlapIds(mesh: CADMesh) {
  const ids = new Set<string>();
  for (let i = 0; i < mesh.faces.length; i++) {
    const a = getFaceUVBounds(mesh.faces[i].uvs);
    for (let j = i + 1; j < mesh.faces.length; j++) {
      const b = getFaceUVBounds(mesh.faces[j].uvs);
      if (a.minU < b.maxU && a.maxU > b.minU && a.minV < b.maxV && a.maxV > b.minV) {
        ids.add(mesh.faces[i].id);
        ids.add(mesh.faces[j].id);
      }
    }
  }
  return ids;
}

export const UVEditorModal: React.FC<UVEditorModalProps> = ({
  isOpen, onClose, mesh, setMesh, meshes = [], activeMeshId, onSelectMesh,
  selectedFaceIds, setSelectedFaceIds, textureCanvas, onTextureUpdated,
}) => {
  const [mode, setMode] = useState<SelectMode>('island');
  const [activeFaceId, setActiveFaceId] = useState(mesh.faces[0]?.id || '');
  const [activeVertex, setActiveVertex] = useState<{ faceId: string; index: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapDivisions, setSnapDivisions] = useState(32);
  const [padding, setPadding] = useState(0.035);
  const [showTexture, setShowTexture] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showOverlap, setShowOverlap] = useState(true);
  const [maximized, setMaximized] = useState(true);
  const [cursorUv, setCursorUv] = useState<UVCoord | null>(null);
  const [show3DPreview, setShow3DPreview] = useState(true);
  const [newImageModalOpen, setNewImageModalOpen] = useState(false);
  const [newImageSize, setNewImageSize] = useState<number>(256);
  const [newImageCustomSize, setNewImageCustomSize] = useState('');
  const [newImageBg, setNewImageBg] = useState<'transparent' | 'white' | 'dark' | 'grid'>('transparent');
  const [saveAsModalOpen, setSaveAsModalOpen] = useState(false);
  const [saveAsFilename, setSaveAsFilename] = useState('');
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);

  const selected = selectedFaceIds.length ? selectedFaceIds : activeFaceId ? [activeFaceId] : [];
  const overlaps = useMemo(() => overlapIds(mesh), [mesh]);
  const textureUrl = useMemo(() => textureCanvas?.toDataURL() || '', [textureCanvas]);

  const handleCreateNewImage = (size: number, bg: 'transparent' | 'white' | 'dark' | 'grid') => {
    setNewImageModalOpen(false);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      if (bg === 'white') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
      } else if (bg === 'dark') {
        ctx.fillStyle = '#21242c';
        ctx.fillRect(0, 0, size, size);
      } else if (bg === 'grid') {
        ctx.fillStyle = '#1e2128';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#282c35';
        const step = Math.max(8, Math.floor(size / 16));
        for (let y = 0; y < size; y += step) {
          for (let x = 0; x < size; x += step) {
            if ((Math.floor(x / step) + Math.floor(y / step)) % 2 === 0) {
              ctx.fillRect(x, y, step, step);
            }
          }
        }
      } else {
        ctx.clearRect(0, 0, size, size);
      }
    }
    if (onTextureUpdated) {
      onTextureUpdated(canvas);
    }
    setShowTexture(true);
  };

  const handleLoadImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, img.naturalWidth);
            canvas.height = Math.max(1, img.naturalHeight);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
              onTextureUpdated?.(canvas);
              setShowTexture(true);
            }
          };
          img.src = reader.result;
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleSaveImageAs = (name: string) => {
    if (!textureCanvas) return;
    let clean = name.trim();
    if (!clean) clean = (mesh?.name || 'texture').replace(/[^a-zA-Z0-9_\-]/g, '_') + '_uv';
    if (!clean.toLowerCase().endsWith('.png')) clean += '.png';
    const a = document.createElement('a');
    a.href = textureCanvas.toDataURL('image/png');
    a.download = clean;
    a.click();
    setSaveAsModalOpen(false);
  };

  useEffect(() => {
    setActiveFaceId(mesh.faces[0]?.id || '');
    setActiveVertex(null);
    dragRef.current = null;
  }, [mesh.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSelectedFaceIds(mesh.faces.map((f) => f.id));
      } else if (e.key.toLowerCase() === 'r') rotateSelected(e.shiftKey ? -90 : 90);
      else if (e.key.toLowerCase() === 'f') fitSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const uvFromEvent = (e: React.PointerEvent) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { u: clamp((e.clientX - rect.left) / rect.width), v: clamp((e.clientY - rect.top) / rect.height) };
  };

  const apply = (fn: (m: CADMesh, ids: string[]) => CADMesh, ids = selected) => {
    if (ids.length) setMesh(fn(mesh, ids));
  };
  const rotateSelected = (degrees: number) => apply((m, ids) => rotateUVs(m, ids, degrees, undefined, snapDivisions));
  const fitSelected = () => apply((m, ids) => fitUVsToUnitSquare(m, ids, padding));

  const onPointerDown = (e: React.PointerEvent) => {
    // RMB / MMB pan · wheel zooms — LMB for UV tools
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      dragRef.current = { type: 'pan', x: pan.x, y: pan.y, startX: e.clientX, startY: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const uv = uvFromEvent(e);
    if (!uv) return;

    if (mode === 'vertex') {
      let hit: { faceId: string; index: number; d: number } | null = null;
      for (const face of mesh.faces) face.uvs.forEach((p, index) => {
        const d = Math.hypot(p.u - uv.u, p.v - uv.v);
        if (!hit || d < hit.d) hit = { faceId: face.id, index, d };
      });
      if (hit && (hit as { d: number }).d < 0.022 / zoom) {
        const point = hit as { faceId: string; index: number; d: number };
        setActiveFaceId(point.faceId);
        setSelectedFaceIds([point.faceId]);
        setActiveVertex({ faceId: point.faceId, index: point.index });
        dragRef.current = { type: 'vertex', faceId: point.faceId, index: point.index };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    const hitFace = [...mesh.faces].reverse().find((face) => pointInFace(uv.u, uv.v, face));
    if (!hitFace) {
      if (!e.shiftKey) setSelectedFaceIds([]);
      return;
    }
    setActiveFaceId(hitFace.id);
    setActiveVertex(null);
    const hitIds = mode === 'island' ? islandFor(mesh, hitFace.id) : [hitFace.id];
    const nextIds = e.shiftKey
      ? [...new Set([...selectedFaceIds, ...hitIds])].filter((id) => !(selectedFaceIds.includes(id) && hitIds.includes(id)))
      : hitIds;
    setSelectedFaceIds(nextIds);
    dragRef.current = { type: 'faces', u: uv.u, v: uv.v, ids: nextIds.length ? nextIds : hitIds };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const uv = uvFromEvent(e);
    setCursorUv(uv);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'pan') {
      setPan({ x: drag.x + e.clientX - drag.startX, y: drag.y + e.clientY - drag.startY });
      return;
    }
    if (!uv) return;
    if (drag.type === 'vertex') {
      const snapped = snapDivisions ? {
        u: Math.round(uv.u * snapDivisions) / snapDivisions,
        v: Math.round(uv.v * snapDivisions) / snapDivisions,
      } : uv;
      setMesh({
        ...mesh,
        faces: mesh.faces.map((face) => face.id === drag.faceId
          ? { ...face, uvs: face.uvs.map((p, i) => i === drag.index ? snapped : p) }
          : face),
      });
    } else {
      const du = uv.u - drag.u, dv = uv.v - drag.v;
      dragRef.current = { ...drag, u: uv.u, v: uv.v };
      setMesh(translateUVs(mesh, drag.ids, du, dv, snapDivisions));
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no capture */ }
  };

  const iconButton = 'adobe-control h-8 px-2.5';
  const modeButton = (active: boolean) => `${iconButton} ${active ? 'is-active' : ''}`;

  return createPortal(
    <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md p-3 flex items-center justify-center">
      <div className={`adobe-workspace flex flex-col overflow-hidden rounded-lg border border-[#3a3f4a] shadow-2xl ${maximized ? 'w-full h-full' : 'w-[1100px] h-[760px]'}`}>
        <header className="adobe-panel-header h-12 shrink-0 px-4 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-[rgba(237,115,0,.18)] text-[#00b4c4] flex items-center justify-center shrink-0"><Box size={17} /></div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">UV Atlas Studio</div>
              <div className="text-[10px] text-[#6e7584] truncate">{mesh.name} · precision unwrap, inspect and pack</div>
            </div>
            {meshes.length > 0 && onSelectMesh && (
              <select
                value={activeMeshId || mesh.id}
                onChange={(e) => onSelectMesh(e.target.value)}
                className="cad-input h-8 max-w-[180px] px-2 text-[11px] font-mono"
                title="Show UVs for this object"
              >
                {meshes.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button className={iconButton} onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
            <button className={`${iconButton} hover:!bg-rose-600`} onClick={onClose}><X size={15}/></button>
          </div>
        </header>

        <div className="adobe-toolbar h-12 shrink-0 px-3 gap-2 text-[11px]">
          <button className={iconButton} onClick={() => setMesh(smartUnwrapFaces(mesh, selected.length ? selected : undefined))}><Sparkles size={14} className="text-amber-300"/> Smart unwrap</button>
          <button className={iconButton} onClick={() => setMesh(boxUnwrapFaces(mesh, selected.length ? selected : undefined))}><Box size={14}/> Box</button>
          <button className={iconButton} onClick={() => apply((m, ids) => planarProjectFaces(m, ids, 'auto'))}><Compass size={14}/> Planar</button>
          <button className={iconButton} onClick={() => setMesh(cylindricalUnwrapFaces(mesh, selected.length ? selected : undefined))}>Cylinder</button>
          <button className={iconButton} onClick={() => setMesh(sphericalUnwrapFaces(mesh, selected.length ? selected : undefined))}>Sphere</button>
          <div className="w-px h-6 bg-[#3a3f4a] mx-1"/>
          <button className={`${iconButton} is-active`} onClick={() => setMesh(packUVIslandsGrid(mesh, selected.length ? selected : undefined, padding))}><ScanSearch size={14}/> Pack atlas</button>
          <button className={iconButton} onClick={fitSelected}><Maximize2 size={14}/> Fit</button>
          <div className="w-px h-6 bg-[#3a3f4a] mx-1"/>
          <button
            className={iconButton}
            onClick={() => {
              setNewImageSize(textureCanvas ? Math.max(textureCanvas.width, textureCanvas.height) : 256);
              setNewImageCustomSize('');
              setNewImageBg('transparent');
              setNewImageModalOpen(true);
            }}
            title="New blank texture image"
          >
            <FilePlus size={14} className="text-[#00b4c4]"/> New Image
          </button>
          <button
            className={iconButton}
            onClick={handleLoadImage}
            title="Load image from disk as mesh texture"
          >
            <ImagePlus size={14} className="text-[#00b4c4]"/> Load Image
          </button>
          <button
            className={iconButton}
            disabled={!textureCanvas}
            onClick={() => {
              setSaveAsFilename(`${(mesh.name || 'texture').replace(/[^a-zA-Z0-9_\-]/g, '_')}_uv.png`);
              setSaveAsModalOpen(true);
            }}
            title="Save mesh texture as PNG"
          >
            <Download size={14} className="text-[#00b4c4]"/> Save As
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button className={modeButton(mode === 'vertex')} onClick={() => setMode('vertex')}>Vertex</button>
            <button className={modeButton(mode === 'face')} onClick={() => setMode('face')}>Face</button>
            <button className={modeButton(mode === 'island')} onClick={() => setMode('island')}><Layers size={13}/> Island</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <aside className="adobe-inspector w-60 shrink-0 p-3 border-r overflow-y-auto text-[11px] space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-[#6e7584]">Faces</div>
                <button className="text-[#00b4c4] hover:text-[#ffb366]" onClick={() => setSelectedFaceIds(mesh.faces.map((f) => f.id))}>Select all</button>
              </div>
              <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-1 pr-1">
                {mesh.faces.map((face, index) => {
                  const chosen = selected.includes(face.id);
                  return (
                    <button
                      key={face.id}
                      onClick={(e) => {
                        setActiveFaceId(face.id);
                        setActiveVertex(null);
                        setSelectedFaceIds((prev) => e.shiftKey
                          ? prev.includes(face.id) ? prev.filter((id) => id !== face.id) : [...prev, face.id]
                          : [face.id]);
                      }}
                      className={`h-7 px-2 rounded border text-left truncate ${chosen ? 'bg-[rgba(237,115,0,.25)] border-[#00b4c4] text-white' : 'bg-[#16191e] border-[#3a3f4a] text-[#a6abb4] hover:text-white'}`}
                    >
                      Face {index + 1} <span className="text-[9px] opacity-60">{face.vertexIds.length}v</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <div className="text-[10px] uppercase tracking-widest text-[#6e7584] mb-2">Transform selection</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className={iconButton} onClick={() => rotateSelected(-90)}><RotateCcw size={14}/> −90°</button>
                <button className={iconButton} onClick={() => rotateSelected(90)}><RotateCw size={14}/> +90°</button>
                <button className={iconButton} onClick={() => apply((m, ids) => mirrorFaceUVs(m, ids, 'u'))}><FlipHorizontal size={14}/> Flip U</button>
                <button className={iconButton} onClick={() => apply((m, ids) => mirrorFaceUVs(m, ids, 'v'))}><FlipVertical size={14}/> Flip V</button>
                <button className={iconButton} onClick={() => apply((m, ids) => scaleUVs(m, ids, 0.9, undefined, snapDivisions))}>Scale −</button>
                <button className={iconButton} onClick={() => apply((m, ids) => scaleUVs(m, ids, 1.1, undefined, snapDivisions))}>Scale +</button>
              </div>
            </section>
            <section className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-[#6e7584]">Atlas settings</div>
              <label className="block text-slate-400">Pixel snap
                <select value={snapDivisions} onChange={(e) => setSnapDivisions(+e.target.value)} className="cad-input mt-1 w-full h-8 px-2">
                  <option value={0}>Off — free movement</option><option value={16}>16 px</option><option value={32}>32 px</option><option value={64}>64 px</option><option value={128}>128 px</option>
                </select>
              </label>
              <label className="block text-slate-400">Island padding <span className="float-right text-[#00b4c4]">{Math.round(padding * 100)}%</span>
                <input type="range" min="0.005" max="0.1" step="0.005" value={padding} onChange={(e) => setPadding(+e.target.value)} className="w-full"/>
              </label>
              <button className={`${iconButton} w-full justify-center`} onClick={() => apply((m, ids) => snapFacesToGrid(m, ids, snapDivisions))}><Grid3X3 size={14}/> Snap selection now</button>
            </section>
            <section>
              <div className="text-[10px] uppercase tracking-widest text-[#6e7584] mb-2">Diagnostics</div>
              <div className="space-y-1.5">
                <div className="flex justify-between p-2 rounded bg-[#282c35]"><span>Selected faces</span><b className="text-[#00b4c4]">{selected.length}</b></div>
                <div className="flex justify-between p-2 rounded bg-[#21242c]"><span>Overlapping faces</span><b className={overlaps.size ? 'text-rose-400' : 'text-emerald-400'}>{overlaps.size}</b></div>
                <div className="flex justify-between p-2 rounded bg-[#21242c]"><span>UV vertices</span><b>{mesh.faces.reduce((n, f) => n + f.uvs.length, 0)}</b></div>
              </div>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showOverlap} onChange={(e) => setShowOverlap(e.target.checked)} className="accent-rose-500"/> Highlight overlaps</label>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showTexture} onChange={(e) => setShowTexture(e.target.checked)} className="accent-[#00b4c4]"/> Texture preview</label>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="accent-[#00b4c4]"/> Pixel grid</label>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={show3DPreview} onChange={(e) => setShow3DPreview(e.target.checked)} className="accent-[#00b4c4]"/> Show 3D Viewport</label>
            </section>
            <button className="text-[#6e7584] hover:text-[#ec5b62]" onClick={() => setMesh(resetMeshUVs(mesh))}>Reset all UVs</button>
          </aside>

          <div className="flex-1 min-w-0 flex relative bg-[#252525]">
            <main
              className="flex-1 relative overflow-hidden"
              onWheel={(e) => setZoom((z) => Math.max(0.35, Math.min(8, z * (e.deltaY > 0 ? 0.9 : 1.1))))}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="absolute top-3 left-3 z-20 flex gap-1">
                <button className={iconButton} onClick={() => setZoom((z) => Math.min(8, z * 1.2))}><ZoomIn size={14}/></button>
                <button className={iconButton} onClick={() => setZoom((z) => Math.max(.35, z / 1.2))}><ZoomOut size={14}/></button>
                <button className={iconButton} onClick={() => { setZoom(1); setPan({x: 0, y: 0}); }}><Move size={14}/> Frame all</button>
              </div>
              <div className="absolute top-3 right-3 z-20 rounded-sm bg-[#1c1f26]/95 border border-[#3a3f4a] px-2 py-1 text-[10px] font-mono text-[#6e7584]">
                {cursorUv ? `U ${cursorUv.u.toFixed(3)}  V ${cursorUv.v.toFixed(3)}` : 'A select all · R rotate · F fit'}
              </div>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  ref={boardRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="relative pointer-events-auto w-[min(72vh,72vw)] aspect-square border-2 border-[#00b4c4] shadow-[0_25px_80px_#000] origin-center touch-none"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    backgroundColor: '#16191e',
                    backgroundImage: showGrid
                      ? 'linear-gradient(rgba(237,115,0,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(237,115,0,0.12) 1px,transparent 1px),linear-gradient(45deg,#303030 25%,transparent 25%,transparent 75%,#303030 75%),linear-gradient(45deg,#303030 25%,#16191e 25%,#16191e 75%,#303030 75%)'
                      : undefined,
                    backgroundSize: showGrid ? `${100 / Math.max(1, snapDivisions)}% ${100 / Math.max(1, snapDivisions)}%,${100 / Math.max(1, snapDivisions)}% ${100 / Math.max(1, snapDivisions)}%,24px 24px,24px 24px` : undefined,
                    backgroundPosition: showGrid ? '0 0,0 0,0 0,12px 12px' : undefined,
                  }}
                >
                  {showTexture && textureUrl && <img src={textureUrl} className="absolute inset-0 w-full h-full opacity-70 pointer-events-none" style={{imageRendering: 'pixelated'}}/>}
                  <svg viewBox="0 0 1000 1000" className="absolute inset-0 w-full h-full overflow-visible">
                    {mesh.faces.map((face, index) => {
                      const isSelected = selected.includes(face.id);
                      const isOverlap = showOverlap && overlaps.has(face.id);
                      const points = face.uvs.map((p) => `${p.u * 1000},${p.v * 1000}`).join(' ');
                      return <g key={face.id}>
                        <polygon points={points} fill={isOverlap ? '#ec5b623d' : isSelected ? '#00b4c438' : '#ffffff0a'} stroke={isOverlap ? '#ec5b62' : isSelected ? '#00b4c4' : '#7a7a7a'} strokeWidth={isSelected ? 4 : 2}/>
                        {isSelected && <text x={getFaceUVBounds(face.uvs).cu * 1000} y={getFaceUVBounds(face.uvs).cv * 1000} textAnchor="middle" fill="#ffffff" fontSize="22" className="pointer-events-none">{index + 1}</text>}
                        {mode === 'vertex' && face.uvs.map((p, i) => <circle key={i} cx={p.u * 1000} cy={p.v*1000} r={activeVertex?.faceId === face.id && activeVertex.index === i ? 11 : 7} fill={activeVertex?.faceId === face.id && activeVertex.index === i ? '#00b4c4' : '#e6e6e6'} stroke="#1a1c22" strokeWidth="3"/>)}
                      </g>;
                    })}
                  </svg>
                </div>
              </div>
            </main>

            {show3DPreview && (
              <div className="w-[38%] min-w-[320px] bg-[#111318] relative border-l border-[#3a3f4a]">
                <UV3DPreview
                  mesh={mesh}
                  selectedFaceIds={selected}
                  textureCanvas={textureCanvas}
                />
                <div className="absolute top-3 right-3 z-20 rounded-sm bg-[#1c1f26]/95 border border-[#3a3f4a] px-2 py-1 text-[9px] font-mono text-[#6e7584] pointer-events-none">
                  3D PREVIEW
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="adobe-statusbar h-9 shrink-0 px-4 justify-between text-[10px]">
          <span>Drag islands · Shift-click adds · RMB/MMB pan · Wheel zoom</span>
          <button onClick={onClose} className="adobe-control is-active h-7 px-4 font-semibold"><Check size={13}/> Apply UVs</button>
        </footer>
      </div>

      {newImageModalOpen && (
        <div className="fixed inset-0 z-[100010] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 select-none" onClick={() => setNewImageModalOpen(false)}>
          <div className="bg-[#1a1d24] border border-[#3a3f4a] rounded-lg shadow-2xl p-4 w-[380px] max-w-full text-white" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded bg-[#00b4c4]/15 flex items-center justify-center text-[#00b4c4]">
                <FilePlus size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">New UV Texture</h3>
                <p className="text-[10px] text-[#858a93]">Create a blank texture image for {mesh.name || 'this mesh'}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 my-3">
              <div>
                <label className="text-[10px] uppercase font-semibold tracking-wider text-[#858a93] block mb-1.5">
                  Resolution Preset
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([64, 128, 256, 512, 1024, 2048] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setNewImageSize(s);
                        setNewImageCustomSize('');
                      }}
                      className={`h-7 rounded text-[11px] font-mono border transition-colors ${
                        newImageSize === s && !newImageCustomSize
                          ? 'bg-[#00b4c4]/20 border-[#00b4c4] text-[#00b4c4] font-bold'
                          : 'bg-[#14171d] border-[#3a3f4a] text-[#c9ced6] hover:border-[#525968]'
                      }`}
                    >
                      {s}×{s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-semibold tracking-wider text-[#858a93] block mb-1.5">
                  Or Custom Size
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={8}
                    max={4096}
                    placeholder="e.g. 512"
                    value={newImageCustomSize}
                    onChange={(e) => setNewImageCustomSize(e.target.value)}
                    className="flex-1 h-7 px-2 rounded bg-[#14171d] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-white outline-none"
                  />
                  <span className="text-[11px] font-mono text-[#858a93]">px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-semibold tracking-wider text-[#858a93] block mb-1.5">
                  Background
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['transparent', 'white', 'dark', 'grid'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setNewImageBg(b)}
                      className={`h-7 rounded text-[10.5px] capitalize border transition-colors ${
                        newImageBg === b
                          ? 'bg-[#00b4c4]/20 border-[#00b4c4] text-[#00b4c4] font-semibold'
                          : 'bg-[#14171d] border-[#3a3f4a] text-[#c9ced6] hover:border-[#525968]'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2d323b]">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-[11px] text-[#858a93] hover:text-white"
                onClick={() => setNewImageModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded text-[11px] font-semibold bg-[#00b4c4] hover:bg-[#00c8d7] text-[#0a1114]"
                onClick={() => {
                  let targetSize = newImageSize;
                  if (newImageCustomSize) {
                    const parsed = parseInt(newImageCustomSize, 10);
                    if (Number.isFinite(parsed) && parsed >= 8 && parsed <= 4096) {
                      targetSize = parsed;
                    }
                  }
                  handleCreateNewImage(targetSize, newImageBg);
                }}
              >
                Create Texture
              </button>
            </div>
          </div>
        </div>
      )}

      {saveAsModalOpen && (
        <div className="fixed inset-0 z-[100010] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 select-none" onClick={() => setSaveAsModalOpen(false)}>
          <div className="bg-[#1a1d24] border border-[#3a3f4a] rounded-lg shadow-2xl p-4 w-[360px] max-w-full text-white" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded bg-[#00b4c4]/15 flex items-center justify-center text-[#00b4c4]">
                <Download size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Save UV Texture As</h3>
                <p className="text-[10px] text-[#858a93]">
                  Export current texture as PNG
                </p>
              </div>
            </div>

            <div className="my-3">
              <label className="text-[10px] uppercase font-semibold tracking-wider text-[#858a93] block mb-1.5">
                File Name
              </label>
              <input
                type="text"
                value={saveAsFilename}
                onChange={(e) => setSaveAsFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveImageAs(saveAsFilename);
                  }
                }}
                autoFocus
                className="w-full h-8 px-2.5 rounded bg-[#14171d] border border-[#3a3f4a] focus:border-[#00b4c4] text-[12px] font-mono text-white outline-none"
                placeholder="texture_uv.png"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2d323b]">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-[11px] text-[#858a93] hover:text-white"
                onClick={() => setSaveAsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded text-[11px] font-semibold bg-[#00b4c4] hover:bg-[#00c8d7] text-[#0a1114]"
                onClick={() => handleSaveImageAs(saveAsFilename)}
              >
                Download PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxSelect, ChevronDown, CircleDot, FlipHorizontal, FlipVertical,
  Grid3X3, ImagePlus, Link2, Lock, Maximize2, Move, MousePointer2, Pin,
  RotateCcw, RotateCw, Scissors, Trash2, Unlink2, Unlock, ZoomIn,
} from 'lucide-react';
import type { CADMesh, Face, UVCoord } from '../types/cad';
import {
  applyUvPositions,
  buildUvTopology,
  faceUvArea,
  faceWorldArea,
  getDistortionByFace,
  getOverlappingFaceIds,
  uvVertexId,
  type UvSelectionMode,
  type UvVertexId,
} from '../utils/uvTopology';
import {
  boxUnwrapFaces, cylindricalUnwrapFaces, fitUVsToUnitSquare, mirrorFaceUVs,
  packUVIslandsGrid, planarProjectFaces, rotateUVs, scaleUVs, smartUnwrapFaces,
  sphericalUnwrapFaces,
} from '../utils/uvAdvanced';

interface UVEditorProps {
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  meshes?: CADMesh[];
  activeMeshId?: string;
  onSelectMesh?: (meshId: string) => void;
  selectedFaceIds: string[];
  setSelectedFaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  textureCanvas: HTMLCanvasElement | null;
  onTextureUpdated?: (canvas: HTMLCanvasElement) => void;
  onOpenUVModal?: () => void;
}

type TransformMode = 'move' | 'rotate' | 'scale';
type SnapMode = 'none' | 'pixel' | 'half-pixel' | 'grid';
type SyncMode = 'off' | '3d-to-uv' | 'uv-to-3d' | 'both';
type GizmoHandle = 'move' | 'rotate' | 'scale';
type View = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
type ReferenceImageLayer = {
  name: string;
  src: string;
  image: HTMLImageElement;
  locked: boolean;
  opacity: number;
  offsetU: number;
  offsetV: number;
  scale: number;
  rotation: number;
};

type Drag = {
  kind: 'pan' | 'transform' | 'box' | 'image';
  start: Point;
  viewStart?: View;
  initial?: Map<UvVertexId, UVCoord>;
  pivot?: UVCoord;
  selection?: UvVertexId[];
  imageStart?: { offsetU: number; offsetV: number };
  /** Active gizmo gesture for this drag (Blockbench-style). */
  gizmo?: GizmoHandle;
};

type SelectionGizmo = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  corners: Point[];
  rotateHandle: Point;
};

const HANDLE_R = 6;
const ROTATE_OFFSET = 28;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function pointInFace(uv: UVCoord, face: Face) {
  let inside = false;
  for (let i = 0, j = face.uvs.length - 1; i < face.uvs.length; j = i++) {
    const a = face.uvs[i], b = face.uvs[j];
    if ((a.v > uv.v) !== (b.v > uv.v) && uv.u < ((b.u-a.u)*(uv.v-a.v))/(b.v-a.v)+a.u) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x-a.x, dy = b.y-a.y;
  const t = clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1), 0, 1);
  return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
}

function hitHandle(p: Point, handle: Point, radius = HANDLE_R + 2) {
  return Math.hypot(p.x - handle.x, p.y - handle.y) <= radius;
}

export const UVEditor: React.FC<UVEditorProps> = ({
  mesh, setMesh, meshes = [], activeMeshId, onSelectMesh,
  selectedFaceIds, setSelectedFaceIds, textureCanvas, onTextureUpdated, onOpenUVModal,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 28, y: 28, scale: 260 });
  const dragRef = useRef<Drag | null>(null);
  const tempPositionsRef = useRef<Map<UvVertexId, UVCoord> | null>(null);
  const dragBaseMeshRef = useRef<CADMesh | null>(null);
  const livePreviewRafRef = useRef<number>(0);
  const boxRectRef = useRef<{ a: Point; b: Point } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const imageImportModeRef = useRef<'texture' | 'reference'>('reference');
  const textureResolution = {
    width: textureCanvas?.width || 32,
    height: textureCanvas?.height || 32,
  };

  const topology = useMemo(() => buildUvTopology(mesh), [mesh]);
  const distortion = useMemo(() => getDistortionByFace(mesh), [mesh]);
  const overlaps = useMemo(() => getOverlappingFaceIds(mesh), [mesh]);
  const [mode, setMode] = useState<UvSelectionMode>('face');
  const [transform, setTransform] = useState<TransformMode>('move');
  const [snap, setSnap] = useState<SnapMode>('pixel');
  const [sync, setSync] = useState<SyncMode>('both');
  const [selectedUvVertices, setSelectedUvVertices] = useState<Set<string>>(new Set());
  const [selectedUvEdges, setSelectedUvEdges] = useState<Set<string>>(new Set());
  const [activeUvVertex, setActiveUvVertex] = useState<string | null>(null);
  const [activeUvEdge, setActiveUvEdge] = useState<string | null>(null);
  const [showProperties, setShowProperties] = useState(true);
  const [showTexture, setShowTexture] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showOverlaps, setShowOverlaps] = useState(false);
  const [showDistortion, setShowDistortion] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [nearest, setNearest] = useState(true);
  const [boxSelectArmed, setBoxSelectArmed] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [cursorUv, setCursorUv] = useState<UVCoord | null>(null);
  const [referenceLayer, setReferenceLayer] = useState<ReferenceImageLayer | null>(null);
  const [editReferenceImage, setEditReferenceImage] = useState(false);
  const [textureLocked, setTextureLocked] = useState(false);

  const selectedIslandIds = useMemo(
    () => new Set(selectedFaceIds.map((id) => topology.faceToIsland.get(id)).filter(Boolean) as string[]),
    [selectedFaceIds, topology],
  );

  const selectedUvIds = () => {
    if (mode === 'vertex') return [...selectedUvVertices];
    if (mode === 'edge') {
      const ids = new Set<string>();
      selectedUvEdges.forEach((id) => {
        const edge = topology.edges.get(id);
        if (edge) { ids.add(edge.cornerA); ids.add(edge.cornerB); }
      });
      return [...ids];
    }
    const faceIds = mode === 'island'
      ? [...selectedIslandIds].flatMap((id) => topology.islands.get(id)?.uvFaceIds || [])
      : selectedFaceIds;
    return faceIds.flatMap((id) => topology.faces.get(id)?.uvVertexIds || []);
  };

  const getSelectionGizmo = (): SelectionGizmo | null => {
    const ids = selectedUvIds();
    if (!ids.length) return null;
    const pts = ids.map((id) => uvToScreen(getPosition(id)));
    if (!pts.length) return null;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = 4;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
      cx,
      cy,
      corners: [
        { x: minX - pad, y: minY - pad },
        { x: maxX + pad, y: minY - pad },
        { x: maxX + pad, y: maxY + pad },
        { x: minX - pad, y: maxY + pad },
      ],
      rotateHandle: { x: cx, y: minY - pad - ROTATE_OFFSET },
    };
  };

  const hitSelectionGizmo = (p: Point): GizmoHandle | null => {
    const g = getSelectionGizmo();
    if (!g) return null;
    if (hitHandle(p, g.rotateHandle, HANDLE_R + 4)) return 'rotate';
    if (g.corners.some((c) => hitHandle(p, c, HANDLE_R + 3))) return 'scale';
    if (hitHandle(p, { x: g.cx, y: g.cy }, HANDLE_R + 3)) return 'move';
    // Drag inside perforated selection bounds = move
    if (p.x >= g.minX && p.x <= g.maxX && p.y >= g.minY && p.y <= g.maxY) return 'move';
    return null;
  };

  const uvToScreen = (uv: UVCoord): Point => {
    const v = viewRef.current;
    return { x: v.x + uv.u*v.scale, y: v.y + (1-uv.v)*v.scale };
  };
  const screenToUv = (p: Point): UVCoord => {
    const v = viewRef.current;
    return { u: (p.x-v.x)/v.scale, v: 1-(p.y-v.y)/v.scale };
  };
  const eventPoint = (e: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX-rect.left, y: e.clientY-rect.top };
  };
  const getPosition = (id: string) => tempPositionsRef.current?.get(id) || topology.vertices.get(id)?.position || {u:0,v:0};

  const frame = (onlySelection = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ids = onlySelection ? selectedUvIds() : [...topology.vertices.keys()];
    const points = ids.map((id) => topology.vertices.get(id)?.position).filter(Boolean) as UVCoord[];
    if (!points.length) return;
    const minU = Math.min(...points.map((p) => p.u)), maxU = Math.max(...points.map((p) => p.u));
    const minV = Math.min(...points.map((p) => p.v)), maxV = Math.max(...points.map((p) => p.v));
    const w = Math.max(.05, maxU-minU), h = Math.max(.05, maxV-minV);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const scale = Math.min((cssW-44)/w, (cssH-44)/h);
    viewRef.current = {
      scale,
      x: (cssW-scale*w)/2-minU*scale,
      y: (cssH-scale*h)/2+(maxV-1)*scale,
    };
    setZoomPercent(Math.round(scale/Math.max(1, Math.min(cssW,cssH)-44)*100));
    drawRef.current();
  };

  const snapUv = (uv: UVCoord): UVCoord => {
    if (snap === 'none') return uv;
    const divU = snap === 'pixel' ? textureResolution.width : snap === 'half-pixel' ? textureResolution.width*2 : 16;
    const divV = snap === 'pixel' ? textureResolution.height : snap === 'half-pixel' ? textureResolution.height*2 : 16;
    return { u: Math.round(uv.u*divU)/divU, v: Math.round(uv.v*divV)/divV };
  };

  const importImage = (file: File | undefined, mode?: 'texture' | 'reference') => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const looksLikeImage =
      file.type.startsWith('image/')
      || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)
      || !file.type; // Windows often leaves MIME empty
    if (!looksLikeImage && file.type && !file.type.startsWith('image/')) return;

    const importMode = mode ?? imageImportModeRef.current;
    const reader = new FileReader();
    reader.onerror = () => {
      console.warn('[UVEditor] Failed to read image file', file.name);
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const image = new Image();
      image.onload = () => {
        if (importMode === 'texture') {
          if (!onTextureUpdated) {
            console.warn('[UVEditor] onTextureUpdated missing — cannot apply mesh texture');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, image.naturalWidth);
          canvas.height = Math.max(1, image.naturalHeight);
          const context = canvas.getContext('2d');
          if (!context) return;
          context.imageSmoothingEnabled = false;
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          onTextureUpdated(canvas);
          setShowTexture(true);
          setTextureLocked(false);
          return;
        }
        setReferenceLayer({
          name: file.name,
          src: reader.result as string,
          image,
          locked: true,
          opacity: 0.65,
          offsetU: 0,
          offsetV: 0,
          scale: 1,
          rotation: 0,
        });
        setEditReferenceImage(false);
      };
      image.onerror = () => {
        console.warn('[UVEditor] Failed to decode image', file.name);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const openImagePicker = (mode: 'texture' | 'reference') => {
    imageImportModeRef.current = mode;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp';
    input.style.display = 'none';
    input.onchange = () => {
      importImage(input.files?.[0], mode);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
    // Remove if the user cancels (no change event).
    window.setTimeout(() => input.remove(), 60_000);
  };

  const commitOperation = (positions: Map<UvVertexId, UVCoord> | null) => {
    if (livePreviewRafRef.current) {
      cancelAnimationFrame(livePreviewRafRef.current);
      livePreviewRafRef.current = 0;
    }
    const base = dragBaseMeshRef.current || mesh;
    if (positions) setMesh(applyUvPositions(base, positions));
    tempPositionsRef.current = null;
    dragBaseMeshRef.current = null;
    boxRectRef.current = null;
    dragRef.current = null;
    drawRef.current();
  };

  const pushLiveUvPreview = (positions: Map<UvVertexId, UVCoord>) => {
    if (livePreviewRafRef.current) return;
    livePreviewRafRef.current = requestAnimationFrame(() => {
      livePreviewRafRef.current = 0;
      const base = dragBaseMeshRef.current;
      const live = tempPositionsRef.current;
      if (!base || !live) return;
      setMesh(applyUvPositions(base, live));
    });
  };

  const selectFaces = (ids: string[], additive: boolean) => {
    if (sync === 'off' || sync === '3d-to-uv') return;
    setSelectedFaceIds((prev) => additive
      ? [...new Set([...prev, ...ids])].filter((id) => !(prev.includes(id) && ids.includes(id)))
      : ids);
  };

  const pick = (point: Point, additive: boolean) => {
    const uv = screenToUv(point);
    if (mode === 'vertex') {
      let hit: { id: string; d: number } | null = null;
      topology.vertices.forEach((vertex) => {
        const p = uvToScreen(vertex.position), d = Math.hypot(p.x-point.x,p.y-point.y);
        if (d < 9 && (!hit || d<hit.d)) hit = {id:vertex.id,d};
      });
      if (hit) {
        const id = (hit as {id:string}).id;
        setSelectedUvVertices((prev) => {
          const next = new Set(additive ? prev : []);
          if (additive && next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
        setActiveUvVertex(id);
        const faceId = topology.vertices.get(id)?.meshFaceId;
        if (faceId) selectFaces([faceId], additive);
        return true;
      }
    } else if (mode === 'edge') {
      let hit: { id:string; d:number } | null = null;
      topology.edges.forEach((edge) => {
        const d = distanceToSegment(point, uvToScreen(getPosition(edge.cornerA)), uvToScreen(getPosition(edge.cornerB)));
        if (d<7 && (!hit || d<hit.d)) hit={id:edge.id,d};
      });
      if (hit) {
        const id = (hit as {id:string}).id;
        setSelectedUvEdges((prev) => {
          const next = new Set(additive ? prev : []);
          if (additive && next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
        setActiveUvEdge(id);
        const faceId = topology.edges.get(id)?.meshFaceId;
        if (faceId) selectFaces([faceId], additive);
        return true;
      }
    }
    const face = [...mesh.faces].reverse().find((candidate) => pointInFace(uv,candidate));
    if (!face) {
      if (!additive) { setSelectedFaceIds([]); setSelectedUvVertices(new Set()); setSelectedUvEdges(new Set()); }
      return false;
    }
    const ids = mode === 'island'
      ? topology.islands.get(topology.faceToIsland.get(face.id) || '')?.uvFaceIds || [face.id]
      : [face.id];
    selectFaces(ids, additive);
    return true;
  };

  const beginPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = eventPoint(e);
    // RMB / MMB pan · wheel zooms — LMB for UV tools
    if (e.button === 1 || e.button === 2) {
      dragRef.current = {kind:'pan',start:p,viewStart:{...viewRef.current}};
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (editReferenceImage && referenceLayer && !referenceLayer.locked) {
      dragRef.current = {
        kind: 'image',
        start: p,
        imageStart: { offsetU: referenceLayer.offsetU, offsetV: referenceLayer.offsetV },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (boxSelectArmed) {
      dragRef.current={kind:'box',start:p}; boxRectRef.current={a:p,b:p};
      e.currentTarget.setPointerCapture(e.pointerId); drawRef.current(); return;
    }

    // Blockbench-style gizmo handles on the current selection (move / rotate / scale)
    const gizmoHit = hitSelectionGizmo(p);
    if (gizmoHit) {
      const pinned = new Set(mesh.uvPinnedVertexIds || []);
      const ids = selectedUvIds().filter((id) => !pinned.has(id));
      if (!ids.length) { drawRef.current(); return; }
      setTransform(gizmoHit === 'rotate' ? 'rotate' : gizmoHit === 'scale' ? 'scale' : 'move');
      const initial = new Map(ids.map((id) => [id, { ...getPosition(id) }]));
      const values = [...initial.values()];
      const pivot = {
        u: values.reduce((n, v) => n + v.u, 0) / values.length,
        v: values.reduce((n, v) => n + v.v, 0) / values.length,
      };
      dragRef.current = { kind: 'transform', start: p, initial, pivot, selection: ids, gizmo: gizmoHit };
      tempPositionsRef.current = new Map(initial);
      dragBaseMeshRef.current = mesh;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const hit = pick(p,e.shiftKey);
    if (!hit) { drawRef.current(); return; }
    const selection = selectedUvIds();
    // Include the element clicked this frame, whose React selection state has not committed yet.
    const uv = screenToUv(p);
    const fallbackFace = [...mesh.faces].reverse().find((face) => pointInFace(uv,face));
    const pinned = new Set(mesh.uvPinnedVertexIds || []);
    const rawIds = selection.length ? selection : fallbackFace ? topology.faces.get(fallbackFace.id)?.uvVertexIds || [] : [];
    const ids = rawIds.filter((id) => !pinned.has(id));
    if (!ids.length) { drawRef.current(); return; }
    const initial = new Map(ids.map((id) => [id,{...getPosition(id)}]));
    const values = [...initial.values()];
    const pivot = values.length ? {u:values.reduce((n,v)=>n+v.u,0)/values.length,v:values.reduce((n,v)=>n+v.v,0)/values.length} : uv;
    dragRef.current={kind:'transform',start:p,initial,pivot,selection:ids,gizmo:transform};
    tempPositionsRef.current=new Map(initial);
    dragBaseMeshRef.current = mesh;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const movePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p=eventPoint(e), drag=dragRef.current;
    setCursorUv(screenToUv(p));
    if (!drag) return;
    if (drag.kind==='pan' && drag.viewStart) {
      viewRef.current={...drag.viewStart,x:drag.viewStart.x+p.x-drag.start.x,y:drag.viewStart.y+p.y-drag.start.y};
    } else if (drag.kind==='image' && drag.imageStart) {
      setReferenceLayer((layer) => layer ? {
        ...layer,
        offsetU: drag.imageStart!.offsetU + (p.x-drag.start.x)/viewRef.current.scale,
        offsetV: drag.imageStart!.offsetV - (p.y-drag.start.y)/viewRef.current.scale,
      } : layer);
    } else if (drag.kind==='box') {
      boxRectRef.current={a:drag.start,b:p};
    } else if (drag.kind==='transform' && drag.initial && drag.pivot) {
      const next=new Map<UvVertexId,UVCoord>();
      const gesture = drag.gizmo || transform;
      const pivotScreen = uvToScreen(drag.pivot);
      // Measure rotate/scale in screen space so the gesture matches the gizmo handle.
      // UV→screen uses equal scale on U/V, so a pure screen rotation stays a pure UV rotation.
      const startAngle = Math.atan2(drag.start.y - pivotScreen.y, drag.start.x - pivotScreen.x);
      const nowAngle = Math.atan2(p.y - pivotScreen.y, p.x - pivotScreen.x);
      // Screen Y is down while UV V is up — negate so clockwise drag rotates clockwise on screen.
      let angle = -(nowAngle - startAngle);
      if (gesture === 'rotate' && snap !== 'none') {
        const step = (Math.PI / 180) * 15;
        angle = Math.round(angle / step) * step;
      }
      const startDistance = Math.hypot(drag.start.x - pivotScreen.x, drag.start.y - pivotScreen.y) || 1;
      const scale = Math.max(0.01, Math.hypot(p.x - pivotScreen.x, p.y - pivotScreen.y) / startDistance);
      const startUv = screenToUv(drag.start);
      const nowUv = screenToUv(p);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      drag.initial.forEach((uv, id) => {
        let value: UVCoord;
        if (gesture === 'rotate') {
          // Rigid UV rotation — never per-vertex pixel-snap (that skews squares into rhombi).
          const x = uv.u - drag.pivot!.u;
          const y = uv.v - drag.pivot!.v;
          value = {
            u: drag.pivot!.u + x * cos - y * sin,
            v: drag.pivot!.v + x * sin + y * cos,
          };
        } else if (gesture === 'scale') {
          value = {
            u: drag.pivot!.u + (uv.u - drag.pivot!.u) * scale,
            v: drag.pivot!.v + (uv.v - drag.pivot!.v) * scale,
          };
          // Uniform scale first; snap after would reintroduce slight skew — skip while dragging.
        } else {
          value = snapUv({ u: uv.u + nowUv.u - startUv.u, v: uv.v + nowUv.v - startUv.v });
        }
        next.set(id, value);
      });
      tempPositionsRef.current=next;
      pushLiveUvPreview(next);
    }
    drawRef.current();
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag=dragRef.current;
    if(drag?.kind==='box' && boxRectRef.current){
      const {a,b}=boxRectRef.current, minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y);
      if(mode==='vertex'){
        const ids=[...topology.vertices.values()].filter((v)=>{const p=uvToScreen(v.position);return p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY}).map(v=>v.id);
        setSelectedUvVertices(new Set(ids)); selectFaces([...new Set(ids.map(id=>topology.vertices.get(id)!.meshFaceId))],false);
      }else{
        const ids=mesh.faces.filter(face=>face.uvs.some(uv=>{const p=uvToScreen(uv);return p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY})).map(f=>f.id);
        selectFaces(ids,false);
      }
      setBoxSelectArmed(false);
    }
    commitOperation(drag?.kind==='transform' ? tempPositionsRef.current : null);
    try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{/* no capture */}
  };

  const transformSelection = (kind: 'rotate' | 'rotateCCW' | 'scale' | 'mirrorU' | 'mirrorV') => {
    let ids = selectedFaceIds.length ? selectedFaceIds : mesh.faces.map((f) => f.id);
    const pinned = new Set(mesh.uvPinnedVertexIds || []);
    // Skip fully locked faces when transforming
    ids = ids.filter((id) => {
      const corners = topology.faces.get(id)?.uvVertexIds || [];
      if (!corners.length) return true;
      return !corners.every((c) => pinned.has(c));
    });
    if (!ids.length) return;
    if (kind === 'rotate') setMesh(rotateUVs(mesh, ids, 90));
    else if (kind === 'rotateCCW') setMesh(rotateUVs(mesh, ids, -90));
    else if (kind === 'scale') setMesh(scaleUVs(mesh, ids, 1.1));
    else setMesh(mirrorFaceUVs(mesh, ids, kind === 'mirrorU' ? 'u' : 'v'));
  };

  /** Bake flip/rotate into the mesh texture canvas (updates 3D + paint). */
  const transformMeshTexture = (op: 'flipH' | 'flipV' | 'rotCW' | 'rotCCW') => {
    if (!textureCanvas || !onTextureUpdated || textureLocked) return;
    const w = textureCanvas.width;
    const h = textureCanvas.height;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d')!;
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(textureCanvas, 0, 0);
    const ctx = textureCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (op === 'flipH') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, 0);
    } else if (op === 'flipV') {
      ctx.translate(0, h);
      ctx.scale(1, -1);
      ctx.drawImage(src, 0, 0);
    } else if (op === 'rotCW') {
      // Square textures: rotate in place. Non-square: rotate visually within bounds.
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(src, -w / 2, -h / 2);
    } else {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(src, -w / 2, -h / 2);
    }
    ctx.restore();
    onTextureUpdated(textureCanvas);
    drawRef.current();
  };

  const transformReferenceImage = (op: 'flipH' | 'flipV' | 'rotCW' | 'rotCCW') => {
    if (!referenceLayer || referenceLayer.locked) return;
    if (op === 'rotCW') {
      setReferenceLayer((layer) => (layer ? { ...layer, rotation: (layer.rotation + 90) % 360 } : layer));
      return;
    }
    if (op === 'rotCCW') {
      setReferenceLayer((layer) => (layer ? { ...layer, rotation: (layer.rotation - 90 + 360) % 360 } : layer));
      return;
    }
    // Flip reference by baking into a new image element
    const img = referenceLayer.image;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (op === 'flipH') {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, c.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(img, 0, 0);
    const next = new Image();
    next.onload = () => {
      setReferenceLayer((layer) =>
        layer
          ? { ...layer, image: next, src: c.toDataURL('image/png'), name: `${layer.name} · flipped` }
          : layer,
      );
    };
    next.src = c.toDataURL('image/png');
  };

  const togglePinned = () => {
    const ids=selectedUvIds(), pinned=new Set(mesh.uvPinnedVertexIds||[]);
    const shouldPin=ids.some(id=>!pinned.has(id));
    ids.forEach(id=>shouldPin?pinned.add(id):pinned.delete(id));
    setMesh({...mesh,uvPinnedVertexIds:[...pinned]});
  };

  const setSeam = (enabled:boolean) => {
    const selected=[...selectedUvEdges].map(id=>topology.edges.get(id)?.meshEdgeId).filter(Boolean);
    setMesh({...mesh,edges:mesh.edges.map(edge=>selected.includes(edge.id)?{...edge,seam:enabled}:edge)});
  };

  useEffect(()=>{
    const canvas=canvasRef.current, host=hostRef.current;
    if(!canvas||!host)return;
    const resize=()=>{
      const dpr=window.devicePixelRatio||1,w=host.clientWidth,h=host.clientHeight;
      canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));
      canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;drawRef.current();
    };
    const observer=new ResizeObserver(resize);observer.observe(host);resize();
    return()=>observer.disconnect();
  },[]);

  const draw=()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    // PolyStage charcoal stage (not navy/cyan)
    ctx.fillStyle='#2b2b2b';ctx.fillRect(0,0,w,h);
    const v=viewRef.current;
    // Neighboring tiles / checker — charcoal tones
    for(let tu=-1;tu<=1;tu++)for(let tv=-1;tv<=1;tv++){
      const x=v.x+tu*v.scale,y=v.y-(tv)*v.scale;
      ctx.fillStyle=(tu===0&&tv===0)?'#262626':'#222222';ctx.fillRect(x,y,v.scale,v.scale);
      const tile=Math.max(8,v.scale/16);for(let yy=0;yy<v.scale;yy+=tile)for(let xx=0;xx<v.scale;xx+=tile){
        if((Math.floor(xx/tile)+Math.floor(yy/tile))%2===0){ctx.fillStyle=tu===0&&tv===0?'#303030':'#282828';ctx.fillRect(x+xx,y+yy,tile,tile)}
      }
      ctx.strokeStyle=tu===0&&tv===0?'#ed7300':'#3a3a3a';ctx.lineWidth=tu===0&&tv===0?2:1;ctx.strokeRect(x,y,v.scale,v.scale);
      if(tu!==0||tv!==0){ctx.fillStyle='#6a6a6a';ctx.font='10px monospace';ctx.fillText(`${1001+tu+tv*10}`,x+6,y+14)}
    }
    if(showTexture&&textureCanvas){
      // Atlas buffer already has v=1 at canvas top (flipY=true / paint stamps 1-v).
      ctx.save();
      ctx.globalAlpha=.78;
      ctx.imageSmoothingEnabled=!nearest;
      ctx.drawImage(textureCanvas,v.x,v.y,v.scale,v.scale);
      ctx.restore();
    }
    if(referenceLayer){
      const aspect=referenceLayer.image.naturalWidth/Math.max(1,referenceLayer.image.naturalHeight);
      const baseW=aspect>=1?v.scale:v.scale*aspect;
      const baseH=aspect>=1?v.scale/aspect:v.scale;
      ctx.save();
      ctx.globalAlpha=referenceLayer.opacity;
      ctx.imageSmoothingEnabled=!nearest;
      ctx.translate(
        v.x+v.scale*(.5+referenceLayer.offsetU),
        v.y+v.scale*(.5-referenceLayer.offsetV),
      );
      ctx.rotate(referenceLayer.rotation*Math.PI/180);
      const imageW=baseW*referenceLayer.scale,imageH=baseH*referenceLayer.scale;
      ctx.drawImage(referenceLayer.image,-imageW/2,-imageH/2,imageW,imageH);
      if(editReferenceImage&&!referenceLayer.locked){
        ctx.globalAlpha=1;ctx.strokeStyle='#ff9a3c';ctx.lineWidth=2;ctx.setLineDash([6,4]);
        ctx.strokeRect(-imageW/2,-imageH/2,imageW,imageH);ctx.setLineDash([]);
      }
      ctx.restore();
    }
    const pixelX=v.scale/textureResolution.width,pixelY=v.scale/textureResolution.height;
    if(showGrid&&Math.min(pixelX,pixelY)>5){
      ctx.beginPath();ctx.strokeStyle='rgba(237,115,0,0.18)';ctx.lineWidth=1;
      for(let x=0;x<=textureResolution.width;x++){const sx=v.x+x*pixelX;ctx.moveTo(sx,v.y);ctx.lineTo(sx,v.y+v.scale)}
      for(let y=0;y<=textureResolution.height;y++){const sy=v.y+y*pixelY;ctx.moveTo(v.x,sy);ctx.lineTo(v.x+v.scale,sy)}ctx.stroke();
    }
    const positions=(face:Face)=>face.vertexIds.map((_,i)=>uvToScreen(getPosition(uvVertexId(face.id,i))));
    mesh.faces.forEach((face,index)=>{
      const pts=positions(face),selected=selectedFaceIds.includes(face.id),overlap=showOverlaps&&overlaps.has(face.id),d=distortion.get(face.id)||0;
      ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
      if(showDistortion){
        const strength=Math.min(1,Math.abs(d)/2);ctx.fillStyle=d>0?`rgba(236,91,98,${.18+.48*strength})`:`rgba(45,157,120,${.18+.48*strength})`;
      }else ctx.fillStyle=overlap?'rgba(236,91,98,.45)':selected?'rgba(237,115,0,.28)':'rgba(255,255,255,.04)';
      ctx.fill();
      // Perforated (dashed) face borders — stronger dash on selection
      ctx.strokeStyle=overlap?'#ec5b62':selected?'#ed7300':'#7a7a7a';
      ctx.lineWidth=selected?2.4:1.25;
      ctx.setLineDash(selected ? [5, 4] : [3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      if(showLabels&&v.scale>100){
        const cx=pts.reduce((n,p)=>n+p.x,0)/pts.length,cy=pts.reduce((n,p)=>n+p.y,0)/pts.length;
        ctx.fillStyle=selected?'#ffffff':'#aaaaaa';ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(`${index+1}`,cx,cy+3);
      }
    });
    topology.edges.forEach(edge=>{
      const a=uvToScreen(getPosition(edge.cornerA)),b=uvToScreen(getPosition(edge.cornerB)),selected=selectedUvEdges.has(edge.id);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      ctx.strokeStyle=selected?'#ff9a3c':edge.seam?'#ec5b62':edge.boundary?'#cccccc':'#666666';
      ctx.lineWidth=selected?3:edge.seam||edge.boundary?2:1;ctx.setLineDash(edge.seam?[5,3]:[]);ctx.stroke();ctx.setLineDash([]);
    });
    if(mode==='vertex')topology.vertices.forEach(vertex=>{
      const p=uvToScreen(getPosition(vertex.id)),selected=selectedUvVertices.has(vertex.id);
      ctx.beginPath();ctx.arc(p.x,p.y,selected?5:3.5,0,Math.PI*2);ctx.fillStyle=selected?'#ed7300':vertex.pinned?'#ec5b62':'#e6e6e6';ctx.fill();ctx.strokeStyle='#1a1a1a';ctx.lineWidth=1.5;ctx.stroke();
      if(vertex.pinned){ctx.fillStyle='#ffb0b0';ctx.font='9px sans-serif';ctx.fillText('•',p.x,p.y+3)}
    });

    // Transform gizmo on the UV selection
    const gizmo = getSelectionGizmo();
    if (gizmo && (mode === 'face' || mode === 'island' || selectedFaceIds.length > 0 || selectedUvVertices.size > 0)) {
      const { minX, minY, maxX, maxY, cx, cy, corners, rotateHandle } = gizmo;
      ctx.save();
      // Perforated selection bounds
      ctx.strokeStyle = '#ed7300';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.setLineDash([]);

      // Rotation stem + handle
      ctx.beginPath();
      ctx.moveTo(cx, minY);
      ctx.lineTo(rotateHandle.x, rotateHandle.y);
      ctx.strokeStyle = '#ff9a3c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rotateHandle.x, rotateHandle.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = transform === 'rotate' ? '#ed7300' : '#ff9a3c';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Small rotate glyph
      ctx.beginPath();
      ctx.arc(rotateHandle.x, rotateHandle.y, 3, -0.8, Math.PI * 1.2);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Corner scale handles
      corners.forEach((c) => {
        ctx.fillStyle = transform === 'scale' ? '#ed7300' : '#ff9a3c';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        ctx.fillRect(c.x - HANDLE_R / 2, c.y - HANDLE_R / 2, HANDLE_R, HANDLE_R);
        ctx.strokeRect(c.x - HANDLE_R / 2, c.y - HANDLE_R / 2, HANDLE_R, HANDLE_R);
      });

      // Center move handle (diamond)
      ctx.beginPath();
      ctx.moveTo(cx, cy - HANDLE_R);
      ctx.lineTo(cx + HANDLE_R, cy);
      ctx.lineTo(cx, cy + HANDLE_R);
      ctx.lineTo(cx - HANDLE_R, cy);
      ctx.closePath();
      ctx.fillStyle = transform === 'move' ? '#ed7300' : '#ff9a3c';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    if(boxRectRef.current){const {a,b}=boxRectRef.current;ctx.fillStyle='#ed73001f';ctx.strokeStyle='#ed7300';ctx.setLineDash([4,3]);ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.setLineDash([])}
  };
  drawRef.current=draw;

  // Clear UV picks & reframe when switching objects
  useEffect(() => {
    setSelectedUvVertices(new Set());
    setSelectedUvEdges(new Set());
    setActiveUvVertex(null);
    setActiveUvEdge(null);
    tempPositionsRef.current = null;
    dragBaseMeshRef.current = null;
    const id = requestAnimationFrame(() => frame(false));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on mesh identity change
  }, [mesh.id]);

  useEffect(()=>{drawRef.current()},[mesh,topology,selectedFaceIds,selectedUvVertices,selectedUvEdges,mode,transform,showTexture,showGrid,showOverlaps,showDistortion,showLabels,nearest,textureCanvas,referenceLayer,editReferenceImage]);
  useEffect(()=>{
    if(sync==='both'||sync==='3d-to-uv')drawRef.current();
  },[selectedFaceIds,sync]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
      const k=e.key.toLowerCase();
      if(k==='g')setTransform('move');else if(k==='r')setTransform('rotate');else if(k==='s')setTransform('scale');
      else if(k==='b'){setBoxSelectArmed(true);e.preventDefault()}else if(k==='f')frame(true);else if(e.key==='Home')frame(false);
      else if(k==='a'&&!e.altKey){setSelectedFaceIds(mesh.faces.map(f=>f.id));setSelectedUvVertices(new Set(topology.vertices.keys()));e.preventDefault()}
      else if(k==='a'&&e.altKey){setSelectedFaceIds([]);setSelectedUvVertices(new Set());setSelectedUvEdges(new Set());e.preventDefault()}
      else if(e.key==='Escape'){tempPositionsRef.current=null;boxRectRef.current=null;dragRef.current=null;setBoxSelectArmed(false);drawRef.current()}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });

  const activeVertex=activeUvVertex?topology.vertices.get(activeUvVertex):null;
  const activeEdge=activeUvEdge?topology.edges.get(activeUvEdge):null;
  const selectedFaces=mesh.faces.filter(f=>selectedFaceIds.includes(f.id));
  const selectedWorldArea=selectedFaces.reduce((n,f)=>n+faceWorldArea(mesh,f),0);
  const selectedUvArea=selectedFaces.reduce((n,f)=>n+Math.abs(faceUvArea(f)),0);
  const density=selectedWorldArea?Math.sqrt(selectedUvArea*textureResolution.width*textureResolution.height/selectedWorldArea):0;
  const lockSelectedFaces = (lock: boolean) => {
    const faceIds = selectedFaceIds.length ? selectedFaceIds : mesh.faces.map((f) => f.id);
    const cornerIds = faceIds.flatMap((id) => topology.faces.get(id)?.uvVertexIds || []);
    const pinned = new Set(mesh.uvPinnedVertexIds || []);
    cornerIds.forEach((id) => (lock ? pinned.add(id) : pinned.delete(id)));
    setMesh({ ...mesh, uvPinnedVertexIds: [...pinned] });
  };

  const selectedFacesLocked = useMemo(() => {
    const faceIds = selectedFaceIds.length ? selectedFaceIds : [];
    if (!faceIds.length) return false;
    const pinned = new Set(mesh.uvPinnedVertexIds || []);
    return faceIds.every((id) => {
      const corners = topology.faces.get(id)?.uvVertexIds || [];
      return corners.length > 0 && corners.every((c) => pinned.has(c));
    });
  }, [selectedFaceIds, mesh.uvPinnedVertexIds, topology]);

  const toolButton=(active=false)=>`uv-btn ${active?'is-active':''}`;
  const menuClass='uv-menu';
  const closeMenuAfterAction=(e:React.MouseEvent<HTMLDivElement>)=>{
    if((e.target as HTMLElement).closest('button'))e.currentTarget.parentElement?.removeAttribute('open');
  };

  return (
    <div className="uv-workspace h-full flex flex-col select-none overflow-hidden">
      <header className="uv-header shrink-0">
        <div className="uv-brand">
          <span className="uv-brand-mark" aria-hidden />
          <div className="min-w-0">
            <div className="uv-title">UV Workspace</div>
            <div className="uv-subtitle truncate">{mesh.name || 'Mesh'}</div>
          </div>
        </div>
        {meshes.length > 0 && onSelectMesh && (
          <select
            value={activeMeshId || mesh.id}
            onChange={(e) => onSelectMesh(e.target.value)}
            className="uv-select"
            title="Active object"
          >
            {meshes.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onOpenUVModal} className="uv-btn is-accent">
          Expand
        </button>
      </header>

      <div className="uv-toolbar shrink-0">
        <div className="uv-seg">
          {(['vertex', 'edge', 'face', 'island'] as UvSelectionMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={toolButton(mode === item)}
              title={`${item} selection`}
            >
              {item === 'vertex' ? <CircleDot size={12} /> : item === 'edge' ? <Link2 size={12} /> : item === 'face' ? <MousePointer2 size={12} /> : <BoxSelect size={12} />}
              <span className="capitalize hidden sm:inline">{item}</span>
            </button>
          ))}
        </div>

        <div className="uv-seg">
          <button type="button" onClick={() => setTransform('move')} className={toolButton(transform === 'move')} title="Move (G)"><Move size={12} /></button>
          <button type="button" onClick={() => setTransform('rotate')} className={toolButton(transform === 'rotate')} title="Rotate (R)"><RotateCw size={12} /></button>
          <button type="button" onClick={() => setTransform('scale')} className={toolButton(transform === 'scale')} title="Scale (S)"><Maximize2 size={12} /></button>
        </div>

        <div className="uv-seg" title="Selected faces / islands">
          <span className="uv-seg-label">Faces</span>
          <button type="button" className="uv-btn" onClick={() => transformSelection('mirrorU')} title="Flip faces horizontal (U)"><FlipHorizontal size={12} /></button>
          <button type="button" className="uv-btn" onClick={() => transformSelection('mirrorV')} title="Flip faces vertical (V)"><FlipVertical size={12} /></button>
          <button type="button" className="uv-btn" onClick={() => transformSelection('rotateCCW')} title="Rotate faces −90°"><RotateCcw size={12} /></button>
          <button type="button" className="uv-btn" onClick={() => transformSelection('rotate')} title="Rotate faces +90°"><RotateCw size={12} /></button>
          <button
            type="button"
            className={toolButton(selectedFacesLocked)}
            onClick={() => lockSelectedFaces(!selectedFacesLocked)}
            title={selectedFacesLocked ? 'Unlock selected face UVs' : 'Lock / pin selected face UVs'}
          >
            {selectedFacesLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>

        <div className="uv-seg" title="Mesh texture image">
          <span className="uv-seg-label">Image</span>
          <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('flipH')} title="Flip texture H"><FlipHorizontal size={12} /></button>
          <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('flipV')} title="Flip texture V"><FlipVertical size={12} /></button>
          <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('rotCCW')} title="Rotate texture −90°"><RotateCcw size={12} /></button>
          <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('rotCW')} title="Rotate texture +90°"><RotateCw size={12} /></button>
          <button
            type="button"
            className={toolButton(textureLocked)}
            onClick={() => setTextureLocked((v) => !v)}
            title={textureLocked ? 'Unlock texture image' : 'Lock texture image'}
          >
            {textureLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>

        <div className="flex-1" />

        <details className="relative">
          <summary className={`${toolButton()} list-none cursor-pointer`}>Unwrap <ChevronDown size={11} /></summary>
          <div className={menuClass} onClick={closeMenuAfterAction}>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(smartUnwrapFaces(mesh, selectedFaceIds.length ? selectedFaceIds : undefined))}>Standard / Smart</button>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(planarProjectFaces(mesh, selectedFaceIds.length ? selectedFaceIds : mesh.faces.map((f) => f.id), 'auto'))}>Planar</button>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(boxUnwrapFaces(mesh, selectedFaceIds.length ? selectedFaceIds : undefined))}>Box</button>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(cylindricalUnwrapFaces(mesh, selectedFaceIds.length ? selectedFaceIds : undefined))}>Cylindrical</button>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(sphericalUnwrapFaces(mesh, selectedFaceIds.length ? selectedFaceIds : undefined))}>Spherical</button>
          </div>
        </details>
        <details className="relative">
          <summary className={`${toolButton()} list-none cursor-pointer`}>Seams <ChevronDown size={11} /></summary>
          <div className={menuClass} onClick={closeMenuAfterAction}>
            <button type="button" className="uv-menu-item" onClick={() => setSeam(true)}><Scissors size={12} /> Mark seam</button>
            <button type="button" className="uv-menu-item" onClick={() => setSeam(false)}><Unlink2 size={12} /> Clear seam</button>
          </div>
        </details>
        <details className="relative">
          <summary className={`${toolButton()} list-none cursor-pointer`}>Arrange <ChevronDown size={11} /></summary>
          <div className={menuClass} onClick={closeMenuAfterAction}>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(packUVIslandsGrid(mesh, selectedFaceIds.length ? selectedFaceIds : undefined, 2 / textureResolution.width))}>Pack · 2px</button>
            <button type="button" className="uv-menu-item" onClick={() => setMesh(fitUVsToUnitSquare(mesh, selectedFaceIds.length ? selectedFaceIds : mesh.faces.map((f) => f.id), 2 / textureResolution.width))}>Fit selection</button>
          </div>
        </details>
        <select value={snap} onChange={(e) => setSnap(e.target.value as SnapMode)} className="uv-select" title="Snapping">
          <option value="none">Snap Off</option>
          <option value="pixel">Pixel</option>
          <option value="half-pixel">Half px</option>
          <option value="grid">Grid 1/16</option>
        </select>
        <details className="relative">
          <summary className={`${toolButton()} list-none cursor-pointer`}><Grid3X3 size={12} /> View</summary>
          <div className={`${menuClass} w-44`}>
            {[
              ['Texture', showTexture, setShowTexture],
              ['Pixel grid', showGrid, setShowGrid],
              ['Overlaps', showOverlaps, setShowOverlaps],
              ['Distortion', showDistortion, setShowDistortion],
              ['Labels', showLabels, setShowLabels],
              ['Nearest', nearest, setNearest],
            ].map(([label, value, setter]) => (
              <label key={label as string} className="uv-check">
                <input type="checkbox" checked={value as boolean} onChange={(e) => (setter as React.Dispatch<React.SetStateAction<boolean>>)(e.target.checked)} />
                {label as string}
              </label>
            ))}
          </div>
        </details>
        <button
          type="button"
          className={toolButton()}
          title="Load an image as the mesh texture"
          onClick={() => openImagePicker('texture')}
        >
          <ImagePlus size={12} /> Load Image
        </button>
        <details className="relative">
          <summary className={`${toolButton(editReferenceImage)} list-none cursor-pointer`}><ImagePlus size={12} /> Ref</summary>
          <div className={`${menuClass} w-48`} onClick={closeMenuAfterAction}>
            <button type="button" className="uv-menu-item" onClick={(e) => { e.stopPropagation(); openImagePicker('texture'); }}>Import mesh texture…</button>
            <button type="button" className="uv-menu-item" onClick={(e) => { e.stopPropagation(); openImagePicker('reference'); }}>Import reference…</button>
            {referenceLayer && (
              <>
                <div className="uv-menu-hint truncate" title={referenceLayer.name}>{referenceLayer.name}</div>
                <button type="button" className="uv-menu-item" onClick={() => transformReferenceImage('flipH')} disabled={referenceLayer.locked}><FlipHorizontal size={12} /> Flip ref H</button>
                <button type="button" className="uv-menu-item" onClick={() => transformReferenceImage('flipV')} disabled={referenceLayer.locked}><FlipVertical size={12} /> Flip ref V</button>
                <button type="button" className="uv-menu-item" onClick={() => transformReferenceImage('rotCCW')} disabled={referenceLayer.locked}><RotateCcw size={12} /> Rotate −90°</button>
                <button type="button" className="uv-menu-item" onClick={() => transformReferenceImage('rotCW')} disabled={referenceLayer.locked}><RotateCw size={12} /> Rotate +90°</button>
                <button
                  type="button"
                  className="uv-menu-item"
                  onClick={() => {
                    if (!referenceLayer.locked) setEditReferenceImage(false);
                    setReferenceLayer((layer) => (layer ? { ...layer, locked: !layer.locked } : layer));
                  }}
                >
                  {referenceLayer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  {referenceLayer.locked ? 'Unlock reference' : 'Lock reference'}
                </button>
                <button type="button" className="uv-menu-item" disabled={referenceLayer.locked} onClick={() => setEditReferenceImage((v) => !v)}>
                  <Move size={12} /> {editReferenceImage ? 'Finish edit' : 'Edit transform'}
                </button>
                <button type="button" className="uv-menu-item is-danger" onClick={() => { setReferenceLayer(null); setEditReferenceImage(false); }}>
                  <Trash2 size={12} /> Remove
                </button>
              </>
            )}
          </div>
        </details>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div ref={hostRef} className="uv-stage flex-1 min-w-0 relative overflow-hidden">
          <canvas
            ref={canvasRef}
            onPointerDown={beginPointer}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={() => setCursorUv(null)}
            onWheel={(e) => {
              e.preventDefault();
              const p = eventPoint(e);
              const before = screenToUv(p);
              const factor = e.deltaY > 0 ? 0.9 : 1.1;
              viewRef.current.scale = clamp(viewRef.current.scale * factor, 24, 6000);
              viewRef.current.x = p.x - before.u * viewRef.current.scale;
              viewRef.current.y = p.y - (1 - before.v) * viewRef.current.scale;
              setZoomPercent(Math.round(viewRef.current.scale / 2.6));
              drawRef.current();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute inset-0 touch-none ${boxSelectArmed ? 'cursor-crosshair' : transform === 'move' ? 'cursor-move' : 'cursor-crosshair'}`}
          />
          <div className="uv-hud-top pointer-events-none">
            <span className="uv-badge">{mode.toUpperCase()} · {transform.toUpperCase()}</span>
            {textureLocked && <span className="uv-badge is-warn">TEXTURE LOCKED</span>}
            {selectedFacesLocked && <span className="uv-badge is-warn">FACES LOCKED</span>}
            {boxSelectArmed && <span className="uv-badge is-accent">DRAG BOX</span>}
          </div>
          <div className="uv-hud-bottom">
            <button type="button" onClick={() => frame(false)} className="uv-btn" title="Frame all (Home)"><ZoomIn size={11} /></button>
            <button type="button" onClick={() => setBoxSelectArmed(true)} className={toolButton(boxSelectArmed)} title="Box select (B)"><BoxSelect size={11} /></button>
            {mode === 'vertex' && <button type="button" onClick={togglePinned} className="uv-btn" title="Pin selected"><Pin size={11} /></button>}
          </div>
        </div>

        {showProperties && (
          <aside className="uv-inspector shrink-0 flex flex-col min-h-0">
            <div className="uv-section-head">Selection</div>
            <div className="uv-inspector-body space-y-2">
              {referenceLayer && editReferenceImage && !referenceLayer.locked ? (
                <div className="space-y-2">
                  <div className="uv-panel-title">Reference image</div>
                  <div className="uv-muted truncate" title={referenceLayer.name}>{referenceLayer.name}</div>
                  <label className="uv-slider-label">Opacity <b>{Math.round(referenceLayer.opacity * 100)}%</b>
                    <input type="range" min=".05" max="1" step=".05" value={referenceLayer.opacity} onChange={(e) => setReferenceLayer((layer) => (layer ? { ...layer, opacity: +e.target.value } : layer))} />
                  </label>
                  <label className="uv-slider-label">Scale <b>{referenceLayer.scale.toFixed(2)}×</b>
                    <input type="range" min=".1" max="4" step=".05" value={referenceLayer.scale} onChange={(e) => setReferenceLayer((layer) => (layer ? { ...layer, scale: +e.target.value } : layer))} />
                  </label>
                  <label className="uv-slider-label">Rotation <b>{Math.round(referenceLayer.rotation)}°</b>
                    <input type="range" min="-180" max="180" step="1" value={referenceLayer.rotation} onChange={(e) => setReferenceLayer((layer) => (layer ? { ...layer, rotation: +e.target.value } : layer))} />
                  </label>
                </div>
              ) : activeVertex ? (
                <div className="space-y-1.5">
                  <div className="uv-panel-title">UV Vertex</div>
                  <div className="uv-stat"><span>U</span><b>{getPosition(activeVertex.id).u.toFixed(4)}</b></div>
                  <div className="uv-stat"><span>V</span><b>{getPosition(activeVertex.id).v.toFixed(4)}</b></div>
                  <div className="uv-stat"><span>Pinned</span><b>{activeVertex.pinned ? 'Yes' : 'No'}</b></div>
                </div>
              ) : activeEdge ? (
                <div className="space-y-1.5">
                  <div className="uv-panel-title">UV Edge</div>
                  <div className="uv-stat"><span>Seam</span><b>{activeEdge.seam ? 'Yes' : 'No'}</b></div>
                  <div className="uv-stat"><span>Boundary</span><b>{activeEdge.boundary ? 'Yes' : 'No'}</b></div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="uv-panel-title">{mode === 'island' ? `${selectedIslandIds.size} Islands` : `${selectedFaceIds.length} Faces`}</div>
                  <div className="uv-stat"><span>UV area</span><b>{selectedUvArea.toFixed(3)}</b></div>
                  <div className="uv-stat"><span>Density</span><b>{density.toFixed(1)}</b></div>
                  <div className="uv-stat"><span>Overlaps</span><b className={overlaps.size ? 'text-[#ec5b62]' : 'text-[#2d9d78]'}>{overlaps.size}</b></div>
                </div>
              )}
            </div>

            <div className="uv-section-head">Face tools</div>
            <div className="uv-tool-grid">
              <button type="button" className="uv-btn" onClick={() => transformSelection('mirrorU')} title="Flip H"><FlipHorizontal size={13} /></button>
              <button type="button" className="uv-btn" onClick={() => transformSelection('mirrorV')} title="Flip V"><FlipVertical size={13} /></button>
              <button type="button" className="uv-btn" onClick={() => transformSelection('rotateCCW')} title="Rotate −90°"><RotateCcw size={13} /></button>
              <button type="button" className="uv-btn" onClick={() => transformSelection('rotate')} title="Rotate +90°"><RotateCw size={13} /></button>
              <button type="button" className={toolButton(selectedFacesLocked)} onClick={() => lockSelectedFaces(!selectedFacesLocked)} title="Lock faces">
                {selectedFacesLocked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              <button type="button" className="uv-btn" onClick={() => transformSelection('scale')} title="Scale up">+10%</button>
            </div>

            <div className="uv-section-head">Texture image</div>
            <div className="uv-tool-grid">
              <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('flipH')}><FlipHorizontal size={13} /></button>
              <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('flipV')}><FlipVertical size={13} /></button>
              <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('rotCCW')}><RotateCcw size={13} /></button>
              <button type="button" className="uv-btn" disabled={!textureCanvas || textureLocked} onClick={() => transformMeshTexture('rotCW')}><RotateCw size={13} /></button>
              <button type="button" className={toolButton(textureLocked)} onClick={() => setTextureLocked((v) => !v)}>
                {textureLocked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
            </div>
            <div className="uv-muted px-2 pb-2">{textureLocked ? 'Texture locked — transforms disabled' : 'Flip / rotate bakes into mesh texture'}</div>

            <div className="uv-section-head">Sync</div>
            <div className="px-2 py-2">
              <select value={sync} onChange={(e) => setSync(e.target.value as SyncMode)} className="uv-select w-full">
                <option value="off">Off</option>
                <option value="3d-to-uv">3D → UV</option>
                <option value="uv-to-3d">UV → 3D</option>
                <option value="both">Both</option>
              </select>
              <button type="button" onClick={() => setShowProperties(false)} className="uv-link mt-2">Hide panel</button>
            </div>
          </aside>
        )}
        {!showProperties && (
          <button type="button" onClick={() => setShowProperties(true)} className="uv-inspector-collapsed">‹</button>
        )}
      </div>

      <footer className="uv-statusbar shrink-0">
        <span>
          {referenceLayer
            ? `REF ${referenceLayer.locked ? 'LOCKED' : editReferenceImage ? 'EDITING' : 'READY'}`
            : `${mode.toUpperCase()} · ${mode === 'vertex' ? selectedUvVertices.size : mode === 'edge' ? selectedUvEdges.size : selectedFaceIds.length} selected`}
        </span>
        <span>{snap === 'pixel' ? `Snap ${textureResolution.width}×${textureResolution.height}` : snap} · {textureResolution.width}×{textureResolution.height} · {zoomPercent}%{snap !== 'none' ? ' · rotate snaps 15°' : ''}</span>
        <span>{cursorUv ? `${cursorUv.u.toFixed(3)}, ${cursorUv.v.toFixed(3)}` : 'U — V —'}</span>
      </footer>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Check, Compass, FlipHorizontal, FlipVertical, Grid3X3, Layers,
  Maximize2, Minimize2, Move, RotateCcw, RotateCw, ScanSearch, Sparkles,
  X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { CADMesh, Face, UVCoord } from '../types/cad';
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
  selectedFaceIds, setSelectedFaceIds, textureCanvas,
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
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);

  const selected = selectedFaceIds.length ? selectedFaceIds : activeFaceId ? [activeFaceId] : [];
  const overlaps = useMemo(() => overlapIds(mesh), [mesh]);
  const textureUrl = useMemo(() => textureCanvas?.toDataURL() || '', [textureCanvas]);

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
    return { u: clamp((e.clientX - rect.left) / rect.width), v: clamp(1 - (e.clientY - rect.top) / rect.height) };
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

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-3 flex items-center justify-center">
      <div className={`adobe-workspace flex flex-col overflow-hidden rounded-md border border-[#4d4d4d] shadow-2xl ${maximized ? 'w-full h-full' : 'w-[1100px] h-[760px]'}`}>
        <header className="adobe-panel-header h-12 shrink-0 px-4 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-[rgba(20,115,230,.18)] text-[#ed7300] flex items-center justify-center shrink-0"><Box size={17} /></div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">UV Atlas Studio</div>
              <div className="text-[10px] text-[#999999] truncate">{mesh.name} · precision unwrap, inspect and pack</div>
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
          <div className="w-px h-6 bg-[#4d4d4d] mx-1"/>
          <button className={`${iconButton} is-active`} onClick={() => setMesh(packUVIslandsGrid(mesh, selected.length ? selected : undefined, padding))}><ScanSearch size={14}/> Pack atlas</button>
          <button className={iconButton} onClick={fitSelected}><Maximize2 size={14}/> Fit</button>
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
                <div className="text-[10px] uppercase tracking-widest text-[#999999]">Faces</div>
                <button className="text-[#ed7300] hover:text-[#ffb366]" onClick={() => setSelectedFaceIds(mesh.faces.map((f) => f.id))}>Select all</button>
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
                      className={`h-7 px-2 rounded border text-left truncate ${chosen ? 'bg-[rgba(237,115,0,.25)] border-[#ed7300] text-white' : 'bg-[#262626] border-[#4d4d4d] text-[#b3b3b3] hover:text-white'}`}
                    >
                      Face {index + 1} <span className="text-[9px] opacity-60">{face.vertexIds.length}v</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <div className="text-[10px] uppercase tracking-widest text-[#999999] mb-2">Transform selection</div>
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
              <div className="text-[10px] uppercase tracking-widest text-[#999999]">Atlas settings</div>
              <label className="block text-slate-400">Pixel snap
                <select value={snapDivisions} onChange={(e) => setSnapDivisions(+e.target.value)} className="cad-input mt-1 w-full h-8 px-2">
                  <option value={0}>Off — free movement</option><option value={16}>16 px</option><option value={32}>32 px</option><option value={64}>64 px</option><option value={128}>128 px</option>
                </select>
              </label>
              <label className="block text-slate-400">Island padding <span className="float-right text-[#ed7300]">{Math.round(padding * 100)}%</span>
                <input type="range" min="0.005" max="0.1" step="0.005" value={padding} onChange={(e) => setPadding(+e.target.value)} className="w-full"/>
              </label>
              <button className={`${iconButton} w-full justify-center`} onClick={() => apply((m, ids) => snapFacesToGrid(m, ids, snapDivisions))}><Grid3X3 size={14}/> Snap selection now</button>
            </section>
            <section>
              <div className="text-[10px] uppercase tracking-widest text-[#999999] mb-2">Diagnostics</div>
              <div className="space-y-1.5">
                <div className="flex justify-between p-2 rounded bg-[#3a3a3a]"><span>Selected faces</span><b className="text-[#ed7300]">{selected.length}</b></div>
                <div className="flex justify-between p-2 rounded bg-[#2d2d2d]"><span>Overlapping faces</span><b className={overlaps.size ? 'text-rose-400' : 'text-emerald-400'}>{overlaps.size}</b></div>
                <div className="flex justify-between p-2 rounded bg-[#2d2d2d]"><span>UV vertices</span><b>{mesh.faces.reduce((n, f) => n + f.uvs.length, 0)}</b></div>
              </div>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showOverlap} onChange={(e) => setShowOverlap(e.target.checked)} className="accent-rose-500"/> Highlight overlaps</label>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showTexture} onChange={(e) => setShowTexture(e.target.checked)} className="accent-[#ed7300]"/> Texture preview</label>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="accent-[#ed7300]"/> Pixel grid</label>
            </section>
            <button className="text-[#999999] hover:text-[#ec5b62]" onClick={() => setMesh(resetMeshUVs(mesh))}>Reset all UVs</button>
          </aside>

          <main
            className="flex-1 relative overflow-hidden bg-[#252525]"
            onWheel={(e) => setZoom((z) => Math.max(0.35, Math.min(8, z * (e.deltaY > 0 ? 0.9 : 1.1))))}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="absolute top-3 left-3 z-20 flex gap-1">
              <button className={iconButton} onClick={() => setZoom((z) => Math.min(8, z * 1.2))}><ZoomIn size={14}/></button>
              <button className={iconButton} onClick={() => setZoom((z) => Math.max(.35, z / 1.2))}><ZoomOut size={14}/></button>
              <button className={iconButton} onClick={() => { setZoom(1); setPan({x: 0, y: 0}); }}><Move size={14}/> Frame all</button>
            </div>
            <div className="absolute top-3 right-3 z-20 rounded-sm bg-[#333333]/95 border border-[#4d4d4d] px-2 py-1 text-[10px] font-mono text-[#999999]">
              {cursorUv ? `U ${cursorUv.u.toFixed(3)}  V ${cursorUv.v.toFixed(3)}` : 'A select all · R rotate · F fit'}
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                ref={boardRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="relative pointer-events-auto w-[min(72vh,72vw)] aspect-square border-2 border-[#53657d] shadow-[0_25px_80px_#000] origin-center touch-none"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  backgroundColor: '#111827',
                  backgroundImage: showGrid
                    ? 'linear-gradient(#33415566 1px,transparent 1px),linear-gradient(90deg,#33415566 1px,transparent 1px),linear-gradient(45deg,#172033 25%,transparent 25%,transparent 75%,#172033 75%),linear-gradient(45deg,#172033 25%,#101722 25%,#101722 75%,#172033 75%)'
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
                    const points = face.uvs.map((p) => `${p.u * 1000},${(1 - p.v) * 1000}`).join(' ');
                    return <g key={face.id}>
                      <polygon points={points} fill={isOverlap ? '#ef44443d' : isSelected ? '#ed730038' : '#4d4d4d22'} stroke={isOverlap ? '#fb7185' : isSelected ? '#ed7300' : '#666666'} strokeWidth={isSelected ? 4 : 2}/>
                      {isSelected && <text x={getFaceUVBounds(face.uvs).cu * 1000} y={(1 - getFaceUVBounds(face.uvs).cv) * 1000} textAnchor="middle" fill="#dff9ff" fontSize="22" className="pointer-events-none">{index + 1}</text>}
                      {mode === 'vertex' && face.uvs.map((p, i) => <circle key={i} cx={p.u * 1000} cy={(1-p.v)*1000} r={activeVertex?.faceId === face.id && activeVertex.index === i ? 11 : 7} fill={activeVertex?.faceId === face.id && activeVertex.index === i ? '#fb7185' : '#f8fafc'} stroke="#0f172a" strokeWidth="3"/>)}
                    </g>;
                  })}
                </svg>
              </div>
            </div>
          </main>
        </div>

        <footer className="adobe-statusbar h-9 shrink-0 px-4 justify-between text-[10px]">
          <span>Drag islands · Shift-click adds · RMB/MMB pan · Wheel zoom</span>
          <button onClick={onClose} className="adobe-control is-active h-7 px-4 font-semibold"><Check size={13}/> Apply UVs</button>
        </footer>
      </div>
    </div>
  );
};

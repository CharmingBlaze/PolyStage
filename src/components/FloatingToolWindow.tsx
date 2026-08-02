import React, { useState, useRef, useEffect } from 'react';
import {
  GripHorizontal, Minus, X, Scissors, Layers, Box, Maximize2,
  Combine, Sparkles, Magnet, GitBranch, ArrowUpRight,
  FlipHorizontal, Minimize2, CornerDownRight, Pencil, MousePointerClick,
} from 'lucide-react';
import type { CADMesh, PrimitiveType, ToolState } from '../types/cad';
import {
  subdivideFaces, fillSelectedVerticesFace, bevelSelectedEdges
} from '../utils/advancedMeshTools';
import { flipFaceNormals } from '../utils/blockbenchCore';

export type ToolWindowTab = 'tools' | 'primitives';

interface FloatingToolWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab?: ToolWindowTab;
  onTabChange?: (tab: ToolWindowTab) => void;
  mesh: CADMesh;
  setMesh: (updater: CADMesh | ((prev: CADMesh) => CADMesh)) => void;
  selectedVertexIds: string[];
  setSelectedVertexIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeIds: string[];
  setSelectedEdgeIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedFaceIds: string[];
  setSelectedFaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onExtrudeFace: () => void;
  onInsetFace: () => void;
  onBevelEdges?: () => void;
  onLoopCut?: () => void;
  onKnife?: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onSeparateSelected?: () => void;
  onMergeVertices: () => void;
  onMirrorSymmetry: () => void;
  onAddMirrorModifier?: () => void;
  onAddSubdivision?: (levels?: number) => void;
  onApplySubdivide?: () => void;
  onApplyModifiers?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onMagnetSnap: () => void;
}

const PRIMITIVES: { type: PrimitiveType; name: string; is2D?: boolean }[] = [
  { type: 'cube', name: 'Box / Cube' },
  { type: 'cylinder', name: 'Cylinder' },
  { type: 'cone', name: 'Cone' },
  { type: 'sphere', name: 'Sphere' },
  { type: 'torus', name: 'Torus Ring' },
  { type: 'torusKnot', name: 'Torus Knot' },
  { type: 'pyramid', name: 'Pyramid' },
  { type: 'octahedron', name: 'Octahedron' },
  { type: 'dodecahedron', name: 'Dodecahedron' },
  { type: 'icosahedron', name: 'Icosahedron' },
  { type: 'tetrahedron', name: 'Tetrahedron' },
  { type: 'plane', name: 'Plane / Quad', is2D: true },
  { type: 'circle', name: 'Disk Circle', is2D: true },
  { type: 'ring', name: 'Ring Surface', is2D: true },
  { type: 'tube', name: 'Hollow Tube' },
  { type: 'ramp', name: 'Wedge Ramp' },
  { type: 'chest', name: 'Default Box' },
  { type: 'car', name: 'Low-Poly Car' },
  { type: 'tree', name: 'Pine Tree' },
];

export const FloatingToolWindow: React.FC<FloatingToolWindowProps> = ({
  isOpen,
  onClose,
  activeTab: controlledTab,
  onTabChange,
  setMesh,
  selectedVertexIds,
  setSelectedVertexIds,
  selectedEdgeIds,
  setSelectedEdgeIds,
  selectedFaceIds,
  setSelectedFaceIds,
  toolState,
  setToolState,
  onExtrudeFace,
  onInsetFace,
  onBevelEdges,
  onLoopCut,
  onKnife,
  onDeleteSelected,
  onDuplicateSelected,
  onSeparateSelected,
  onMergeVertices,
  onMirrorSymmetry,
  onAddMirrorModifier,
  onAddSubdivision,
  onApplySubdivide,
  onApplyModifiers,
  onCopy,
  onPaste,
  onMagnetSnap,
  mesh: _mesh,
}) => {
  // Default just below the viewport's top-left mode label so it stays readable.
  const [position, setPosition] = useState({ x: 52, y: 88 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [internalTab, setInternalTab] = useState<ToolWindowTab>('tools');
  const [spawnMode, setSpawnMode] = useState<'draw' | 'instant'>('draw');
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: ToolWindowTab) => {
    if (onTabChange) onTabChange(tab);
    else setInternalTab(tab);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 280, e.clientX - dragStartRef.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 80, e.clientY - dragStartRef.current.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  const handleSubdivide = () => {
    if (onApplySubdivide) onApplySubdivide();
    else setMesh((prev) => subdivideFaces(prev, selectedFaceIds));
  };

  const handleLoopCut = () => {
    if (onLoopCut) onLoopCut();
  };

  const handleKnife = () => {
    if (onKnife) onKnife();
  };

  const handleFillFace = () => {
    if (selectedVertexIds.length >= 3) {
      setMesh((prev) => fillSelectedVerticesFace(prev, selectedVertexIds));
    }
  };

  const handleBevel = () => {
    if (onBevelEdges) {
      onBevelEdges();
      return;
    }
    if (selectedEdgeIds.length > 0) {
      setMesh((prev) => bevelSelectedEdges(prev, selectedEdgeIds));
    } else if (selectedFaceIds.length > 0) {
      setMesh((prev) => subdivideFaces(prev, selectedFaceIds));
    }
  };

  const handleFlipNormals = () => {
    if (selectedFaceIds.length > 0) {
      setMesh((prev) => {
        let current = prev;
        selectedFaceIds.forEach((fId) => {
          current = flipFaceNormals(current, fId);
        });
        return current;
      });
    }
  };

  const handleSelectPrimitive = (type: PrimitiveType) => {
    if (spawnMode === 'draw') {
      setToolState((s) => ({
        ...s,
        isCadDrawing: true,
        placeOnClick: false,
        cadDrawPrimitive: type,
        activePrimitive: type,
      }));
    } else {
      setToolState((s) => ({
        ...s,
        isCadDrawing: false,
        placeOnClick: true,
        cadDrawPrimitive: null,
        activePrimitive: type,
      }));
    }
  };

  const title = activeTab === 'tools' ? 'MODELING TOOLS' : '3D PRIMITIVES';

  return (
    <div
      className="fixed z-50 rounded-[10px] overflow-hidden border border-[#3b3f46] bg-[#26282d] font-sans text-[10px] select-none text-[#c6cad1] shadow-[0_10px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.35)]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '240px' : '280px',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        className="h-7 px-2 flex items-center justify-between border-b border-[#101114] bg-[#212327] cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5 font-bold text-[#c6cad1] min-w-0 uppercase tracking-wide text-[9px]">
          <GripHorizontal className="w-3.5 h-3.5 text-[#8b909a] shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-[#3b3f46] rounded text-[#a6abb4] hover:text-white"
            title={isMinimized ? 'Expand Panel' : 'Minimize Panel'}
          >
            {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-rose-900/40 hover:text-rose-400 rounded text-[#a6abb4]"
            title="Close Panel (Shift+T)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Top-level window tabs */}
      <div className="grid grid-cols-2 gap-0.5 p-1 bg-[#191b1e] border-b border-[#101114]">
        <button
          type="button"
          onClick={() => { setActiveTab('tools'); setIsMinimized(false); }}
          className={`h-7 rounded text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-1 transition ${
            activeTab === 'tools'
              ? 'bg-[#ed7300] text-white shadow'
              : 'text-[#858a93] hover:bg-[#1e2023] hover:text-white'
          }`}
        >
          <Sparkles className="w-3 h-3" /> Tools
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('primitives'); setIsMinimized(false); }}
          className={`h-7 rounded text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-1 transition ${
            activeTab === 'primitives'
              ? 'bg-[#ed7300] text-white shadow'
              : 'text-[#858a93] hover:bg-[#1e2023] hover:text-white'
          }`}
        >
          <Box className="w-3 h-3" /> Primitives
        </button>
      </div>

      {isMinimized ? (
        <div className="p-1.5 flex gap-1 flex-wrap items-center justify-around bg-[#202226] rounded-b-lg">
          {activeTab === 'tools' ? (
            <>
              <button type="button" onClick={onExtrudeFace} title="Extrude (E)" className="p-1.5 cad-button text-cyan-400">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleSubdivide} title="Subdivide" className="p-1.5 cad-button text-amber-400">
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleLoopCut} title="Loop Cut (Ctrl+R)" className="p-1.5 cad-button text-emerald-400">
                <Scissors className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleKnife} title="Knife (K)" className="p-1.5 cad-button text-orange-400">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={onMergeVertices} title="Merge Vertices" className="p-1.5 cad-button text-purple-400">
                <Combine className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => handleSelectPrimitive('cube')} title="Cube" className="p-1.5 cad-button text-[#ed7300]">
                <Box className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => handleSelectPrimitive('sphere')} title="Sphere" className="p-1.5 cad-button text-cyan-400">
                <Box className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => handleSelectPrimitive('cylinder')} title="Cylinder" className="p-1.5 cad-button text-amber-400">
                <Box className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      ) : activeTab === 'tools' ? (
        <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#191b1e] rounded border border-[#101114]">
            {(['object', 'vertex', 'edge', 'face'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setToolState((s) => ({ ...s, editMode: mode }));
                  if (mode !== 'vertex') setSelectedVertexIds([]);
                  if (mode !== 'edge') setSelectedEdgeIds([]);
                  if (mode !== 'face') setSelectedFaceIds([]);
                }}
                className={`py-1 text-center rounded uppercase font-bold text-[9px] transition ${
                  toolState.editMode === mode ? 'bg-[#ed7300] text-white shadow' : 'hover:bg-[#1e2023] text-[#858a93]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <section className="space-y-1">
            <div className="text-[8px] uppercase tracking-wider text-[#858a93] font-bold">Topology & Geometry</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={onExtrudeFace}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-cyan-400"
                title="Extrude selected face or edge along normal"
              >
                <span className="flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3" /> Extrude
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">E</span>
              </button>

              <button
                type="button"
                onClick={onInsetFace}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-amber-400"
                title="Inset face inwards"
              >
                <span className="flex items-center gap-1">
                  <Minimize2 className="w-3 h-3" /> Inset Face
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">I</span>
              </button>

              <button
                type="button"
                onClick={handleSubdivide}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-emerald-400"
                title="Subdivide selected faces (simple) or apply SubD"
              >
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Subdivide
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">W</span>
              </button>

              <button
                type="button"
                onClick={handleLoopCut}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-indigo-400"
                title="Insert loop cut across faces (hover edge, slide, wheel = cuts)"
              >
                <span className="flex items-center gap-1">
                  <Scissors className="w-3 h-3" /> Loop Cut
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">Ctrl+R</span>
              </button>

              <button
                type="button"
                onClick={handleKnife}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-orange-400"
                title="Knife cut: click polyline on mesh, Enter to confirm"
              >
                <span className="flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Knife
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">K</span>
              </button>

              <button
                type="button"
                onClick={handleFillFace}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-rose-400"
                title="Create polygon face from selected vertices"
              >
                <span className="flex items-center gap-1">
                  <Box className="w-3 h-3" /> Fill Face
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">F</span>
              </button>

              <button
                type="button"
                onClick={handleBevel}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-purple-400"
                title="Bevel edges / chamfer"
              >
                <span className="flex items-center gap-1">
                  <CornerDownRight className="w-3 h-3" /> Bevel
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">Ctrl+B</span>
              </button>
            </div>
          </section>

          <section className="space-y-1 pt-1 border-t border-[#101114]">
            <div className="text-[8px] uppercase tracking-wider text-[#858a93] font-bold">Vertices & Symmetry</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={onMergeVertices}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-yellow-400"
                title="Merge selected vertices at center or by distance"
              >
                <span className="flex items-center gap-1">
                  <Combine className="w-3 h-3" /> Merge Verts
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">M</span>
              </button>

              <button
                type="button"
                onClick={onMagnetSnap}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-cyan-300"
                title="Snap selected vertices to nearest grid"
              >
                <span className="flex items-center gap-1">
                  <Magnet className="w-3 h-3" /> Snap Verts
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">Shift+S</span>
              </button>
            </div>

            <div className="flex items-center gap-1 mt-1">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className={`h-6 flex-1 rounded text-[9px] font-bold uppercase ${
                    (toolState.mirrorAxis || 'x') === axis
                      ? 'bg-[#e68619]/25 text-[#e68619] border border-[#e68619]/50'
                      : 'bg-[#101114] text-[#7e838c] border border-[#101114]'
                  }`}
                  onClick={() => setToolState((s) => ({ ...s, mirrorAxis: axis }))}
                >
                  {axis}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[9px] text-[#aaa]">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toolState.mirrorClip !== false}
                  onChange={(e) => setToolState((s) => ({ ...s, mirrorClip: e.target.checked }))}
                />
                Clip
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!toolState.liveMirror}
                  onChange={(e) => setToolState((s) => ({ ...s, liveMirror: e.target.checked }))}
                />
                Live
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!toolState.mirrorBones}
                  onChange={(e) => setToolState((s) => ({ ...s, mirrorBones: e.target.checked }))}
                />
                Bones
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={onMirrorSymmetry}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-fuchsia-400"
                title="Apply mirror (clip + duplicate across axis)"
              >
                <span className="flex items-center gap-1">
                  <GitBranch className="w-3 h-3" /> Apply Mirror
                </span>
                <span className="bg-[#2e3136] px-1 rounded text-[8px] text-[#aaaaaa]">Alt+X</span>
              </button>
              <button
                type="button"
                onClick={onAddMirrorModifier}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-fuchsia-300"
                title="Add non-destructive Mirror modifier"
              >
                <GitBranch className="w-3 h-3" /> + Mod
              </button>
            </div>
          </section>

          <section className="space-y-1 pt-1 border-t border-[#101114]">
            <div className="text-[8px] uppercase tracking-wider text-[#858a93] font-bold">Subdivision Surface</div>
            <div className="grid grid-cols-4 gap-1">
              {[0, 1, 2, 3].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className="cad-button h-7 font-bold text-emerald-400"
                  title={`SubD level ${lvl}`}
                  onClick={() => onAddSubdivision?.(lvl)}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={handleSubdivide}
                className="cad-button h-7 px-2 flex items-center justify-between font-bold text-emerald-400"
                title="Apply Catmull-Clark / simple subdivide to mesh"
              >
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Apply SubD
                </span>
              </button>
              <button
                type="button"
                onClick={onApplyModifiers}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Bake all modifiers into mesh"
              >
                Bake Mods
              </button>
            </div>
            <div className="text-[8px] text-[#51565f]">Ctrl+Shift+D adds SubD · viewport shows levels</div>
          </section>

          <section className="space-y-1 pt-1 border-t border-[#101114]">
            <div className="text-[8px] uppercase tracking-wider text-[#858a93] font-bold">Normals & Selection</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={handleFlipNormals}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Flip face normals direction"
              >
                <FlipHorizontal className="w-3 h-3 text-cyan-400" /> Flip Normals
              </button>
              <button
                type="button"
                onClick={onDuplicateSelected}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Duplicate (Shift+D)"
              >
                <Layers className="w-3 h-3 text-emerald-400" /> Duplicate
              </button>
              <button
                type="button"
                onClick={onSeparateSelected}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Separate selection / loose parts into a new object (P)"
              >
                <Scissors className="w-3 h-3 text-amber-400" /> Separate
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Copy (Ctrl+C)"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onPaste}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold text-[#a6abb4]"
                title="Paste (Ctrl+V)"
              >
                Paste
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="cad-button h-7 px-2 flex items-center gap-1 font-bold !text-rose-400 col-span-2"
                title="Delete selected element"
              >
                <X className="w-3 h-3" /> Delete Selected (Del / X)
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-col max-h-[70vh]">
          <div className="p-2 bg-[#1e1e1e] border-b border-[#3b3f46] flex items-center justify-between font-mono text-[10px]">
            <span className="text-[#7e838c] font-bold">MODE:</span>
            <div className="flex items-center bg-[#2e3136] p-0.5 rounded border border-[#3b3f46]">
              <button
                type="button"
                onClick={() => {
                  setSpawnMode('draw');
                  setToolState((s) => ({ ...s, isCadDrawing: true, placeOnClick: false }));
                }}
                className={`px-2 py-0.5 rounded transition font-bold flex items-center gap-1 ${
                  spawnMode === 'draw'
                    ? 'bg-[#ed7300] text-white shadow-sm'
                    : 'text-[#7e838c] hover:text-white'
                }`}
              >
                <Pencil className="w-3 h-3 text-[#ed7300]" />
                <span>CAD DRAW</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSpawnMode('instant');
                  setToolState((s) => ({ ...s, isCadDrawing: false, placeOnClick: false }));
                }}
                className={`px-2 py-0.5 rounded transition font-bold flex items-center gap-1 ${
                  spawnMode === 'instant'
                    ? 'bg-[#ed7300] text-white shadow-sm'
                    : 'text-[#7e838c] hover:text-white'
                }`}
              >
                <MousePointerClick className="w-3 h-3 text-[#e68619]" />
                <span>INSTANT</span>
              </button>
            </div>
          </div>

          <div className="px-2 py-1 bg-[#202226] border-b border-[#3b3f46] text-[9px] text-[#858a93] font-mono">
            {spawnMode === 'draw'
              ? 'CAD: click in any viewport · 2D = 2 clicks · 3D = base + height'
              : toolState.placeOnClick
                ? `Click any viewport to place ${toolState.activePrimitive}`
                : 'INSTANT: select a primitive, then click any viewport'}
          </div>

          <div className="p-2 grid grid-cols-2 gap-1.5 overflow-y-auto custom-scrollbar bg-[#26282d] flex-1 min-h-0">
            {PRIMITIVES.map((p) => {
              const isSelected =
                (toolState.cadDrawPrimitive === p.type && toolState.isCadDrawing) ||
                (toolState.placeOnClick && toolState.activePrimitive === p.type);

              return (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => handleSelectPrimitive(p.type)}
                  className={`p-2 rounded border flex items-center justify-between text-xs transition text-left font-sans ${
                    isSelected
                      ? 'bg-[#ed7300]/30 border-[#ed7300] text-white font-bold shadow-sm ring-1 ring-[#ed7300]'
                      : 'bg-[#191b1e] border-[#3b3f46] text-[#c6cad1] hover:bg-[#34383f] hover:text-white hover:border-[#ed7300]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Box className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#ed7300]' : 'text-[#858a93]'}`} />
                    <span className="truncate text-[11px]">{p.name}</span>
                  </div>
                  <span className="text-[9px] font-mono text-[#ed7300] font-bold">{isSelected ? '✓' : '+'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

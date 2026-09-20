import React, { useState, useRef, useEffect } from 'react';
import {
  Minus, X, Scissors, Layers, Box, Maximize2,
  Sparkles, GitBranch,
  FlipHorizontal, FlipVertical, CornerDownRight, Pencil, RotateCw, RotateCcw,
} from 'lucide-react';
import type { CADMesh, PrimitiveType, ToolState } from '../types/cad';
import { bevelSelectedEdges } from '../utils/advancedMeshTools';
import { fillTargets, resolveOperatorTargets, subdivideTargets } from '../utils/meshOperators';
import { flipFaceNormals } from '../utils/blockbenchCore';
import { BlenderIcon } from './icons/BlenderIcon';
import { flipMesh, rotateMesh90, triangulateMeshFaces } from '../utils/meshUtils';
import { originToBottom, originToGeometry, originToSelection, originToWorldZero } from '../utils/meshOrigin';

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
  { type: 'cube', name: 'Cube' },
  { type: 'cylinder', name: 'Cylinder' },
  { type: 'cone', name: 'Cone' },
  { type: 'sphere', name: 'Sphere' },
  { type: 'torus', name: 'Torus' },
  { type: 'torusKnot', name: 'Torus knot' },
  { type: 'pyramid', name: 'Pyramid' },
  { type: 'octahedron', name: 'Octahedron' },
  { type: 'dodecahedron', name: 'Dodecahedron' },
  { type: 'icosahedron', name: 'Icosahedron' },
  { type: 'tetrahedron', name: 'Tetrahedron' },
  { type: 'plane', name: 'Plane', is2D: true },
  { type: 'circle', name: 'Circle', is2D: true },
  { type: 'ring', name: 'Ring', is2D: true },
  { type: 'tube', name: 'Tube' },
  { type: 'ramp', name: 'Ramp' },
  { type: 'wall', name: 'Wall' },
  { type: 'window', name: 'Window' },
  { type: 'stairs', name: 'Stairs' },
  { type: 'roof', name: 'Roof' },
  { type: 'arch', name: 'Arch' },
  { type: 'ladder', name: 'Ladder' },
  { type: 'chest', name: 'Chest' },
  { type: 'car', name: 'Car' },
  { type: 'tree', name: 'Tree' },
];

function ToolCmd({
  label,
  kbd,
  onClick,
  icon,
  danger,
  title,
}: {
  label: string;
  kbd?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`tool-cmd ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      title={title ?? (kbd ? `${label} (${kbd})` : label)}
    >
      <span className="tool-cmd__icon" aria-hidden>{icon}</span>
      <span className="tool-cmd__label">{label}</span>
      {kbd ? <kbd className="tool-cmd__kbd">{kbd}</kbd> : null}
    </button>
  );
}

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
  mesh,
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
        x: Math.max(10, Math.min(window.innerWidth - 320, e.clientX - dragStartRef.current.x)),
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

  /** Active sub-object mode the tool buttons resolve against. */
  const componentMode: 'vertex' | 'edge' | 'face' =
    toolState.editMode === 'vertex' || toolState.editMode === 'edge' || toolState.editMode === 'face'
      ? toolState.editMode
      : 'face';

  const resolveTargets = () =>
    resolveOperatorTargets(mesh, componentMode, {
      vertexIds: selectedVertexIds,
      edgeIds: selectedEdgeIds,
      faceIds: selectedFaceIds,
    });

  const handleSubdivide = () => {
    if (onApplySubdivide) {
      onApplySubdivide();
      return;
    }
    const targets = resolveTargets();
    if (targets.edgeIds.length === 0) return;
    setMesh((prev) => subdivideTargets(prev, targets, 1));
  };

  const handleLoopCut = () => {
    if (onLoopCut) onLoopCut();
  };

  const handleKnife = () => {
    if (onKnife) onKnife();
  };

  const handleFillFace = () => {
    const targets = resolveTargets();
    setMesh((prev) => fillTargets(prev, targets, componentMode));
  };

  const handleBevel = () => {
    if (onBevelEdges) {
      onBevelEdges();
      return;
    }
    const targets = resolveTargets();
    if (targets.edgeIds.length > 0) {
      setMesh((prev) => bevelSelectedEdges(prev, targets.edgeIds));
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
    } else {
      setMesh((prev) => {
        let current = prev;
        prev.faces.forEach((f) => {
          current = flipFaceNormals(current, f.id);
        });
        return current;
      });
    }
  };

  const selectedVertIds = (): string[] | null => {
    const mode = toolState.editMode;
    if (mode === 'object' || mode === 'bone') return null;
    if (mode === 'vertex') return selectedVertexIds.length ? selectedVertexIds : null;
    if (mode === 'edge') {
      const ids = new Set<string>();
      for (const e of mesh.edges) {
        if (selectedEdgeIds.includes(e.id)) {
          ids.add(e.v1Id);
          ids.add(e.v2Id);
        }
      }
      return ids.size ? [...ids] : null;
    }
    const ids = new Set<string>();
    for (const f of mesh.faces) {
      if (selectedFaceIds.includes(f.id)) {
        f.vertexIds.forEach((id) => ids.add(id));
      }
    }
    return ids.size ? [...ids] : null;
  };

  const applyFlip = (axis: 'x' | 'y' | 'z') => {
    setMesh((prev) => flipMesh(prev, axis, selectedVertIds()));
  };

  const applyRotate90 = (axis: 'x' | 'y' | 'z', clockwise = false) => {
    setMesh((prev) => rotateMesh90(prev, axis, clockwise, selectedVertIds()));
  };

  const handleTriangulate = () => {
    setMesh((prev) =>
      triangulateMeshFaces(prev, toolState.editMode === 'face' && selectedFaceIds.length ? selectedFaceIds : undefined),
    );
  };

  const handleRecenter = () => {
    setMesh((prev) => originToGeometry(prev));
  };
  const handleOriginToSelection = () => {
    setMesh((prev) => originToSelection(prev, selectedVertIds()));
  };
  const handleOriginToWorld = () => {
    setMesh((prev) => originToWorldZero(prev));
  };
  const handleOriginToBottom = () => {
    setMesh((prev) => originToBottom(prev));
  };

  const mode = toolState.editMode === 'bone' ? 'object' : toolState.editMode;
  const isObject = mode === 'object';
  const isVertex = mode === 'vertex';
  const isEdge = mode === 'edge';
  const isFace = mode === 'face';

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

  const title = activeTab === 'tools' ? 'Tools' : 'Primitives';

  return (
    <div
      className="ts-float"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: isMinimized ? '220px' : '300px',
      }}
    >
      <div onMouseDown={handleMouseDown} className="ts-float__bar">
        <span className="ts-float__title">{title}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="ts-btn ts-btn--ghost w-7 h-7"
            title={isMinimized ? 'Expand' : 'Minimize'}
            aria-label={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ts-btn ts-btn--ghost w-7 h-7"
            title="Close"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex border-b border-[#1a1c22]">
        <button
          type="button"
          onClick={() => { setActiveTab('tools'); setIsMinimized(false); }}
          className={`flex-1 insp-tab h-8 ${activeTab === 'tools' ? 'is-on' : ''}`}
        >
          Tools
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('primitives'); setIsMinimized(false); }}
          className={`flex-1 insp-tab h-8 ${activeTab === 'primitives' ? 'is-on' : ''}`}
        >
          Primitives
        </button>
      </div>

      {isMinimized ? (
        <div className="p-1.5 flex gap-1 flex-wrap items-center justify-around bg-[#202226] rounded-b-lg">
          {activeTab === 'tools' ? (
            <>
              <button type="button" onClick={onExtrudeFace} title="Extrude (E)" className="tool-cmd" aria-label="Extrude">
                <BlenderIcon name="extrude" size={14} />
              </button>
              <button type="button" onClick={handleSubdivide} title="Subdivide (W)" className="tool-cmd" aria-label="Subdivide">
                <BlenderIcon name="inset" size={14} />
              </button>
              <button type="button" onClick={handleLoopCut} title="Loop Cut (Ctrl+R)" className="tool-cmd" aria-label="Loop cut">
                <Scissors className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={handleKnife} title="Knife (K)" className="tool-cmd" aria-label="Knife">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={onMergeVertices} title="Merge vertices (M)" className="tool-cmd" aria-label="Merge vertices">
                <BlenderIcon name="weld" size={14} />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => handleSelectPrimitive('cube')} title="Cube" className="p-1.5 cad-button text-[#00b4c4]" aria-label="Cube">
                <BlenderIcon name="object" size={14} />
              </button>
              <button type="button" onClick={() => handleSelectPrimitive('sphere')} title="Sphere" className="p-1.5 cad-button text-[#00b4c4]" aria-label="Sphere">
                <BlenderIcon name="object" size={14} />
              </button>
              <button type="button" onClick={() => handleSelectPrimitive('cylinder')} title="Cylinder" className="p-1.5 cad-button text-[#00b4c4]" aria-label="Cylinder">
                <BlenderIcon name="object" size={14} />
              </button>
            </>
          )}
        </div>
      ) : activeTab === 'tools' ? (
        <div className="max-h-[70vh] overflow-y-auto custom-scrollbar pb-2">
          <div className="px-2 pt-2">
            <div className="ts-seg w-full">
              {([
                ['object', 'Object'],
                ['vertex', 'Vertex'],
                ['edge', 'Edge'],
                ['face', 'Face'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setToolState((s) => ({ ...s, editMode: mode }));
                    if (mode !== 'vertex') setSelectedVertexIds([]);
                    if (mode !== 'edge') setSelectedEdgeIds([]);
                    if (mode !== 'face') setSelectedFaceIds([]);
                  }}
                  className={`ts-seg__item flex-1 ${toolState.editMode === mode ? 'ts-seg__item--active' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ts-section-header">
            {isObject ? 'Object' : isVertex ? 'Vertex' : isEdge ? 'Edge' : 'Face'}
          </div>

          <div className="grid grid-cols-2 gap-1 px-1">
            {(isObject || isFace || isEdge) && (
              <ToolCmd label="Extrude" kbd="E" onClick={onExtrudeFace} icon={<BlenderIcon name="extrude" size={14} />} />
            )}
            {isFace && (
              <ToolCmd label="Inset" kbd="I" onClick={onInsetFace} icon={<BlenderIcon name="inset" size={14} />} />
            )}
            {(isFace || isEdge) && (
              <ToolCmd label="Bevel" kbd="Ctrl+B" onClick={handleBevel} icon={<CornerDownRight className="w-3.5 h-3.5" />} />
            )}
            {(isFace || isEdge) && (
              <ToolCmd label="Subdivide" kbd="W" onClick={handleSubdivide} icon={<Sparkles className="w-3.5 h-3.5" />} />
            )}
            {isEdge && (
              <ToolCmd label="Loop cut" kbd="Ctrl+R" onClick={handleLoopCut} icon={<Scissors className="w-3.5 h-3.5" />} />
            )}
            {(isEdge || isFace) && (
              <ToolCmd label="Knife" kbd="K" onClick={handleKnife} icon={<Pencil className="w-3.5 h-3.5" />} />
            )}
            {isVertex && (
              <ToolCmd label="Fill face" kbd="F" onClick={handleFillFace} icon={<Box className="w-3.5 h-3.5" />} />
            )}
            {(isVertex || isEdge) && (
              <ToolCmd label="Merge" kbd="M" onClick={onMergeVertices} icon={<BlenderIcon name="weld" size={14} />} />
            )}
            {isVertex && (
              <ToolCmd label="Snap" kbd="Shift+S" onClick={onMagnetSnap} icon={<BlenderIcon name="magnet" size={14} />} />
            )}
            {isFace && (
              <ToolCmd label="Flip normals" onClick={handleFlipNormals} icon={<FlipHorizontal className="w-3.5 h-3.5" />} />
            )}
            {isFace && (
              <ToolCmd label="Triangulate" onClick={handleTriangulate} icon={<Box className="w-3.5 h-3.5" />} />
            )}
            {(isFace || isObject) && (
              <ToolCmd label="Separate" kbd="P" onClick={onSeparateSelected} icon={<Scissors className="w-3.5 h-3.5" />} />
            )}
          </div>

          <div className="ts-section-header">Transform</div>
          <div className="grid grid-cols-2 gap-1 px-1">
            <ToolCmd label="Flip H" title="Flip left-right (X)" onClick={() => applyFlip('x')} icon={<FlipHorizontal className="w-3.5 h-3.5" />} />
            <ToolCmd label="Flip V" title="Flip up-down (Y)" onClick={() => applyFlip('y')} icon={<FlipVertical className="w-3.5 h-3.5" />} />
            <ToolCmd label="Flip depth" title="Flip front-back (Z)" onClick={() => applyFlip('z')} icon={<BlenderIcon name="mirror" size={14} />} />
            <ToolCmd label="Rotate 90" title="Rotate 90 around up" onClick={() => applyRotate90('y', false)} icon={<RotateCw className="w-3.5 h-3.5" />} />
            <ToolCmd label="Rotate -90" title="Rotate -90 around up" onClick={() => applyRotate90('y', true)} icon={<RotateCcw className="w-3.5 h-3.5" />} />
            <ToolCmd label="Tilt 90" title="Rotate 90 around X" onClick={() => applyRotate90('x', false)} icon={<RotateCw className="w-3.5 h-3.5" />} />
            {isObject && (
              <>
                <ToolCmd
                  label="Transform"
                  kbd="T"
                  onClick={() => setToolState((s) => ({ ...s, transformMode: 'combined' }))}
                  icon={<BlenderIcon name="transform" size={16} />}
                />
                <ToolCmd
                  label="Move"
                  kbd="G"
                  onClick={() => setToolState((s) => ({ ...s, transformMode: 'move' }))}
                  icon={<BlenderIcon name="move" size={16} />}
                />
                <ToolCmd
                  label="Rotate"
                  kbd="R"
                  onClick={() => setToolState((s) => ({ ...s, transformMode: 'rotate' }))}
                  icon={<BlenderIcon name="rotate" size={16} />}
                />
                <ToolCmd
                  label="Scale"
                  kbd="S"
                  onClick={() => setToolState((s) => ({ ...s, transformMode: 'scale' }))}
                  icon={<BlenderIcon name="scale" size={16} />}
                />
                <ToolCmd
                  label="Pivot"
                  kbd="."
                  onClick={() => setToolState((s) => ({ ...s, transformMode: 'pivot' }))}
                  icon={<BlenderIcon name="pivot" size={16} />}
                />
                <ToolCmd label="Origin to center" onClick={handleRecenter} icon={<BlenderIcon name="center" size={16} />} />
                <ToolCmd label="Origin to selection" onClick={handleOriginToSelection} icon={<BlenderIcon name="select" size={16} />} />
                <ToolCmd label="Origin to world 0" onClick={handleOriginToWorld} icon={<BlenderIcon name="orientationGlobal" size={16} />} />
                <ToolCmd label="Origin to bottom" onClick={handleOriginToBottom} icon={<BlenderIcon name="object" size={16} />} />
              </>
            )}
          </div>

          {isObject && (
            <>
              <div className="ts-section-header">Mirror</div>
              <div className="px-2 pb-1">
                <div className="ts-seg w-full">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      className={`ts-seg__item flex-1 ${
                        (toolState.mirrorAxis || 'x') === axis ? 'ts-seg__item--active' : ''
                      }`}
                      onClick={() => setToolState((s) => ({ ...s, mirrorAxis: axis }))}
                    >
                      {axis.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 px-1 pt-2">
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={toolState.mirrorClip !== false}
                      onChange={(e) => setToolState((s) => ({ ...s, mirrorClip: e.target.checked }))}
                    />
                    Clip
                  </label>
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={!!toolState.liveMirror}
                      onChange={(e) => setToolState((s) => ({ ...s, liveMirror: e.target.checked }))}
                    />
                    Live
                  </label>
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={!!toolState.mirrorBones}
                      onChange={(e) => setToolState((s) => ({ ...s, mirrorBones: e.target.checked }))}
                    />
                    Bones
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 px-1">
                <ToolCmd label="Apply mirror" kbd="Alt+X" onClick={onMirrorSymmetry} icon={<BlenderIcon name="mirror" size={14} />} />
                <ToolCmd label="Add modifier" onClick={onAddMirrorModifier} icon={<GitBranch className="w-3.5 h-3.5" />} />
              </div>

              <div className="ts-section-header">Subdivision</div>
              <div className="px-2 pb-1">
                <div className="ts-seg w-full">
                  {[0, 1, 2, 3].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className="ts-seg__item flex-1"
                      title={`Subdivision level ${lvl}`}
                      onClick={() => onAddSubdivision?.(lvl)}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 px-1">
                <ToolCmd label="Apply SubD" onClick={handleSubdivide} icon={<Sparkles className="w-3.5 h-3.5" />} />
                <ToolCmd label="Bake modifiers" onClick={onApplyModifiers} icon={<Layers className="w-3.5 h-3.5" />} />
              </div>
            </>
          )}

          <div className="ts-section-header">Edit</div>
          <div className="grid grid-cols-2 gap-1 px-1">
            <ToolCmd label="Duplicate" kbd="Shift+D" onClick={onDuplicateSelected} icon={<Layers className="w-3.5 h-3.5" />} />
            <ToolCmd label="Copy" kbd="Ctrl+C" onClick={onCopy} />
            <ToolCmd label="Paste" kbd="Ctrl+V" onClick={onPaste} />
            <ToolCmd label="Delete" kbd="X" onClick={onDeleteSelected} icon={<X className="w-3.5 h-3.5" />} danger />
          </div>
        </div>
      ) : (
        <div className="flex flex-col max-h-[70vh]">
          <div className="px-2 py-2 border-b border-[#1a1c22] flex flex-col gap-1.5">
            <div className="ts-seg w-full">
              <button
                type="button"
                onClick={() => {
                  setSpawnMode('draw');
                  setToolState((s) => ({ ...s, isCadDrawing: true, placeOnClick: false }));
                }}
                className={`ts-seg__item flex-1 ${spawnMode === 'draw' ? 'ts-seg__item--active' : ''}`}
              >
                Draw
              </button>
              <button
                type="button"
                onClick={() => {
                  setSpawnMode('instant');
                  setToolState((s) => ({ ...s, isCadDrawing: false, placeOnClick: false }));
                }}
                className={`ts-seg__item flex-1 ${spawnMode === 'instant' ? 'ts-seg__item--active' : ''}`}
              >
                Place
              </button>
            </div>
            <p className="text-[11.5px] text-[#6e7584] m-0 leading-snug">
              {spawnMode === 'draw'
                ? 'Click in the viewport to draw size'
                : toolState.placeOnClick
                  ? `Click to place ${toolState.activePrimitive}`
                  : 'Pick a shape, then click in the viewport'}
            </p>
          </div>

          <div className="p-1 overflow-y-auto custom-scrollbar flex-1 min-h-0">
            {(['3D', '2D'] as const).map((group) => (
              <div key={group} className="mb-2">
                <div className="ts-section-header">{group}</div>
                <div className="grid grid-cols-2 gap-1 px-1">
                  {PRIMITIVES.filter((p) => (group === '2D') === !!p.is2D).map((p) => {
                    const isSelected =
                      (toolState.cadDrawPrimitive === p.type && toolState.isCadDrawing) ||
                      (toolState.placeOnClick && toolState.activePrimitive === p.type);
                    return (
                      <button
                        key={p.type}
                        type="button"
                        onClick={() => handleSelectPrimitive(p.type)}
                        className={`prim-row ${isSelected ? 'is-on' : ''}`}
                        aria-pressed={isSelected}
                      >
                        <BlenderIcon name="object" size={14} />
                        <span className="truncate">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

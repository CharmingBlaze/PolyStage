import React from 'react';
import {
  Box,
  Move,
  RotateCw,
  Maximize2,
  Paintbrush,
  Pencil,
  Eraser,
  Pipette,
  PaintBucket,
  SprayCan,
  FlipHorizontal,
  Magnet,
  Minimize,
  Grid,
  Bone,
  CircleDot,
  GitCommitHorizontal,
  Square,
  CheckSquare,
  SquareDashed,
  MousePointer2,
  PersonStanding,
  Hand,
} from 'lucide-react';
import type { ToolState, EditMode, TransformMode, RigMode } from '../types/cad';

interface ToolbarProps {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onSpawnPrimitive: (type: import('../types/cad').PrimitiveType) => void;
  onExtrudeFace: () => void;
  onInsetFace: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onMergeVertices: () => void;
  onMirrorSymmetry: () => void;
  onMagnetSnap: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  /** When true, keep 3D painting armed (Paint workspace). */
  paintWorkspace?: boolean;
  /** When true, show Easy Rig tools (edit / pose / skin). */
  rigWorkspace?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  toolState,
  setToolState,
  onExtrudeFace,
  onInsetFace,
  onMergeVertices,
  onMirrorSymmetry,
  onMagnetSnap,
  onSelectAll,
  onDeselectAll,
  paintWorkspace = false,
  rigWorkspace = false,
}) => {
  const editModes: { id: EditMode; label: string; icon: any; shortcut: string }[] = [
    { id: 'object', label: 'Object', icon: Box, shortcut: '1' },
    { id: 'vertex', label: 'Vertex', icon: CircleDot, shortcut: '2' },
    { id: 'edge', label: 'Edge', icon: GitCommitHorizontal, shortcut: '3' },
    { id: 'face', label: 'Face', icon: Square, shortcut: '4' },
    { id: 'bone', label: 'Bone', icon: Bone, shortcut: '5' },
  ];

  const rigModes: { id: RigMode; label: string; icon: any; title: string }[] = [
    { id: 'edit', label: 'Edit', icon: Bone, title: 'Build & parent skeleton' },
    { id: 'pose', label: 'Pose', icon: PersonStanding, title: 'Pose bones + IK' },
    { id: 'skin', label: 'Skin', icon: Hand, title: 'Weight paint skinning' },
  ];

  const transformModes: { id: TransformMode; label: string; icon: any; shortcut: string }[] = [
    { id: 'move', label: 'Move', icon: Move, shortcut: 'G' },
    { id: 'rotate', label: 'Rotate', icon: RotateCw, shortcut: 'R' },
    { id: 'scale', label: 'Scale', icon: Maximize2, shortcut: 'S' },
  ];

  const gridSnapValues = [0, 0.1, 0.25, 0.5, 1.0];
  const activeRigMode = toolState.rigMode || 'edit';

  const setRigMode = (mode: RigMode) => {
    setToolState((s) => ({
      ...s,
      editMode: 'bone',
      rigMode: mode,
      showBones: true,
      isPainting3D: false,
      brushSize: mode === 'skin' ? Math.max(s.brushSize || 1, 2) : s.brushSize,
      weightPaintMode: s.weightPaintMode || 'add',
    }));
  };

  return (
    <aside className="w-10 bg-[#1c1c1c] border-r border-[#323232] flex flex-col items-center py-1.5 gap-1.5 z-[90] font-sans select-none text-[#e0e0e0] shadow-md">
      <div className="w-7 h-5 rounded bg-[#262626] border border-[#383838] flex items-center justify-center text-[#1473e6] font-bold font-mono text-[9px] shadow-sm">
        {rigWorkspace ? 'Rig' : 'Tools'}
      </div>

      <div className="w-5 h-px bg-[#323232]" />

      {rigWorkspace ? (
        <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
          {rigModes.map((mode) => {
            const Icon = mode.icon;
            const isActive = activeRigMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setRigMode(mode.id)}
                className={`w-7 h-7 rounded flex items-center justify-center transition relative group ${
                  isActive
                    ? 'bg-[#1473e6] text-white shadow-md font-bold'
                    : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white'
                }`}
                title={mode.title}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                  {mode.label} — {mode.title}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
          {editModes.map((mode) => {
            const Icon = mode.icon;
            const isActive = toolState.editMode === mode.id && !toolState.isPainting3D;
            return (
              <button
                key={mode.id}
                onClick={() => setToolState((s) => ({
                  ...s,
                  editMode: mode.id,
                  isPainting3D: paintWorkspace ? true : false,
                }))}
                className={`w-7 h-7 rounded flex items-center justify-center transition relative group ${
                  isActive
                    ? 'bg-[#1473e6] text-white shadow-md font-bold'
                    : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white'
                }`}
                title={`${mode.label} Mode (${mode.shortcut})`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                  {mode.label} Mode ({mode.shortcut})
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="w-5 h-px bg-[#323232]" />

      <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
        <button
          onClick={onSelectAll}
          className="w-7 h-7 bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white rounded flex items-center justify-center transition relative group"
          title="Select All (A)"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
            Select All (A)
          </span>
        </button>
        <button
          onClick={onDeselectAll}
          className="w-7 h-7 bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white rounded flex items-center justify-center transition relative group"
          title="Deselect All (Alt+A)"
        >
          <SquareDashed className="w-3.5 h-3.5" />
          <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
            Deselect All (Alt+A)
          </span>
        </button>
      </div>

      <div className="w-5 h-px bg-[#323232]" />

      <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
        {transformModes.map((mode) => {
          const Icon = mode.icon;
          const isActive = toolState.transformMode === mode.id && !toolState.isPainting3D;
          return (
            <button
              key={mode.id}
              onClick={() => setToolState((s) => ({
                ...s,
                transformMode: mode.id,
                isPainting3D: paintWorkspace ? true : false,
              }))}
              className={`w-7 h-7 rounded flex items-center justify-center transition relative group ${
                isActive
                  ? 'bg-[#1473e6] text-white shadow-md font-bold'
                  : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white'
              }`}
              title={`${mode.label} Transform (${mode.shortcut})`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                {mode.label} ({mode.shortcut})
              </span>
            </button>
          );
        })}
      </div>

      <div className="w-5 h-px bg-[#323232]" />

      {!rigWorkspace && (
        <>
          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={() =>
                setToolState((s) => {
                  if (paintWorkspace) {
                    return {
                      ...s,
                      isPainting3D: true,
                      viewMode: 'textured',
                      editMode: 'object',
                      drawTool: s.drawTool || 'pencil',
                    };
                  }
                  const next = !s.isPainting3D;
                  return {
                    ...s,
                    isPainting3D: next,
                    viewMode: next ? 'textured' : s.viewMode,
                    editMode: next ? 'object' : s.editMode,
                    drawTool: next ? 'pencil' : s.drawTool,
                  };
                })
              }
              className={`w-7 h-7 rounded flex items-center justify-center transition relative group ${
                toolState.isPainting3D
                  ? 'bg-[#1473e6] text-white font-semibold shadow-md'
                  : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white'
              }`}
              title={paintWorkspace ? 'Paint on 3D mesh (always on in Paint mode)' : 'Paint on 3D mesh (B)'}
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Paint on 3D (B)
              </span>
            </button>
            {toolState.isPainting3D && (
              <input
                type="color"
                value={toolState.activeColor || '#02a0e8'}
                onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
                className="w-6 h-5 bg-transparent border-0 cursor-pointer"
                title="Brush color"
              />
            )}
            {toolState.isPainting3D && (
              <div className="adobe-menu fixed left-10 top-[76px] z-[100] w-56 p-3 text-[10px] font-mono">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-[#2680eb]">3D PAINT BRUSH</span>
                  <span className="text-[#8c8c8c]">B / E / I</span>
                </div>
                <div className="grid grid-cols-5 gap-1 mb-3">
                  {[
                    { id: 'pencil', icon: Pencil, label: 'Brush' },
                    { id: 'eraser', icon: Eraser, label: 'Erase' },
                    { id: 'picker', icon: Pipette, label: 'Pick' },
                    { id: 'fill', icon: PaintBucket, label: 'Fill' },
                    { id: 'spray', icon: SprayCan, label: 'Spray' },
                    { id: 'select', icon: MousePointer2, label: 'Select' },
                  ].map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => setToolState((s) => ({ ...s, drawTool: id as ToolState['drawTool'] }))}
                      className={`h-8 rounded flex items-center justify-center border transition ${
                        toolState.drawTool === id
                          ? 'bg-[#1473e6] border-[#1473e6] text-white'
                          : 'bg-[#2d2d2d] border-[#3e3e3e] text-[#b3b3b3] hover:bg-[#383838] hover:text-white'
                      }`}
                      title={label}
                    >
                      <Icon className="w-3.5 h-3.5"/>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="color"
                    value={toolState.activeColor || '#02a0e8'}
                    onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
                    className="w-8 h-8 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <span className="flex-1">
                    <span className="block text-[#8c8c8c] mb-1">COLOR</span>
                    <span className="text-[#e8e8e8]">{toolState.activeColor.toUpperCase()}</span>
                  </span>
                </label>
                <label className="block mb-2 text-[#b3b3b3]">
                  <span>SIZE</span><b className="float-right text-[#2680eb]">{toolState.brushSize}px</b>
                  <input type="range" min="1" max="16" value={toolState.brushSize} onChange={(e) => setToolState((s) => ({...s, brushSize: +e.target.value}))} className="w-full"/>
                </label>
                <label className="block mb-2 text-[#b3b3b3]">
                  <span>OPACITY</span><b className="float-right text-[#2680eb]">{Math.round(toolState.paintOpacity * 100)}%</b>
                  <input type="range" min="0.05" max="1" step="0.05" value={toolState.paintOpacity} onChange={(e) => setToolState((s) => ({...s, paintOpacity: +e.target.value}))} className="w-full"/>
                </label>
                <label className="block mb-3 text-[#b3b3b3]">
                  <span>SPACING</span><b className="float-right text-[#2680eb]">{Math.round(toolState.paintSpacing * 100)}%</b>
                  <input type="range" min="0.1" max="1" step="0.05" value={toolState.paintSpacing} onChange={(e) => setToolState((s) => ({...s, paintSpacing: +e.target.value}))} className="w-full"/>
                </label>
                <button
                  onClick={() => setToolState((s) => ({...s, paintMirrorU: !s.paintMirrorU}))}
                  className={`adobe-control w-full h-7 text-[10px] flex items-center justify-center gap-1.5 ${toolState.paintMirrorU ? 'is-active' : ''}`}
                >
                  <FlipHorizontal className="w-3 h-3"/> MIRROR ACROSS U
                </button>
                <div className="mt-2 text-[#8c8c8c] leading-relaxed">LMB on model paints · empty LMB orbits · continuous seam-aware strokes</div>
              </div>
            )}
          </div>

          <div className="w-5 h-px bg-[#323232]" />

          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={onExtrudeFace}
              className="w-7 h-7 bg-[#262626] text-[#e68619] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
              title="Extrude Face (E)"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Extrude Face (E)
              </span>
            </button>

            <button
              onClick={onInsetFace}
              className="w-7 h-7 bg-[#262626] text-[#2680eb] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
              title="Inset Face (I)"
            >
              <Minimize className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Inset Face (I)
              </span>
            </button>

            <button
              onClick={onMergeVertices}
              className="w-7 h-7 bg-[#262626] text-[#2680eb] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
              title="Weld / Merge Vertices"
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Weld Vertices
              </span>
            </button>

            <button
              onClick={onMirrorSymmetry}
              className="w-7 h-7 bg-[#262626] text-[#2d9d78] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
              title="Mirror Symmetry (X)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Mirror Symmetry
              </span>
            </button>

            <button
              onClick={onMagnetSnap}
              className="w-7 h-7 bg-[#262626] text-[#ec5b62] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
              title="Magnet Vertex Snap"
            >
              <Magnet className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
                Magnet Vertex Snap
              </span>
            </button>
          </div>
        </>
      )}

      {rigWorkspace && (
        <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
          <button
            type="button"
            onClick={() => setRigMode('skin')}
            className={`w-7 h-7 rounded flex items-center justify-center transition relative group ${
              activeRigMode === 'skin'
                ? 'bg-[#ec5b62] text-white shadow-md'
                : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#383838] hover:text-white'
            }`}
            title="Weight paint"
          >
            <Paintbrush className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
              Weight Paint
            </span>
          </button>
          <button
            type="button"
            onClick={onMirrorSymmetry}
            className="w-7 h-7 bg-[#262626] text-[#2d9d78] hover:bg-[#383838] rounded flex items-center justify-center transition relative group"
            title="Mirror bones / symmetry"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#121212] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#383838]">
              Mirror Symmetry
            </span>
          </button>
        </div>
      )}

      <div className="mt-auto flex flex-col items-center gap-0.5">
        <span className="text-[7.5px] font-mono text-[#888888]">SNAP</span>
        <select
          value={toolState.gridSnap}
          onChange={(e) => setToolState((s) => ({ ...s, gridSnap: parseFloat(e.target.value) }))}
          className="bg-[#121212] text-[#1473e6] text-[8.5px] font-mono p-0.5 rounded border border-[#383838] outline-none cursor-pointer text-center w-8"
        >
          {gridSnapValues.map((val) => (
            <option key={val} value={val}>
              {val === 0 ? 'OFF' : `${val}`}
            </option>
          ))}
        </select>
      </div>
    </aside>
  );
};

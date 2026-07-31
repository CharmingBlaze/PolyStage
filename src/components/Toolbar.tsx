import React, { useEffect, useRef, useState } from 'react';
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
  GripHorizontal,
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
  const [paintPanelPos, setPaintPanelPos] = useState({ x: 40, y: 72 });
  const [draggingPaintPanel, setDraggingPaintPanel] = useState(false);
  const paintDragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!draggingPaintPanel) return;
    const onMove = (e: MouseEvent) => {
      setPaintPanelPos({
        x: Math.max(8, Math.min(window.innerWidth - 240, e.clientX - paintDragOffsetRef.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 80, e.clientY - paintDragOffsetRef.current.y)),
      });
    };
    const onUp = () => setDraggingPaintPanel(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingPaintPanel]);

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
    <aside className="w-10 sp-tool-shelf flex flex-col items-center py-1.5 gap-1 z-[90] font-sans select-none text-[#cccccc]">
      <div className="w-7 h-5 bg-[#262626] border border-[#1a1a1a] flex items-center justify-center text-[#ed7300] font-bold text-[8px] uppercase tracking-wide">
        {rigWorkspace ? 'Rig' : 'Tools'}
      </div>

      <div className="sp-sep-h is-rail" />

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
                className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
                title={mode.title}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
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
                className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
                title={`${mode.label} Mode (${mode.shortcut})`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
                  {mode.label} Mode ({mode.shortcut})
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="sp-sep-h is-rail" />

      <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
        <button
          onClick={onSelectAll}
          className="sp-tool-btn relative group"
          title="Select All (A)"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
            Select All (A)
          </span>
        </button>
        <button
          onClick={onDeselectAll}
          className="sp-tool-btn relative group"
          title="Deselect All (Alt+A)"
        >
          <SquareDashed className="w-3.5 h-3.5" />
          <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
            Deselect All (Alt+A)
          </span>
        </button>
      </div>

      <div className="sp-sep-h is-rail" />

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
              className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
              title={`${mode.label} Transform (${mode.shortcut})`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
                {mode.label} ({mode.shortcut})
              </span>
            </button>
          );
        })}
      </div>

      <div className="sp-sep-h is-rail" />

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
              className={`sp-tool-btn relative group ${
                toolState.isPainting3D ? 'is-active' : ''
              }`}
              title={paintWorkspace ? 'Paint on 3D mesh (always on in Paint mode)' : 'Paint on 3D mesh (B)'}
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#4d4d4d] text-[#cccccc] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#1a1a1a]">
                Paint on 3D (B)
              </span>
            </button>
            {toolState.isPainting3D && (
              <input
                type="color"
                value={toolState.activeColor || '#ff9a3c'}
                onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
                className="w-6 h-6 p-0 border border-[#4d4d4d] rounded-sm bg-transparent cursor-pointer"
                title="Brush color"
              />
            )}
            {toolState.isPainting3D && (
              <div
                className="sp-paint3d fixed z-[100] w-[220px]"
                style={{ left: paintPanelPos.x, top: paintPanelPos.y }}
              >
                <div
                  className={`sp-paint3d__head ${draggingPaintPanel ? 'is-dragging' : ''}`}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    setDraggingPaintPanel(true);
                    paintDragOffsetRef.current = {
                      x: e.clientX - paintPanelPos.x,
                      y: e.clientY - paintPanelPos.y,
                    };
                  }}
                >
                  <span className="sp-paint3d__accent" aria-hidden />
                  <GripHorizontal className="sp-paint3d__grip" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="sp-paint3d__title">Paint Properties</div>
                    <div className="sp-paint3d__sub">3D Brush · B E I</div>
                  </div>
                  <button
                    type="button"
                    className="sp-paint3d__close"
                    title="Close 3D paint (B)"
                    onClick={() => {
                      if (paintWorkspace) return;
                      setToolState((s) => ({ ...s, isPainting3D: false }));
                    }}
                  >
                    ×
                  </button>
                </div>

                <div className="sp-paint3d__section">
                  <div className="sp-paint3d__label">Tool</div>
                  <div className="sp-paint3d__tools">
                    {[
                      { id: 'pencil', icon: Pencil, label: 'Brush (B)' },
                      { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
                      { id: 'picker', icon: Pipette, label: 'Picker (I)' },
                      { id: 'fill', icon: PaintBucket, label: 'Fill' },
                      { id: 'spray', icon: SprayCan, label: 'Spray' },
                      { id: 'select', icon: MousePointer2, label: 'Select' },
                    ].map(({ id, icon: Icon, label }) => (
                      <button
                        key={id}
                        type="button"
                        title={label}
                        onClick={() => setToolState((s) => ({ ...s, drawTool: id as ToolState['drawTool'] }))}
                        className={`sp-paint3d__tool ${toolState.drawTool === id ? 'is-active' : ''}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sp-paint3d__section">
                  <div className="sp-paint3d__label">Color</div>
                  <label className="sp-paint3d__color">
                    <input
                      type="color"
                      value={toolState.activeColor || '#ff9a3c'}
                      onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
                      className="sp-paint3d__swatch"
                      title="Brush color"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="sp-paint3d__hex">{(toolState.activeColor || '#ff9a3c').toUpperCase()}</div>
                      <div className="sp-paint3d__hint">Click swatch to pick</div>
                    </div>
                  </label>
                </div>

                <div className="sp-paint3d__section sp-paint3d__props">
                  <label className="sp-paint3d__prop">
                    <div className="sp-paint3d__prop-row">
                      <span>Size</span>
                      <b>{toolState.brushSize} px</b>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="16"
                      value={toolState.brushSize}
                      onChange={(e) => setToolState((s) => ({ ...s, brushSize: +e.target.value }))}
                    />
                  </label>
                  <label className="sp-paint3d__prop">
                    <div className="sp-paint3d__prop-row">
                      <span>Opacity</span>
                      <b>{Math.round(toolState.paintOpacity * 100)}%</b>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={toolState.paintOpacity}
                      onChange={(e) => setToolState((s) => ({ ...s, paintOpacity: +e.target.value }))}
                    />
                  </label>
                  <label className="sp-paint3d__prop">
                    <div className="sp-paint3d__prop-row">
                      <span>Spacing</span>
                      <b>{Math.round(toolState.paintSpacing * 100)}%</b>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={toolState.paintSpacing}
                      onChange={(e) => setToolState((s) => ({ ...s, paintSpacing: +e.target.value }))}
                    />
                  </label>
                </div>

                <div className="sp-paint3d__section sp-paint3d__footer">
                  <button
                    type="button"
                    onClick={() => setToolState((s) => ({ ...s, paintMirrorU: !s.paintMirrorU }))}
                    className={`sp-paint3d__toggle ${toolState.paintMirrorU ? 'is-active' : ''}`}
                  >
                    <FlipHorizontal className="w-3 h-3" />
                    <span>Mirror U</span>
                    <span className="sp-paint3d__toggle-state">{toolState.paintMirrorU ? 'On' : 'Off'}</span>
                  </button>
                  <p className="sp-paint3d__tips">LMB paint · empty LMB orbit · continuous strokes</p>
                </div>
              </div>
            )}
          </div>

          <div className="sp-sep-h is-rail" />

          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={onExtrudeFace}
              className="w-7 h-7 bg-[#262626] text-[#e68619] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
              title="Extrude Face (E)"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
                Extrude Face (E)
              </span>
            </button>

            <button
              onClick={onInsetFace}
              className="w-7 h-7 bg-[#262626] text-[#ed7300] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
              title="Inset Face (I)"
            >
              <Minimize className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
                Inset Face (I)
              </span>
            </button>

            <button
              onClick={onMergeVertices}
              className="w-7 h-7 bg-[#262626] text-[#ed7300] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
              title="Weld / Merge Vertices"
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
                Weld Vertices
              </span>
            </button>

            <button
              onClick={onMirrorSymmetry}
              className="w-7 h-7 bg-[#262626] text-[#2d9d78] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
              title="Mirror Symmetry (X)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
                Mirror Symmetry
              </span>
            </button>

            <button
              onClick={onMagnetSnap}
              className="w-7 h-7 bg-[#262626] text-[#ec5b62] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
              title="Magnet Vertex Snap"
            >
              <Magnet className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
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
                : 'bg-[#262626] text-[#a0a0a0] hover:bg-[#4d4d4d] hover:text-white'
            }`}
            title="Weight paint"
          >
            <Paintbrush className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
              Weight Paint
            </span>
          </button>
          <button
            type="button"
            onClick={onMirrorSymmetry}
            className="w-7 h-7 bg-[#262626] text-[#2d9d78] hover:bg-[#4d4d4d] rounded flex items-center justify-center transition relative group"
            title="Mirror bones / symmetry"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#3a3a3a] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#4d4d4d]">
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
          className="bg-[#3a3a3a] text-[#ed7300] text-[8.5px] font-mono p-0.5 rounded border border-[#4d4d4d] outline-none cursor-pointer text-center w-8"
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

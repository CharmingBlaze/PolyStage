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
  Minus,
  Grid,
  Bone,
  CircleDot,
  GitCommitHorizontal,
  Square,
  CheckSquare,
  SquareDashed,
  PersonStanding,
  Hand,
  GripHorizontal,
  Grid3x3,
  X,
  SlidersHorizontal,
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

const PAINT_TOOLS: Array<{
  id: NonNullable<ToolState['drawTool']>;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = [
  { id: 'pencil', icon: Pencil, label: 'Brush (B)' },
  { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
  { id: 'picker', icon: Pipette, label: 'Picker (I)' },
  { id: 'fill', icon: PaintBucket, label: 'Fill UV region' },
  { id: 'spray', icon: SprayCan, label: 'Spray' },
  { id: 'dither', icon: Grid3x3, label: 'Dither' },
];

const BRUSH_SIZE_PRESETS = [1, 2, 3, 4, 6, 8];

function defaultPaintPanelPos(collapsed: boolean) {
  if (typeof window === 'undefined') return { x: 52, y: 72 };
  // Dock to lower-left of the viewport so the mesh stays visible by default.
  return {
    x: 52,
    y: collapsed
      ? Math.max(72, window.innerHeight - 52)
      : Math.max(72, window.innerHeight - 320),
  };
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
  const [paintPanelCollapsed, setPaintPanelCollapsed] = useState(true);
  const [paintPanelPos, setPaintPanelPos] = useState(() => defaultPaintPanelPos(true));
  const [draggingPaintPanel, setDraggingPaintPanel] = useState(false);
  const paintDragOffsetRef = useRef({ x: 0, y: 0 });
  const paintPanelUserMovedRef = useRef(false);

  // Re-dock when entering/leaving paint mode unless the user dragged it.
  useEffect(() => {
    if (!toolState.isPainting3D) {
      paintPanelUserMovedRef.current = false;
      setPaintPanelCollapsed(true);
      return;
    }
    if (!paintPanelUserMovedRef.current) {
      setPaintPanelPos(defaultPaintPanelPos(paintPanelCollapsed));
    }
  }, [toolState.isPainting3D, paintWorkspace]);

  useEffect(() => {
    if (!draggingPaintPanel) return;
    const onMove = (e: MouseEvent) => {
      paintPanelUserMovedRef.current = true;
      setPaintPanelPos({
        x: Math.max(8, Math.min(window.innerWidth - 240, e.clientX - paintDragOffsetRef.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 40, e.clientY - paintDragOffsetRef.current.y)),
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
  const activeDrawTool = toolState.drawTool || 'pencil';
  const brushSize = toolState.brushSize || 1;

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

  const setPaintTool = (id: NonNullable<ToolState['drawTool']>) => {
    setToolState((s) => ({
      ...s,
      drawTool: id,
      isPainting3D: true,
      viewMode: 'textured',
      editMode: 'object',
    }));
  };

  const togglePaintPanel = () => {
    setPaintPanelCollapsed((prev) => {
      const next = !prev;
      if (!paintPanelUserMovedRef.current) {
        setPaintPanelPos(defaultPaintPanelPos(next));
      }
      return next;
    });
  };

  const paintPropsPanel =
    toolState.isPainting3D && !rigWorkspace ? (
      <div
        className={`sp-paint3d fixed z-[100] ${paintPanelCollapsed ? 'sp-paint3d--collapsed w-[210px]' : 'w-[220px]'}`}
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
            <div className="sp-paint3d__title">
              {paintPanelCollapsed
                ? `${activeDrawTool} · ${brushSize}px · ${Math.round((toolState.paintOpacity ?? 1) * 100)}%`
                : 'Brush'}
            </div>
            {!paintPanelCollapsed && (
              <div className="sp-paint3d__sub">Size · Opacity · Spacing · Mirror</div>
            )}
          </div>
          <button
            type="button"
            className="sp-paint3d__close"
            title={paintPanelCollapsed ? 'Expand brush settings' : 'Collapse brush settings'}
            onClick={togglePaintPanel}
          >
            {paintPanelCollapsed ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          {!paintWorkspace && (
            <button
              type="button"
              className="sp-paint3d__close"
              title="Exit 3D paint (B)"
              onClick={() => setToolState((s) => ({ ...s, isPainting3D: false }))}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {!paintPanelCollapsed && (
          <>
            <div className="sp-paint3d__section sp-paint3d__props">
              <label className="sp-paint3d__prop">
                <div className="sp-paint3d__prop-row">
                  <span>Size</span>
                  <b>{brushSize} px</b>
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  value={brushSize}
                  onChange={(e) => setToolState((s) => ({ ...s, brushSize: +e.target.value }))}
                />
              </label>
              <label className="sp-paint3d__prop">
                <div className="sp-paint3d__prop-row">
                  <span>Opacity</span>
                  <b>{Math.round((toolState.paintOpacity ?? 1) * 100)}%</b>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={toolState.paintOpacity ?? 1}
                  onChange={(e) => setToolState((s) => ({ ...s, paintOpacity: +e.target.value }))}
                />
              </label>
              <label className="sp-paint3d__prop">
                <div className="sp-paint3d__prop-row">
                  <span>Spacing</span>
                  <b>{Math.round((toolState.paintSpacing ?? 0.25) * 100)}%</b>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={toolState.paintSpacing ?? 0.25}
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
              <p className="sp-paint3d__tips">LMB drag paint · Alt+LMB orbit · RMB pan · [ ] size</p>
            </div>
          </>
        )}
      </div>
    ) : null;

  return (
    <aside className="w-10 sp-tool-shelf flex flex-col items-center py-1.5 gap-1 z-[90] font-sans select-none text-[#c6cad1]">
      <div className="w-7 h-5 bg-[#191b1e] border border-[#101114] flex items-center justify-center text-[#ed7300] font-bold text-[8px] uppercase tracking-wide">
        {rigWorkspace ? 'Rig' : paintWorkspace ? 'Paint' : 'Tools'}
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
                <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                  {mode.label} — {mode.title}
                </span>
              </button>
            );
          })}
        </div>
      ) : paintWorkspace ? (
        /* Paint workspace: brush tools live on the rail — no modeling chrome. */
        <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
          {PAINT_TOOLS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPaintTool(id)}
              className={`sp-tool-btn relative group ${
                toolState.isPainting3D && activeDrawTool === id ? 'is-active' : ''
              }`}
              title={label}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                {label}
              </span>
            </button>
          ))}
          <input
            type="color"
            value={toolState.activeColor || '#ff9a3c'}
            onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
            className="w-6 h-6 p-0 border border-[#3b3f46] rounded-sm bg-transparent cursor-pointer"
            title="Brush color"
          />
          <div className="sp-paint-rail__sizes" title="Brush size">
            {BRUSH_SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={`sp-paint-rail__size ${brushSize === size ? 'is-active' : ''}`}
                onClick={() => setToolState((s) => ({ ...s, brushSize: size }))}
              >
                {size}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`sp-tool-btn relative group ${!paintPanelCollapsed ? 'is-active' : ''}`}
            title={paintPanelCollapsed ? 'Brush settings' : 'Hide brush settings'}
            onClick={togglePaintPanel}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
              Brush settings
            </span>
          </button>
          {paintPropsPanel}
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
                  isPainting3D: false,
                }))}
                className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
                title={`${mode.label} Mode (${mode.shortcut})`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                  {mode.label} Mode ({mode.shortcut})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!paintWorkspace && !rigWorkspace && (
        <>
          <div className="sp-sep-h is-rail" />

          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={onSelectAll}
              className="sp-tool-btn relative group"
              title="Select All (A)"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                Select All (A)
              </span>
            </button>
            <button
              onClick={onDeselectAll}
              className="sp-tool-btn relative group"
              title="Deselect All (Alt+A)"
            >
              <SquareDashed className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
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
                    isPainting3D: false,
                  }))}
                  className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
                  title={`${mode.label} Transform (${mode.shortcut})`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                    {mode.label} ({mode.shortcut})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="sp-sep-h is-rail" />

          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={() =>
                setToolState((s) => {
                  const next = !s.isPainting3D;
                  return {
                    ...s,
                    isPainting3D: next,
                    viewMode: next ? 'textured' : s.viewMode,
                    editMode: next ? 'object' : s.editMode,
                    drawTool: next ? (s.drawTool || 'pencil') : s.drawTool,
                  };
                })
              }
              className={`sp-tool-btn relative group ${
                toolState.isPainting3D ? 'is-active' : ''
              }`}
              title="Paint on 3D mesh (B)"
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                Paint on 3D (B)
              </span>
            </button>
            {toolState.isPainting3D && (
              <>
                {PAINT_TOOLS.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPaintTool(id)}
                    className={`sp-tool-btn relative group ${activeDrawTool === id ? 'is-active' : ''}`}
                    title={label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="absolute left-9 bg-[#3b3f46] text-[#c6cad1] text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#101114]">
                      {label}
                    </span>
                  </button>
                ))}
                <input
                  type="color"
                  value={toolState.activeColor || '#ff9a3c'}
                  onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
                  className="w-6 h-6 p-0 border border-[#3b3f46] rounded-sm bg-transparent cursor-pointer"
                  title="Brush color"
                />
                <button
                  type="button"
                  className={`sp-tool-btn relative group ${!paintPanelCollapsed ? 'is-active' : ''}`}
                  title={paintPanelCollapsed ? 'Brush settings' : 'Hide brush settings'}
                  onClick={togglePaintPanel}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
                {paintPropsPanel}
              </>
            )}
          </div>

          <div className="sp-sep-h is-rail" />

          <div className="flex flex-col gap-0.5 w-full px-0.5 items-center">
            <button
              onClick={onExtrudeFace}
              className="w-7 h-7 bg-[#191b1e] text-[#e68619] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
              title="Extrude Face (E)"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
                Extrude Face (E)
              </span>
            </button>

            <button
              onClick={onInsetFace}
              className="w-7 h-7 bg-[#191b1e] text-[#ed7300] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
              title="Inset Face (I)"
            >
              <Minimize className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
                Inset Face (I)
              </span>
            </button>

            <button
              onClick={onMergeVertices}
              className="w-7 h-7 bg-[#191b1e] text-[#ed7300] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
              title="Weld / Merge Vertices"
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
                Weld Vertices
              </span>
            </button>

            <button
              onClick={onMirrorSymmetry}
              className="w-7 h-7 bg-[#191b1e] text-[#2d9d78] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
              title="Mirror Symmetry (X)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
                Mirror Symmetry
              </span>
            </button>

            <button
              onClick={onMagnetSnap}
              className="w-7 h-7 bg-[#191b1e] text-[#ec5b62] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
              title="Magnet Vertex Snap"
            >
              <Magnet className="w-3.5 h-3.5" />
              <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
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
                : 'bg-[#191b1e] text-[#a0a0a0] hover:bg-[#3b3f46] hover:text-white'
            }`}
            title="Weight paint"
          >
            <Paintbrush className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
              Weight Paint
            </span>
          </button>
          <button
            type="button"
            onClick={onMirrorSymmetry}
            className="w-7 h-7 bg-[#191b1e] text-[#2d9d78] hover:bg-[#3b3f46] rounded flex items-center justify-center transition relative group"
            title="Mirror bones / symmetry"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="absolute left-9 bg-[#2e3136] text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition pointer-events-none z-50 whitespace-nowrap border border-[#3b3f46]">
              Mirror Symmetry
            </span>
          </button>
        </div>
      )}

      <div className="mt-auto flex flex-col items-center gap-0.5">
        {!paintWorkspace && (
          <>
            <span className="text-[7.5px] font-mono text-[#7e838c]">SNAP</span>
            <select
              value={toolState.gridSnap}
              onChange={(e) => setToolState((s) => ({ ...s, gridSnap: parseFloat(e.target.value) }))}
              className="bg-[#2e3136] text-[#ed7300] text-[8.5px] font-mono p-0.5 rounded border border-[#3b3f46] outline-none cursor-pointer text-center w-8"
            >
              {gridSnapValues.map((val) => (
                <option key={val} value={val}>
                  {val === 0 ? 'OFF' : `${val}`}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </aside>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import type { ToolState, EditMode, TransformMode, RigMode } from '../types/cad';
import { BlenderIcon, type BlenderIconName } from './icons/BlenderIcon';

interface ToolbarProps {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onSpawnPrimitive: (type: import('../types/cad').PrimitiveType) => void;
  primitivesOpen?: boolean;
  onTogglePrimitives?: () => void;
  onExtrudeFace: () => void;
  onInsetFace: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onMergeVertices: () => void;
  onMirrorSymmetry: () => void;
  onMagnetSnap: () => void;
  /** Modo-style Pen tool: create geometry vertex by vertex. */
  onTogglePenTool?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  /** When true, keep 3D painting armed (Paint workspace). */
  paintWorkspace?: boolean;
  /** When true, show Easy Rig tools (edit / pose / skin). */
  rigWorkspace?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  isFloating?: boolean;
  onFloatingChange?: (next: boolean) => void;
}

const PAINT_TOOLS: Array<{
  id: NonNullable<ToolState['drawTool']>;
  icon: BlenderIconName;
  label: string;
}> = [
  { id: 'pencil', icon: 'brush', label: 'Brush (B)' },
  { id: 'eraser', icon: 'eraser', label: 'Erase (E)' },
  { id: 'picker', icon: 'picker', label: 'Picker (I)' },
  { id: 'fill', icon: 'fill', label: 'Fill island' },
  { id: 'spray', icon: 'spray', label: 'Spray' },
  { id: 'dither', icon: 'dither', label: 'Dither' },
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
  primitivesOpen = false,
  onTogglePrimitives,
  onExtrudeFace,
  onInsetFace,
  onMergeVertices,
  onMirrorSymmetry,
  onMagnetSnap,
  onTogglePenTool,
  onSelectAll,
  onDeselectAll,
  onDeleteSelected,
  paintWorkspace = false,
  rigWorkspace = false,
  isOpen = true,
  onClose,
  isFloating,
  onFloatingChange,
}) => {
  const [paintPanelCollapsed, setPaintPanelCollapsed] = useState(true);
  const [paintPanelPos, setPaintPanelPos] = useState(() => defaultPaintPanelPos(true));
  const [draggingPaintPanel, setDraggingPaintPanel] = useState(false);
  const paintDragOffsetRef = useRef({ x: 0, y: 0 });
  const paintPanelUserMovedRef = useRef(false);
  const paintRail = !rigWorkspace && (paintWorkspace || toolState.isPainting3D);
  const [internalFloating, setInternalFloating] = useState(false);
  const floating = isFloating ?? internalFloating;
  const setFloating = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(floating) : next;
    if (isFloating === undefined) setInternalFloating(value);
    onFloatingChange?.(value);
  };
  const [minimized, setMinimized] = useState(false);
  const [cols, setCols] = useState<1 | 2 | 3>(2);
  const [shelfPos, setShelfPos] = useState({ x: 16, y: 72 });
  const [draggingShelf, setDraggingShelf] = useState(false);
  const shelfDragOffsetRef = useRef({ x: 0, y: 0 });

  // Re-dock when entering/leaving paint mode unless the user dragged it.
  useEffect(() => {
    if (!paintRail) {
      paintPanelUserMovedRef.current = false;
      setPaintPanelCollapsed(true);
      return;
    }
    if (!paintPanelUserMovedRef.current) {
      setPaintPanelCollapsed(false);
      setPaintPanelPos(defaultPaintPanelPos(false));
    }
  }, [paintRail]);

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

  useEffect(() => {
    if (!draggingShelf) return;
    const onMove = (e: MouseEvent) => {
      setShelfPos({
        x: Math.max(8, Math.min(window.innerWidth - 80, e.clientX - shelfDragOffsetRef.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 40, e.clientY - shelfDragOffsetRef.current.y)),
      });
    };
    const onUp = () => setDraggingShelf(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingShelf]);

  const editModes: { id: EditMode; label: string; icon: BlenderIconName; shortcut: string }[] = [
    { id: 'object', label: 'Object', icon: 'object', shortcut: '1' },
    { id: 'vertex', label: 'Vertex', icon: 'vertex', shortcut: '2' },
    { id: 'edge', label: 'Edge', icon: 'edge', shortcut: '3' },
    { id: 'face', label: 'Face', icon: 'face', shortcut: '4' },
    { id: 'bone', label: 'Bone', icon: 'bone', shortcut: '5' },
  ];

  const rigModes: { id: RigMode; label: string; icon: BlenderIconName; title: string }[] = [
    { id: 'edit', label: 'Edit', icon: 'bone', title: 'Build and parent skeleton' },
    { id: 'pose', label: 'Pose', icon: 'pose', title: 'Pose bones + IK' },
    { id: 'skin', label: 'Skin', icon: 'skin', title: 'Weight paint skinning' },
  ];

  const transformModes: { id: TransformMode; label: string; icon: BlenderIconName; shortcut: string }[] = [
    { id: 'combined', label: 'Transform', icon: 'transform', shortcut: 'T' },
    { id: 'move', label: 'Move', icon: 'move', shortcut: 'G' },
    { id: 'rotate', label: 'Rotate', icon: 'rotate', shortcut: 'R' },
    { id: 'scale', label: 'Scale', icon: 'scale', shortcut: 'S' },
    { id: 'pivot', label: 'Pivot', icon: 'pivot', shortcut: '.' },
  ];

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
    paintRail ? (
      <div
        className={`ts-float ${paintPanelCollapsed ? 'w-[200px]' : 'w-[228px]'}`}
        style={{ left: paintPanelPos.x, top: paintPanelPos.y }}
      >
        <div
          className={`ts-float__bar ${draggingPaintPanel ? 'cursor-grabbing' : ''}`}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setDraggingPaintPanel(true);
            paintDragOffsetRef.current = {
              x: e.clientX - paintPanelPos.x,
              y: e.clientY - paintPanelPos.y,
            };
          }}
        >
          <span className="ts-float__title">
            {paintPanelCollapsed
              ? `${PAINT_TOOLS.find((t) => t.id === activeDrawTool)?.label.split(' (')[0] || 'Brush'} · ${brushSize}px`
              : 'Brush'}
          </span>
          <button
            type="button"
            className="ts-btn ts-btn--ghost w-7 h-7"
            title={paintPanelCollapsed ? 'Expand brush' : 'Collapse brush'}
            aria-label={paintPanelCollapsed ? 'Expand brush' : 'Collapse brush'}
            onClick={togglePaintPanel}
          >
            {paintPanelCollapsed ? <BlenderIcon name="show" size={12} /> : <BlenderIcon name="hide" size={12} />}
          </button>
          {!paintWorkspace && (
            <button
              type="button"
              className="ts-btn ts-btn--ghost w-7 h-7"
              title="Exit brush (B)"
              aria-label="Exit brush"
              onClick={() => setToolState((s) => ({ ...s, isPainting3D: false }))}
            >
              <BlenderIcon name="deselect" size={12} />
            </button>
          )}
        </div>

        {!paintPanelCollapsed && (
          <div className="p-2.5 flex flex-col gap-2.5 bg-[#21242c]">
            <label className="w-full flex flex-col gap-1">
              <span className="flex justify-between text-[11px] text-[#bcc4d0]">
                <span>Brush Size</span>
                <b className="font-mono text-[11px] text-[#00b4c4]">{brushSize}px</b>
              </span>
              <input
                type="range"
                min="1"
                max="16"
                value={brushSize}
                onChange={(e) => setToolState((s) => ({ ...s, brushSize: +e.target.value }))}
                aria-label="Brush size"
                className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
              />
            </label>
            <label className="w-full flex flex-col gap-1">
              <span className="flex justify-between text-[11px] text-[#bcc4d0]">
                <span>Opacity</span>
                <b className="font-mono text-[11px] text-[#00b4c4]">{Math.round((toolState.paintOpacity ?? 1) * 100)}%</b>
              </span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={toolState.paintOpacity ?? 1}
                onChange={(e) => setToolState((s) => ({ ...s, paintOpacity: +e.target.value }))}
                aria-label="Brush opacity"
                className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
              />
            </label>
            <label className="w-full flex flex-col gap-1">
              <span className="flex justify-between text-[11px] text-[#bcc4d0]">
                <span>Spacing</span>
                <b className="font-mono text-[11px] text-[#00b4c4]">{Math.round((toolState.paintSpacing ?? 0.25) * 100)}%</b>
              </span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={toolState.paintSpacing ?? 0.25}
                onChange={(e) => setToolState((s) => ({ ...s, paintSpacing: +e.target.value }))}
                aria-label="Brush spacing"
                className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
              />
            </label>
            <button
              type="button"
              onClick={() => setToolState((s) => ({ ...s, paintMirrorU: !s.paintMirrorU }))}
              className={`h-7 px-2 rounded-[6px] border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                toolState.paintMirrorU
                  ? 'bg-[#00b4c4]/15 border-[#00b4c4] text-[#00b4c4]'
                  : 'bg-[#282c35] border-[#3a3f4a] text-[#bcc4d0] hover:text-[#e2e6ec]'
              }`}
              aria-pressed={!!toolState.paintMirrorU}
            >
              <BlenderIcon name="mirror" size={14} />
              <span>Mirror U Symmetry</span>
            </button>
            <p className="m-0 text-[10.5px] text-[#6e7584] leading-snug font-mono">LMB paints · Alt orbits · [ ] size</p>
          </div>
        )}
      </div>
    ) : null;

  if (!isOpen) return paintPropsPanel;

  const shelfTitle = rigWorkspace ? 'Rig' : paintWorkspace ? 'Paint' : paintRail ? 'Brush' : 'Tools';
  const groupClass = floating
    ? 'contents'
    : 'flex flex-col gap-0.5 w-full px-0.5 items-center';
  const sepClass = floating ? 'col-span-full sp-sep-h is-rail' : 'sp-sep-h is-rail';

  return (
    <>
    <aside
      className={
        floating
          ? 'ts-float font-sans select-none text-[#bcc4d0]'
          : 'w-11 sp-tool-shelf flex flex-col items-center py-1.5 gap-1 z-[20] font-sans select-none text-[var(--ts-text)]'
      }
      style={
        floating
          ? { left: shelfPos.x, top: shelfPos.y, width: minimized ? 168 : 14 + cols * 32 }
          : undefined
      }
    >
      {floating ? (
        <div
          className={`ts-float__bar ${draggingShelf ? 'cursor-grabbing' : ''}`}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setDraggingShelf(true);
            shelfDragOffsetRef.current = {
              x: e.clientX - shelfPos.x,
              y: e.clientY - shelfPos.y,
            };
          }}
        >
          <span className="ts-float__title">{shelfTitle}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="ts-btn ts-btn--ghost w-7 h-7"
              title="Columns"
              aria-label="Cycle tool columns"
              onClick={() => setCols((c) => (c === 1 ? 2 : c === 2 ? 3 : 1))}
            >
              {cols}
            </button>
            <button
              type="button"
              className="ts-btn ts-btn--ghost w-7 h-7"
              title="Dock left"
              aria-label="Dock toolbar left"
              onClick={() => {
                setFloating(false);
                setMinimized(false);
              }}
            >
              <BlenderIcon name="outliner" size={12} />
            </button>
            <button
              type="button"
              className="ts-btn ts-btn--ghost w-7 h-7"
              title={minimized ? 'Expand' : 'Minimize'}
              aria-label={minimized ? 'Expand toolbar' : 'Minimize toolbar'}
              onClick={() => setMinimized((m) => !m)}
            >
              <BlenderIcon name={minimized ? 'show' : 'hide'} size={12} />
            </button>
            <button
              type="button"
              className="ts-btn ts-btn--ghost w-7 h-7"
              title="Close toolbar"
              aria-label="Close toolbar"
              onClick={onClose}
            >
              <BlenderIcon name="deselect" size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {(!floating || !minimized) && (
      <div
        className={
          floating
            ? 'grid gap-0.5 px-1.5 pb-1.5 justify-items-center'
            : 'flex flex-col items-center gap-1 w-full flex-1'
        }
        style={floating ? { gridTemplateColumns: `repeat(${cols}, 28px)` } : undefined}
      >

      {!paintRail && !rigWorkspace && onTogglePrimitives && (
        <>
          <button
            type="button"
            onClick={onTogglePrimitives}
            className={`sp-tool-btn relative group ${primitivesOpen ? 'is-active' : ''}`}
            title="Add primitive"
            aria-label="Add primitive"
            aria-pressed={primitivesOpen}
          >
            <BlenderIcon name="add" size={14} />
            <span className="ts-tip">Add Primitive</span>
          </button>
          <div className={sepClass} />
        </>
      )}

      {rigWorkspace ? (
        <div className={groupClass}>
          {rigModes.map((mode) => {
            const isActive = activeRigMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setRigMode(mode.id)}
                className={`sp-tool-btn relative group ${isActive ? 'is-active' : ''}`}
                title={mode.title}
                aria-label={mode.label}
              >
                <BlenderIcon name={mode.icon} size={16} />
                <span className="ts-tip">{mode.label} - {mode.title}</span>
              </button>
            );
          })}
        </div>
      ) : paintRail ? (
        /* Paint workspace: brush tools live on the rail — no modeling chrome. */
        <div className={groupClass}>
          {PAINT_TOOLS.map(({ id, icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPaintTool(id)}
              className={`sp-tool-btn relative group ${
                toolState.isPainting3D && activeDrawTool === id ? 'is-active' : ''
              }`}
              title={label}
              aria-label={label}
            >
              <BlenderIcon name={icon} size={14} />
              <span className="ts-tip">{label}</span>
            </button>
          ))}
          <input
            type="color"
            value={toolState.activeColor || '#00d4e2'}
            onChange={(e) => setToolState((s) => ({ ...s, activeColor: e.target.value, drawTool: 'pencil' }))}
            className="w-6 h-6 p-0 border border-[#3a3f4a] rounded-[6px] bg-transparent cursor-pointer"
            title="Brush color"
            aria-label="Brush color"
          />
          <div className="sp-paint-rail__sizes" title="Brush size">
            {BRUSH_SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={`sp-paint-rail__size ${brushSize === size ? 'is-active' : ''}`}
                onClick={() => setToolState((s) => ({ ...s, brushSize: size }))}
                aria-label={`Brush size ${size}px`}
              >
                {size}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`sp-tool-btn relative group ${!paintPanelCollapsed ? 'is-active' : ''}`}
            title={paintPanelCollapsed ? 'Brush settings' : 'Hide brush settings'}
            aria-label={paintPanelCollapsed ? 'Brush settings' : 'Hide brush settings'}
            onClick={togglePaintPanel}
          >
            <BlenderIcon name="settings" size={14} />
            <span className="ts-tip">Brush settings</span>
          </button>
          {paintPropsPanel}
        </div>
      ) : (
        <div className={groupClass}>
          {editModes.map((mode) => {
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
                aria-label={`${mode.label} mode`}
              >
                <BlenderIcon name={mode.icon} size={16} />
                <span className="ts-tip">{mode.label} Mode ({mode.shortcut})</span>
              </button>
            );
          })}
        </div>
      )}

      {!paintRail && !rigWorkspace && (
        <>
          <div className={sepClass} />

          <div className={groupClass}>
            <button
              onClick={onSelectAll}
              className="sp-tool-btn relative group"
              title="Select All (A)"
              aria-label="Select All (A)"
            >
              <BlenderIcon name="select" size={14} />
              <span className="ts-tip">Select All (A)</span>
            </button>
            <button
              onClick={onDeselectAll}
              className="sp-tool-btn relative group"
              title="Deselect All (Alt+A)"
              aria-label="Deselect All (Alt+A)"
            >
              <BlenderIcon name="deselect" size={14} />
              <span className="ts-tip">Deselect All (Alt+A)</span>
            </button>
          </div>

          <div className={sepClass} />

          <div className={groupClass}>
            {transformModes.map((mode) => {
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
                  title={mode.id === 'pivot' ? `Move origin — mesh stays (${mode.shortcut})` : `${mode.label} Gizmo (${mode.shortcut})`}
                  aria-label={mode.id === 'pivot' ? 'Move origin' : `${mode.label} gizmo`}
                  aria-pressed={isActive}
                >
                  <BlenderIcon name={mode.icon} size={16} />
                  <span className="ts-tip">{mode.id === 'pivot' ? `Move origin (${mode.shortcut})` : `${mode.label} Gizmo (${mode.shortcut})`}</span>
                </button>
              );
            })}
          </div>

          <div className={sepClass} />

          <div className={groupClass} aria-label="Modeling">
            <button
              onClick={onExtrudeFace}
              className="sp-tool-btn relative group"
              title="Extrude (E)"
              aria-label="Extrude (E)"
            >
              <BlenderIcon name="extrude" size={16} />
              <span className="ts-tip">Extrude (E)</span>
            </button>
            <button
              onClick={onInsetFace}
              className="sp-tool-btn relative group"
              title="Inset Face (I)"
              aria-label="Inset Face (I)"
            >
              <BlenderIcon name="inset" size={16} />
              <span className="ts-tip">Inset Face (I)</span>
            </button>
            <button
              onClick={onMergeVertices}
              className="sp-tool-btn relative group"
              title="Weld / Merge Vertices"
              aria-label="Weld / Merge Vertices"
            >
              <BlenderIcon name="weld" size={14} />
              <span className="ts-tip">Weld Vertices</span>
            </button>
            <button
              onClick={onDeleteSelected}
              className="sp-tool-btn relative group"
              title="Delete selected (X)"
              aria-label="Delete selected"
            >
              <BlenderIcon name="trash" size={14} />
              <span className="ts-tip">Delete selected (X)</span>
            </button>
          </div>

          <div className={sepClass} />

          <div className={groupClass} aria-label="Snapping">
            <button
              onClick={onMagnetSnap}
              className="sp-tool-btn relative group"
              title="Magnet Vertex Snap"
              aria-label="Magnet Vertex Snap"
            >
              <BlenderIcon name="magnet" size={16} />
              <span className="ts-tip">Magnet Vertex Snap</span>
            </button>
            <button
              onClick={onMirrorSymmetry}
              className="sp-tool-btn relative group"
              title="Mirror Symmetry (X)"
              aria-label="Mirror Symmetry (X)"
            >
              <BlenderIcon name="mirror" size={14} />
              <span className="ts-tip">Mirror Symmetry</span>
            </button>
            <button
              onClick={() =>
                setToolState((s) => ({
                  ...s,
                  isCadDrawing: !s.isCadDrawing,
                  placeOnClick: false,
                  cadDrawPrimitive: s.cadDrawPrimitive || s.activePrimitive || 'cube',
                }))
              }
              className={`sp-tool-btn relative group ${toolState.isCadDrawing ? 'is-active' : ''}`}
              title="CAD draw primitive"
              aria-label="CAD draw primitive"
              aria-pressed={!!toolState.isCadDrawing}
            >
              <BlenderIcon name="cad" size={16} />
              <span className="ts-tip">CAD Draw</span>
            </button>
            <button
              type="button"
              onClick={onTogglePenTool}
              disabled={!onTogglePenTool}
              className={`sp-tool-btn relative group ${toolState.isPenTool ? 'is-active' : ''}`}
              title="Pen tool: create geometry vertex by vertex"
              aria-label="Pen tool"
              aria-pressed={!!toolState.isPenTool}
            >
              <BlenderIcon name="pen" size={16} />
              <span className="ts-tip">Pen</span>
            </button>
          </div>
        </>
      )}

      {rigWorkspace && (
        <div className={groupClass}>
          <button
            type="button"
            onClick={() => setRigMode('skin')}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition relative group ${
              activeRigMode === 'skin'
                ? 'bg-[#00b4c4] text-[#0a1114] shadow-md'
                : 'bg-[#16191e] text-[#bcc4d0] hover:bg-[#3a3f4a] hover:text-[#e2e6ec]'
            }`}
            title="Weight paint"
            aria-label="Weight paint"
          >
            <BlenderIcon name="brush" size={14} />
            <span className="ts-tip">Weight Paint</span>
          </button>
          <button
            type="button"
            onClick={onMirrorSymmetry}
            className="w-7 h-7 bg-[#16191e] text-[#00b4c4] hover:bg-[#3a3f4a] rounded-[6px] flex items-center justify-center transition relative group"
            title="Mirror bones / symmetry"
            aria-label="Mirror bones symmetry"
          >
            <BlenderIcon name="mirror" size={14} />
            <span className="ts-tip">Mirror Symmetry</span>
          </button>
        </div>
      )}

      <div className={floating ? 'col-span-full flex flex-col items-center gap-0.5 pt-0.5' : 'mt-auto flex flex-col items-center gap-0.5'}>
        {!floating && (
          <button
            type="button"
            className="sp-tool-btn relative group"
            title="Float toolbar"
            aria-label="Float toolbar"
            onClick={() => {
              setFloating(true);
              setMinimized(false);
              setCols(2);
            }}
          >
            <BlenderIcon name="tools" size={14} />
            <span className="ts-tip">Float toolbar</span>
          </button>
        )}
      </div>
      </div>
      )}
    </aside>
    {paintPropsPanel}
    </>
  );
};

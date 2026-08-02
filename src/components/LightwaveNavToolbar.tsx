import React, { useRef, useState } from 'react';
import {
  Crosshair as TargetIcon,
  Move as MoveIcon,
  RefreshCw,
  ZoomIn as ZoomIcon,
  Maximize2 as MaxIcon,
} from 'lucide-react';
import type { ToolState } from '../types/cad';

export type LightwaveNavButton = 0 | 2; // LMB | RMB

interface LightwaveNavToolbarProps {
  /** Optional — only needed when falling back to modeling quad/single layout toggle. */
  toolState?: Pick<ToolState, 'viewportLayout'> | ToolState;
  setToolState?: React.Dispatch<React.SetStateAction<ToolState>>;
  onFocusCenter?: () => void;
  /** LightWave Move: drag the camera view in screen space without dollying. */
  onDragPan?: (deltaX: number, deltaY: number, button: LightwaveNavButton, shiftKey: boolean) => void;
  /** LightWave Rotate: LMB = heading + pitch; RMB = bank; Ctrl snaps 15° */
  onDragOrbit?: (deltaX: number, deltaY: number, button: LightwaveNavButton, ctrlKey: boolean) => void;
  /** LightWave Zoom: drag left/right (primary). */
  onDragZoom?: (deltaX: number, deltaY: number, shiftKey: boolean) => void;
  /** Per-viewport maximize (LightWave). Falls back to quad/single toggle. */
  onMaximize?: () => void;
  /** Hide 3D orbit/rotate tool (ortho views). */
  showOrbit?: boolean;
  /** Whether this viewport is currently maximized within quad layout. */
  isMaximized?: boolean;
  /** Compact mode for sub-viewports in Quad View. */
  compact?: boolean;
  /** Title for maximize button when custom onMaximize is provided. */
  maximizeTitle?: string;
  /** Blockout uses top-right so its bottom dock never covers navigation. */
  placement?: 'bottom-right' | 'top-right';
}

export const LightwaveNavToolbar: React.FC<LightwaveNavToolbarProps> = ({
  toolState,
  setToolState,
  onFocusCenter,
  onDragPan,
  onDragOrbit,
  onDragZoom,
  onMaximize,
  showOrbit = true,
  isMaximized = false,
  compact = false,
  maximizeTitle,
  placement = 'bottom-right',
}) => {
  const [activeDragTool, setActiveDragTool] = useState<'pan' | 'orbit' | 'zoom' | null>(null);
  const buttonRef = useRef<LightwaveNavButton>(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const modifiersRef = useRef({ shift: false, ctrl: false });

  const toggleQuadView = () => {
    if (onMaximize) {
      onMaximize();
      return;
    }
    setToolState?.((s) => ({
      ...s,
      viewportLayout: s.viewportLayout === 'quad' ? 'single' : 'quad',
    }));
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    tool: 'pan' | 'orbit' | 'zoom'
  ) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveDragTool(tool);
    buttonRef.current = e.button === 2 ? 2 : 0;
    modifiersRef.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    const cursorStyle = tool === 'pan' ? 'move' : tool === 'zoom' ? 'zoom-in' : 'grabbing';
    document.body.style.cursor = cursorStyle;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!activeDragTool || !lastPointerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const deltaX = e.clientX - lastPointerRef.current.x;
    const deltaY = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    modifiersRef.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };

    if (activeDragTool === 'pan' && onDragPan) {
      onDragPan(deltaX, deltaY, buttonRef.current, modifiersRef.current.shift);
    } else if (activeDragTool === 'orbit' && onDragOrbit) {
      onDragOrbit(deltaX, deltaY, buttonRef.current, modifiersRef.current.ctrl);
    } else if (activeDragTool === 'zoom' && onDragZoom) {
      onDragZoom(deltaX, deltaY, modifiersRef.current.shift);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!activeDragTool) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setActiveDragTool(null);
    lastPointerRef.current = null;
    document.body.style.cursor = '';
  };

  const maximizeActive =
    isMaximized || (toolState?.viewportLayout === 'quad' && !onMaximize);
  const placementClass =
    placement === 'top-right'
      ? compact
        ? 'top-1.5 right-1.5'
        : 'top-3 right-3'
      : compact
        ? 'bottom-1.5 right-1.5'
        : 'bottom-3 right-3';

  return (
    <div
      className={`lightwave-nav-toolbar absolute z-30 flex items-center gap-0.5 p-1 rounded-lg bg-[#131417]/85 backdrop-blur-md border border-white/[0.08] shadow-lg shadow-black/30 font-mono select-none transition-all ${placementClass}`}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={onFocusCenter}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } flex items-center justify-center rounded-[5px] hover:bg-[#33363c] transition-colors active:translate-y-px cursor-pointer`}
        title="Fit / Center (A = all · selection if any)"
      >
        <TargetIcon className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[#ff9a3c]`} />
      </button>

      <button
        type="button"
        onPointerDown={(e) => handlePointerDown(e, 'pan')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } flex items-center justify-center rounded-[5px] transition-colors cursor-move ${
          activeDragTool === 'pan' ? 'bg-[#ed7300]/25' : 'hover:bg-[#33363c]'
        }`}
        title={
          showOrbit
            ? 'Move — drag the camera view (Shift = fine)'
            : 'Move — drag to pan (Shift = fine)'
        }
      >
        <MoveIcon className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-amber-400`} />
      </button>

      {showOrbit && (
        <button
          type="button"
          onPointerDown={(e) => handlePointerDown(e, 'orbit')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`${
            compact ? 'w-5 h-5' : 'w-7 h-7'
          } flex items-center justify-center rounded-[5px] transition-colors cursor-grab active:cursor-grabbing ${
            activeDragTool === 'orbit' ? 'bg-[#ed7300]/25' : 'hover:bg-[#33363c]'
          }`}
          title="Rotate — LMB: heading + pitch · RMB: bank · Ctrl: 15° snap"
        >
          <RefreshCw className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-emerald-400`} />
        </button>
      )}

      <button
        type="button"
        onPointerDown={(e) => handlePointerDown(e, 'zoom')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } flex items-center justify-center rounded-[5px] transition-colors cursor-zoom-in ${
          activeDragTool === 'zoom' ? 'bg-[#ed7300]/25' : 'hover:bg-[#33363c]'
        }`}
        title="Zoom — drag left/right (Shift = fine)"
      >
        <ZoomIcon className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-cyan-300`} />
      </button>

      <button
        type="button"
        onClick={toggleQuadView}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } flex items-center justify-center rounded-[5px] transition-colors active:translate-y-px ${
          maximizeActive || toolState?.viewportLayout === 'quad'
            ? 'bg-[#ed7300]/25'
            : 'hover:bg-[#33363c]'
        }`}
        title={
          maximizeTitle
            || (onMaximize
              ? isMaximized
                ? 'Restore editor UI'
                : 'Enlarge viewport (hide UI)'
              : toolState?.viewportLayout === 'quad'
                ? 'Single viewport (Ctrl+Alt+Q)'
                : 'Quad viewports (Ctrl+Alt+Q)')
        }
      >
        <MaxIcon className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[#e68619]`} />
      </button>
    </div>
  );
};

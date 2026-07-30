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
  /** LightWave Move: ortho = screen pan; perspective LMB = X + dolly, RMB = vertical */
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

  return (
    <div
      className={`absolute z-30 flex items-center shadow-2xl rounded font-mono select-none transition-all ${
        showOrbit
          ? compact
            ? 'bottom-1.5 right-1.5 p-0.5 bg-[#1a1a1a]/95 backdrop-blur border border-[#1473e6]/50 shadow-[#1473e6]/10'
            : 'bottom-3 right-3 p-0.5 bg-[#222222] border border-[#1473e6]/60 shadow-2xl'
          : compact
            ? 'bottom-1.5 right-1.5 p-0.5 bg-[#121212]/90 backdrop-blur border border-[#333333]'
            : 'bottom-3 right-3 p-0.5 bg-[#181818] border border-[#383838]'
      }`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={onFocusCenter}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } bg-gradient-to-b from-[#3a3a3a] to-[#252526] border border-[#4a4a4a] hover:border-[#02a0e8] flex items-center justify-center text-slate-200 hover:text-white shadow-inner rounded-sm transition active:translate-y-0.5 cursor-pointer`}
        title="Fit / Center (A = all · selection if any)"
      >
        <TargetIcon className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[#02a0e8]`} />
      </button>

      <button
        type="button"
        onPointerDown={(e) => handlePointerDown(e, 'pan')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`${
          compact ? 'w-5 h-5' : 'w-7 h-7'
        } bg-gradient-to-b from-[#3a3a3a] to-[#252526] border flex items-center justify-center text-slate-200 hover:text-white shadow-inner rounded-sm transition cursor-move ${
          activeDragTool === 'pan' ? 'border-[#02a0e8] bg-[#02a0e8]/20' : 'border-[#4a4a4a] hover:border-[#02a0e8]'
        }`}
        title={
          showOrbit
            ? 'Move — LMB: pan X + dolly · RMB: pan Y (Shift = fine)'
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
          } bg-gradient-to-b from-[#3a3a3a] to-[#252526] border flex items-center justify-center text-slate-200 hover:text-white shadow-inner rounded-sm transition cursor-grab active:cursor-grabbing ${
            activeDragTool === 'orbit' ? 'border-[#02a0e8] bg-[#02a0e8]/20' : 'border-[#4a4a4a] hover:border-[#02a0e8]'
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
        } bg-gradient-to-b from-[#3a3a3a] to-[#252526] border flex items-center justify-center text-slate-200 hover:text-white shadow-inner rounded-sm transition cursor-zoom-in ${
          activeDragTool === 'zoom' ? 'border-[#02a0e8] bg-[#02a0e8]/20' : 'border-[#4a4a4a] hover:border-[#02a0e8]'
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
        } bg-gradient-to-b from-[#3a3a3a] to-[#252526] border hover:border-[#02a0e8] flex items-center justify-center text-slate-200 hover:text-white shadow-inner rounded-sm transition active:translate-y-0.5 ${
          maximizeActive || toolState?.viewportLayout === 'quad'
            ? 'border-[#02a0e8] bg-[#1473e6]/30'
            : 'border-[#4a4a4a]'
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

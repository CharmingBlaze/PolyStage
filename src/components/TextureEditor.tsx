import React, { useRef, useEffect, useState } from 'react';
import {
  Pencil,
  PaintBucket,
  Eraser,
  Pipette,
  Grid,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Slash,
  Square,
} from 'lucide-react';
import type { ToolState } from '../types/cad';
import { floodFill, hexToRgba } from '../utils/pixelPaint';

interface TextureEditorProps {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onTextureUpdated: (canvas: HTMLCanvasElement) => void;
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
}

export const TextureEditor: React.FC<TextureEditorProps> = ({
  toolState,
  setToolState,
  onTextureUpdated,
  textureCanvasRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState<number>(8);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [asepriteTool, setAsepriteTool] = useState<'pencil' | 'eraser' | 'fill' | 'picker' | 'dither' | 'line' | 'rect'>('pencil');
  const [brushSize, setBrushSize] = useState<number>(1);
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);

  const textureWidth = 16;
  const textureHeight = 16;

  // Initialize Aseprite Pixel Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    textureCanvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, textureWidth, textureHeight);

    for (let x = 0; x < textureWidth; x++) {
      for (let y = 0; y < textureHeight; y++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = '#1473e6';
          ctx.fillRect(x, y, 1, 1);
        } else {
          ctx.fillStyle = '#1473e6';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    onTextureUpdated(canvas);
  }, []);

  const getPixelCoords = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * textureWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * textureHeight);
    return {
      x: Math.max(0, Math.min(textureWidth - 1, x)),
      y: Math.max(0, Math.min(textureHeight - 1, y)),
    };
  };

  const drawPixel = (px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const color = toolState.activeColor || '#1473e6';

    if (asepriteTool === 'eraser') {
      ctx.clearRect(px, py, brushSize, brushSize);
    } else if (asepriteTool === 'dither') {
      // 50% Aseprite Dither Checkerboard Pattern
      for (let bx = 0; bx < brushSize; bx++) {
        for (let by = 0; by < brushSize; by++) {
          if ((px + bx + py + by) % 2 === 0) {
            ctx.fillStyle = color;
            ctx.fillRect(px + bx, py + by, 1, 1);
          }
        }
      }
    } else if (asepriteTool === 'picker') {
      const imgData = ctx.getImageData(px, py, 1, 1).data;
      const hex = `#${((1 << 24) + (imgData[0] << 16) + (imgData[1] << 8) + imgData[2]).toString(16).slice(1)}`;
      setToolState((s) => ({ ...s, activeColor: hex }));
      setAsepriteTool('pencil');
    } else if (asepriteTool === 'fill') {
      const image = ctx.getImageData(0, 0, textureWidth, textureHeight);
      floodFill(image, px, py, hexToRgba(color));
      ctx.putImageData(image, 0, 0);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(px, py, brushSize, brushSize);
    }

    onTextureUpdated(canvas);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const coords = getPixelCoords(e);
    if (!coords) return;

    if (asepriteTool === 'line' || asepriteTool === 'rect') {
      setLineStart(coords);
    } else {
      drawPixel(coords.x, coords.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const coords = getPixelCoords(e);
    if (!coords) return;

    if (asepriteTool !== 'line' && asepriteTool !== 'rect') {
      drawPixel(coords.x, coords.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawing && lineStart) {
      const end = getPixelCoords(e);
      if (end) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = toolState.activeColor || '#1473e6';
            if (asepriteTool === 'line') {
              let x0 = lineStart.x, y0 = lineStart.y;
              let x1 = end.x, y1 = end.y;
              let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
              let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
              let err = dx - dy;

              while (true) {
                ctx.fillRect(x0, y0, 1, 1);
                if (x0 === x1 && y0 === y1) break;
                let e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (e2 < dx) { err += dx; y0 += sy; }
              }
            } else if (asepriteTool === 'rect') {
              const x = Math.min(lineStart.x, end.x);
              const y = Math.min(lineStart.y, end.y);
              const w = Math.abs(end.x - lineStart.x) + 1;
              const h = Math.abs(end.y - lineStart.y) + 1;
              ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            }
            onTextureUpdated(canvas);
          }
        }
      }
    }
    setIsDrawing(false);
    setLineStart(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#1c1c1c] text-[#e0e0e0] font-sans text-xs select-none">
      {/* Header */}
      <div className="h-8 bg-[#121212] border-b border-[#323232] px-3 flex items-center justify-between font-mono text-[10px] text-[#1473e6] font-bold">
        <span className="flex items-center gap-1.5 uppercase">
          <Sparkles className="w-3.5 h-3.5 text-[#1473e6]" />
          ASEPRITE PIXEL ART STUDIO
        </span>
        <span className="text-[#888888]">{textureWidth}x{textureHeight} px</span>
      </div>

      {/* Aseprite Toolbar */}
      <div className="p-2 bg-[#262626] border-b border-[#323232] flex items-center justify-between gap-1 font-mono text-[10px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAsepriteTool('pencil')}
            className={`p-1.5 rounded transition ${asepriteTool === 'pencil' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Pencil Brush (B)"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('eraser')}
            className={`p-1.5 rounded transition ${asepriteTool === 'eraser' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Eraser (E)"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('fill')}
            className={`p-1.5 rounded transition ${asepriteTool === 'fill' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Paint Bucket Fill (G)"
          >
            <PaintBucket className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('picker')}
            className={`p-1.5 rounded transition ${asepriteTool === 'picker' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Eyedropper Color Picker (I)"
          >
            <Pipette className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('dither')}
            className={`p-1.5 rounded transition ${asepriteTool === 'dither' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Dither Brush Shader Pattern"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('line')}
            className={`p-1.5 rounded transition ${asepriteTool === 'line' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Straight Line Tool"
          >
            <Slash className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAsepriteTool('rect')}
            className={`p-1.5 rounded transition ${asepriteTool === 'rect' ? 'bg-[#1473e6] text-white shadow-sm' : 'bg-[#1e1e1e] text-[#888888] hover:text-white'}`}
            title="Rectangle Frame Tool"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Brush Size Picker */}
        <div className="flex items-center gap-1 bg-[#121212] px-2 py-0.5 rounded border border-[#383838]">
          <span className="text-[#888888]">SIZE:</span>
          {[1, 2, 4].map((sz) => (
            <button
              key={sz}
              onClick={() => setBrushSize(sz)}
              className={`px-1.5 py-0.5 rounded text-[9px] ${brushSize === sz ? 'bg-[#1473e6] text-white font-bold' : 'text-[#888888]'}`}
            >
              {sz}px
            </button>
          ))}
        </div>
      </div>

      {/* Main Canvas Workspace */}
      <div className="flex-1 bg-[#161616] p-4 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="relative border-2 border-[#383838] shadow-2xl bg-[#121212] p-1 rounded-sm">
          <canvas
            ref={canvasRef}
            width={textureWidth}
            height={textureHeight}
            style={{
              width: `${textureWidth * zoom * 1.5}px`,
              height: `${textureHeight * zoom * 1.5}px`,
              imageRendering: 'pixelated',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="cursor-crosshair"
          />

          {/* Grid Overlay */}
          {showGrid && (
            <div
              className="absolute inset-0 pointer-events-none opacity-20 border border-[#1473e6]"
              style={{
                backgroundImage: 'linear-gradient(to right, #1473e6 1px, transparent 1px), linear-gradient(to bottom, #1473e6 1px, transparent 1px)',
                backgroundSize: `${(100 / textureWidth)}% ${(100 / textureHeight)}%`,
              }}
            />
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="h-8 bg-[#121212] border-t border-[#323232] px-3 flex items-center justify-between text-[10px] font-mono">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`px-2 py-0.5 rounded border transition ${showGrid ? 'bg-[#1473e6] border-[#1473e6] text-white font-bold' : 'bg-[#1e1e1e] border-[#383838] text-[#888888]'}`}
          >
            GRID {showGrid ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(4, z - 2))} className="p-1 cad-button">
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[#1473e6] font-bold px-1">{zoom * 10}%</span>
          <button onClick={() => setZoom((z) => Math.min(24, z + 2))} className="p-1 cad-button">
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

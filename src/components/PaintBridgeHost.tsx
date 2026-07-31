import React, { useEffect, useRef } from 'react';
import type { ToolState } from '../types/cad';
import { floodFill, hexToRgba, rgbaToHex } from '../utils/pixelPaint';
import { notifyTexturePreview } from '../utils/texturePreviewBus';
import { StrokeTexelMask } from '../utils/strokeTexelMask';
import type { Paint3DBridge, PaintTool } from './PixelPaintStudio';

type Props = {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  paintBridgeRef: React.MutableRefObject<Paint3DBridge | null>;
  /** Encode / commit mesh texture after a finished 3D stroke (optional). */
  onStrokeEnd?: (canvas: HTMLCanvasElement) => void;
};

function ensurePaintCanvas(
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  w = 64,
  h = 64,
): HTMLCanvasElement {
  let c = textureCanvasRef.current;
  if (c && c.width > 0 && c.height > 0) return c;
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  textureCanvasRef.current = c;
  return c;
}

/**
 * Minimal 3D-paint bridge: stamps directly onto textureCanvasRef.
 * Used outside the Paint workspace so we do not mount a full PixelPaintStudio.
 */
export const PaintBridgeHost: React.FC<Props> = ({
  toolState,
  setToolState,
  textureCanvasRef,
  paintBridgeRef,
  onStrokeEnd,
}) => {
  const strokeActiveRef = useRef(false);
  const stampedMaskRef = useRef(new StrokeTexelMask(64, 64));
  const fillDoneRef = useRef(false);
  const mirrorRef = useRef(!!toolState.paintMirrorU);
  mirrorRef.current = !!toolState.paintMirrorU;
  const onStrokeEndRef = useRef(onStrokeEnd);
  onStrokeEndRef.current = onStrokeEnd;

  useEffect(() => {
    paintBridgeRef.current = {
      paintUv: (uvU, uvV, color, size, paintTool, opacity) => {
        const canvas = ensurePaintCanvas(textureCanvasRef);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        const w = canvas.width;
        const h = canvas.height;
        const x = Math.max(0, Math.min(w - 1, Math.floor(uvU * w)));
        const y = Math.max(0, Math.min(h - 1, Math.floor((1 - uvV) * h)));

        if (paintTool === 'picker') {
          const sample = ctx.getImageData(x, y, 1, 1).data;
          if (sample[3]) {
            setToolState((state) => ({
              ...state,
              activeColor: rgbaToHex(sample[0], sample[1], sample[2]),
              drawTool: 'pencil',
            }));
          }
          return;
        }

        if (!strokeActiveRef.current) {
          strokeActiveRef.current = true;
          stampedMaskRef.current.reset(w, h);
          fillDoneRef.current = false;
        }

        if (paintTool === 'fill') {
          if (fillDoneRef.current) return;
          fillDoneRef.current = true;
          const image = ctx.getImageData(0, 0, w, h);
          floodFill(image, x, y, hexToRgba(color, Math.round(opacity * 255)));
          ctx.putImageData(image, 0, 0);
          notifyTexturePreview();
          return;
        }

        const stampAt = (cx: number, cy: number) => {
          if (!stampedMaskRef.current.add(cx, cy)) return;
          const half = Math.floor(size / 2);
          ctx.save();
          ctx.globalAlpha = opacity;
          if (paintTool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = paintTool === 'eraser' ? '#000000' : color;
          if (paintTool === 'spray') {
            const radius = Math.max(2, size * 1.8);
            for (let i = 0; i < Math.max(8, size * 5); i++) {
              const angle = Math.random() * Math.PI * 2;
              const distance = Math.sqrt(Math.random()) * radius;
              ctx.fillRect(
                Math.round(cx + Math.cos(angle) * distance),
                Math.round(cy + Math.sin(angle) * distance),
                1,
                1,
              );
            }
          } else {
            for (let by = 0; by < size; by++) {
              for (let bx = 0; bx < size; bx++) {
                const sx = cx - half + bx;
                const sy = cy - half + by;
                if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                if (paintTool !== 'dither' || (sx + sy) % 2 === 0) ctx.fillRect(sx, sy, 1, 1);
              }
            }
          }
          ctx.restore();
        };

        stampAt(x, y);
        if (mirrorRef.current === true) stampAt(w - 1 - x, y);
        notifyTexturePreview();
      },
      endStroke: () => {
        strokeActiveRef.current = false;
        fillDoneRef.current = false;
        stampedMaskRef.current.clear();
        const canvas = textureCanvasRef.current;
        if (canvas) onStrokeEndRef.current?.(canvas);
      },
    };

    return () => {
      paintBridgeRef.current = null;
      stampedMaskRef.current.clear();
    };
  }, [paintBridgeRef, textureCanvasRef, setToolState]);

  return null;
};

export type { PaintTool };

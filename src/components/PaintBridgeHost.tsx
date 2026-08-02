import React, { useLayoutEffect, useRef } from 'react';
import type { ToolState } from '../types/cad';
import { setLiveTextureCanvas } from '../utils/texturePreviewBus';
import {
  bindPaint3DHost,
  paint3dBridge,
  type Paint3DBridge,
  type Paint3DTool,
} from '../utils/paint3dSurface';

type Props = {
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  paintBridgeRef: React.MutableRefObject<Paint3DBridge>;
  /** Encode / commit mesh texture after a finished 3D stroke (optional). */
  onStrokeEnd?: (canvas: HTMLCanvasElement) => void;
  /**
   * Called when a paint canvas is created so the viewport can bind a live
   * CanvasTexture (ref mutation alone does not re-render App).
   */
  onBindLiveCanvas?: (canvas: HTMLCanvasElement) => void;
};

function ensurePaintCanvas(
  textureCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  onCreated?: (canvas: HTMLCanvasElement) => void,
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
  onCreated?.(c);
  return c;
}

/**
 * Binds the module-level 3D paint surface when PixelPaintStudio is not mounted.
 * Does not own stroke state — see paint3dSurface.ts.
 */
export const PaintBridgeHost: React.FC<Props> = ({
  toolState,
  setToolState,
  textureCanvasRef,
  paintBridgeRef,
  onStrokeEnd,
  onBindLiveCanvas,
}) => {
  const mirrorRef = useRef(!!toolState.paintMirrorU);
  mirrorRef.current = !!toolState.paintMirrorU;
  const onStrokeEndRef = useRef(onStrokeEnd);
  onStrokeEndRef.current = onStrokeEnd;
  const onBindLiveCanvasRef = useRef(onBindLiveCanvas);
  onBindLiveCanvasRef.current = onBindLiveCanvas;
  const setToolStateRef = useRef(setToolState);
  setToolStateRef.current = setToolState;
  const textureCanvasRefStable = textureCanvasRef;

  useLayoutEffect(() => {
    paintBridgeRef.current = paint3dBridge;
    // Ensure + bind BEFORE the first stamp so the viewport shows live pixels.
    const canvas = ensurePaintCanvas(textureCanvasRefStable, (c) => {
      onBindLiveCanvasRef.current?.(c);
    });
    // Existing canvas still needs a revision bump if the viewport never saw it.
    onBindLiveCanvasRef.current?.(canvas);

    return bindPaint3DHost({
      getTargetCanvas: () =>
        ensurePaintCanvas(textureCanvasRefStable, (c) => {
          onBindLiveCanvasRef.current?.(c);
        }),
      refreshPreview: () => {
        // Same canvas we stamp — publish identity; paint3dSurface sync-notifies.
        const c = textureCanvasRefStable.current;
        if (c) setLiveTextureCanvas(c);
      },
      onStrokeEnd: () => {
        const c = textureCanvasRefStable.current;
        if (c) onStrokeEndRef.current?.(c);
      },
      getMirrorU: () => mirrorRef.current === true,
      onPickColor: (hex) => {
        setToolStateRef.current((state) => ({
          ...state,
          activeColor: hex,
          drawTool: 'pencil',
        }));
      },
    });
  }, [paintBridgeRef, textureCanvasRefStable]);

  return null;
};

export type { Paint3DTool as PaintTool };
export type { Paint3DBridge };

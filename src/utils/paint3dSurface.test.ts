import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPaint3DSurfaceForTests,
  bindPaint3DHost,
  getPaint3DLockedCanvas,
  isPaint3DStrokeActive,
  paint3dBridge,
  paint3dStrokeMaskCount,
} from './paint3dSurface';

/** Minimal canvas stub — Node vitest has no DOM canvas. */
function makeCanvas(w = 32, h = 32): HTMLCanvasElement {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  let fillStyle = '#ffffff';
  let globalAlpha = 1;
  let globalCompositeOperation = 'source-over';

  const parseColor = (style: string) => {
    if (style.startsWith('#') && style.length >= 7) {
      return {
        r: parseInt(style.slice(1, 3), 16),
        g: parseInt(style.slice(3, 5), 16),
        b: parseInt(style.slice(5, 7), 16),
      };
    }
    return { r: 255, g: 0, b: 0 };
  };

  const ctx = {
    imageSmoothingEnabled: false,
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    get globalCompositeOperation() {
      return globalCompositeOperation;
    },
    set globalCompositeOperation(v: string) {
      globalCompositeOperation = v;
    },
    save() {},
    restore() {
      globalAlpha = 1;
      globalCompositeOperation = 'source-over';
    },
    fillRect(x: number, y: number, fw: number, fh: number) {
      const { r, g, b } = parseColor(fillStyle);
      const erase = globalCompositeOperation === 'destination-out';
      for (let py = y; py < y + fh; py++) {
        for (let px = x; px < x + fw; px++) {
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const i = (py * w + px) * 4;
          if (erase) {
            data[i + 3] = 0;
          } else {
            const a = globalAlpha;
            data[i] = Math.round(data[i] * (1 - a) + r * a);
            data[i + 1] = Math.round(data[i + 1] * (1 - a) + g * a);
            data[i + 2] = Math.round(data[i + 2] * (1 - a) + b * a);
            data[i + 3] = 255;
          }
        }
      }
    },
    clearRect(x: number, y: number, cw: number, ch: number) {
      for (let py = y; py < y + ch; py++) {
        for (let px = x; px < x + cw; px++) {
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const i = (py * w + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
        }
      }
    },
    getImageData(x: number, y: number, iw: number, ih: number) {
      const out = new Uint8ClampedArray(iw * ih * 4);
      for (let row = 0; row < ih; row++) {
        for (let col = 0; col < iw; col++) {
          const sx = x + col;
          const sy = y + row;
          const si = (sy * w + sx) * 4;
          const di = (row * iw + col) * 4;
          out[di] = data[si];
          out[di + 1] = data[si + 1];
          out[di + 2] = data[si + 2];
          out[di + 3] = data[si + 3];
        }
      }
      return { data: out, width: iw, height: ih };
    },
    putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
      for (let row = 0; row < image.height; row++) {
        for (let col = 0; col < image.width; col++) {
          const dx = x + col;
          const dy = y + row;
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
          const si = (row * image.width + col) * 4;
          const di = (dy * w + dx) * 4;
          data[di] = image.data[si];
          data[di + 1] = image.data[si + 1];
          data[di + 2] = image.data[si + 2];
          data[di + 3] = image.data[si + 3];
        }
      }
    },
  };

  return {
    width: w,
    height: h,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

describe('paint3dSurface singleton', () => {
  afterEach(() => {
    paint3dBridge.endStroke();
    __resetPaint3DSurfaceForTests();
  });

  it('keeps stamping after host rebind that simulates pushHistory/layers churn', () => {
    const layerA = makeCanvas();
    const onBegin = vi.fn();
    const onEnd = vi.fn();
    let layersEpoch = 0;

    const unbind1 = bindPaint3DHost({
      getTargetCanvas: () => layerA,
      onStrokeBegin: onBegin,
      onStrokeEnd: onEnd,
      getMirrorU: () => false,
      refreshPreview: () => {
        layersEpoch += 1;
      },
    });

    paint3dBridge.paintUv(0.1, 0.1, '#ff0000', 2, 'pencil', 1, 'face1');
    expect(isPaint3DStrokeActive()).toBe(true);
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(getPaint3DLockedCanvas()).toBe(layerA);
    const afterBegin = paint3dStrokeMaskCount();
    expect(afterBegin).toBeGreaterThan(0);

    // Simulate PixelPaintStudio effect teardown + rebind mid-stroke (history/layers).
    unbind1();
    expect(isPaint3DStrokeActive()).toBe(true);
    expect(getPaint3DLockedCanvas()).toBe(layerA);

    const unbind2 = bindPaint3DHost({
      getTargetCanvas: () => layerA,
      onStrokeBegin: onBegin,
      onStrokeEnd: onEnd,
      getMirrorU: () => false,
      refreshPreview: () => {
        layersEpoch += 1;
      },
    });

    paint3dBridge.paintUv(0.4, 0.1, '#ff0000', 2, 'pencil', 1, 'face1');
    paint3dBridge.paintUv(0.7, 0.1, '#ff0000', 2, 'pencil', 1, 'face1');
    expect(paint3dStrokeMaskCount()).toBeGreaterThan(afterBegin);
    expect(layersEpoch).toBeGreaterThan(0);

    const ctx = layerA.getContext('2d')!;
    const mid = ctx.getImageData(Math.floor(0.4 * 32), Math.floor(0.1 * 32), 1, 1).data;
    expect(mid[0]).toBeGreaterThan(200);

    paint3dBridge.endStroke();
    expect(isPaint3DStrokeActive()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
    unbind2();
  });

  it('defers host detach until stroke ends', () => {
    const canvas = makeCanvas();
    const unbind = bindPaint3DHost({
      getTargetCanvas: () => canvas,
    });

    paint3dBridge.paintUv(0.2, 0.2, '#00ff00', 1, 'pencil', 1);
    unbind();
    paint3dBridge.paintUv(0.5, 0.5, '#00ff00', 1, 'pencil', 1);
    expect(paint3dStrokeMaskCount()).toBeGreaterThan(1);

    paint3dBridge.endStroke();
    expect(isPaint3DStrokeActive()).toBe(false);
  });

  it('calls refreshPreview during an active stroke so hosts can sync 3D', () => {
    const canvas = makeCanvas();
    const refreshPreview = vi.fn();
    bindPaint3DHost({
      getTargetCanvas: () => canvas,
      refreshPreview,
    });

    paint3dBridge.paintUv(0.25, 0.25, '#ff0000', 1, 'pencil', 1);
    paint3dBridge.paintUv(0.6, 0.6, '#ff0000', 1, 'pencil', 1);
    expect(refreshPreview).toHaveBeenCalled();
    expect(isPaint3DStrokeActive()).toBe(true);
  });
});

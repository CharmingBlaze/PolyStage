/**
 * Photo Editing Filters, Color Adjustments, Pixel-Perfect Algorithms,
 * Dithered Gradients, and Layer Blend Modes for Pixel Paint Studio.
 */

export type LayerBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'soft-light';

export interface ImageAdjustmentSettings {
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  hue: number; // -180 to 180
  saturation: number; // -100 to 100
  posterizeLevels: number; // 0 = off, 2 to 32
  threshold: number; // 0 = off, 1 to 254
  invert: boolean;
  sepia: boolean;
  grayscale: boolean;
  edgeDetection: boolean;
  edgeThreshold: number; // 1 to 255
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustmentSettings = {
  brightness: 0,
  contrast: 0,
  hue: 0,
  saturation: 0,
  posterizeLevels: 0,
  threshold: 0,
  invert: false,
  sepia: false,
  grayscale: false,
  edgeDetection: false,
  edgeThreshold: 40,
};

function clamp(v: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, v));
}

// Convert RGB to HSL
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

// Convert HSL to RGB
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (h % 360) / 360;
  if (h < 0) h += 1;
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Apply full set of photo adjustments to ImageData. */
export function applyPhotoAdjustments(
  srcData: ImageData,
  settings: ImageAdjustmentSettings
): ImageData {
  const { width, height } = srcData;
  const out = new ImageData(new Uint8ClampedArray(srcData.data), width, height);
  const data = out.data;
  const len = data.length;

  const bOffset = settings.brightness * 2.55;
  const cFactor =
    settings.contrast === 0
      ? 1
      : Math.pow((255 + settings.contrast * 2.55) / (255 - settings.contrast * 2.55), 2);

  for (let i = 0; i < len; i += 4) {
    if (data[i + 3] === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Brightness & Contrast
    if (settings.brightness !== 0) {
      r += bOffset;
      g += bOffset;
      b += bOffset;
    }
    if (settings.contrast !== 0) {
      r = (r - 128) * cFactor + 128;
      g = (g - 128) * cFactor + 128;
      b = (b - 128) * cFactor + 128;
    }

    // Hue & Saturation
    if (settings.hue !== 0 || settings.saturation !== 0) {
      let [h, s, l] = rgbToHsl(clamp(r), clamp(g), clamp(b));
      h = (h + settings.hue + 360) % 360;
      s = clamp(s + settings.saturation / 100, 0, 1);
      [r, g, b] = hslToRgb(h, s, l);
    }

    // Invert
    if (settings.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    // Grayscale
    if (settings.grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }

    // Sepia
    if (settings.sepia) {
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;
      r = sr;
      g = sg;
      b = sb;
    }

    // Posterize (Color Quantization)
    if (settings.posterizeLevels >= 2) {
      const step = 255 / (settings.posterizeLevels - 1);
      r = Math.round(r / step) * step;
      g = Math.round(g / step) * step;
      b = Math.round(b / step) * step;
    }

    // Threshold (Binary Black/White)
    if (settings.threshold > 0) {
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const val = luma >= settings.threshold ? 255 : 0;
      r = g = b = val;
    }

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }

  // Edge Detection (Sobel)
  if (settings.edgeDetection) {
    const edgeData = new Uint8ClampedArray(data);
    const thresh = settings.edgeThreshold;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;

        // Sobel kernels
        const gx =
          -1 * edgeData[((y - 1) * width + (x - 1)) * 4] +
          1 * edgeData[((y - 1) * width + (x + 1)) * 4] +
          -2 * edgeData[(y * width + (x - 1)) * 4] +
          2 * edgeData[(y * width + (x + 1)) * 4] +
          -1 * edgeData[((y + 1) * width + (x - 1)) * 4] +
          1 * edgeData[((y + 1) * width + (x + 1)) * 4];

        const gy =
          -1 * edgeData[((y - 1) * width + (x - 1)) * 4] +
          -2 * edgeData[((y - 1) * width + x) * 4] +
          -1 * edgeData[((y - 1) * width + (x + 1)) * 4] +
          1 * edgeData[((y + 1) * width + (x - 1)) * 4] +
          2 * edgeData[((y + 1) * width + x) * 4] +
          1 * edgeData[((y + 1) * width + (x + 1)) * 4];

        const mag = Math.sqrt(gx * gx + gy * gy);
        const isEdge = mag >= thresh;
        data[i] = isEdge ? 0 : 255;
        data[i + 1] = isEdge ? 0 : 255;
        data[i + 2] = isEdge ? 0 : 255;
        data[i + 3] = isEdge ? 255 : 0;
      }
    }
  }

  return out;
}

/** Pixel-Perfect stroke cleaner (Aseprite algorithm). */
export function cleanPixelPerfectPath(
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;
  const result: Array<{ x: number; y: number }> = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Check for L-shaped corner double pixel
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const isLCorner =
      (Math.abs(dx1) === 1 && dy1 === 0 && dx2 === 0 && Math.abs(dy2) === 1) ||
      (dx1 === 0 && Math.abs(dy1) === 1 && Math.abs(dx2) === 1 && dy2 === 0);

    if (isLCorner && prev.x !== next.x && prev.y !== next.y) {
      // Skip corner pixel `curr` to produce clean 1px diagonal step
      continue;
    }
    result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
}

// 4x4 Bayer Dithering Matrix
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Generate a 4x4 Bayer dithered gradient canvas. */
export function drawDitheredGradient(
  width: number,
  height: number,
  color1Hex: string,
  color2Hex: string,
  type: 'linear' | 'radial' = 'linear'
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const parseHex = (hex: string) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  const [r1, g1, b1] = parseHex(color1Hex);
  const [r2, g2, b2] = parseHex(color2Hex);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let t = 0;
      if (type === 'linear') {
        t = x / Math.max(1, width - 1);
      } else {
        const dist = Math.hypot(x - cx, y - cy);
        t = Math.min(1, dist / maxDist);
      }

      // Bayer matrix threshold
      const bayerVal = (BAYER_4X4[y % 4][x % 4] + 0.5) / 16;
      const thresholdT = t > bayerVal ? 1 : 0;

      const r = Math.round(r1 + (r2 - r1) * thresholdT);
      const g = Math.round(g1 + (g2 - g1) * thresholdT);
      const b = Math.round(b1 + (b2 - b1) * thresholdT);

      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Layer Blend Mode calculations. */
export function blendPixel(
  baseR: number,
  baseG: number,
  baseB: number,
  baseA: number,
  topR: number,
  topG: number,
  topB: number,
  topA: number,
  opacity: number,
  mode: LayerBlendMode
): [number, number, number, number] {
  const alpha = (topA / 255) * opacity;
  if (alpha <= 0) return [baseR, baseG, baseB, baseA];

  const blendChannel = (b: number, t: number): number => {
    b /= 255;
    t /= 255;
    let res = 0;
    switch (mode) {
      case 'multiply':
        res = b * t;
        break;
      case 'screen':
        res = 1 - (1 - b) * (1 - t);
        break;
      case 'overlay':
        res = b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
        break;
      case 'darken':
        res = Math.min(b, t);
        break;
      case 'lighten':
        res = Math.max(b, t);
        break;
      case 'color-dodge':
        res = t === 1 ? 1 : Math.min(1, b / (1 - t));
        break;
      case 'soft-light':
        res =
          t < 0.5
            ? b - (1 - 2 * t) * b * (1 - b)
            : b + (2 * t - 1) * (Math.sqrt(b) - b);
        break;
      case 'normal':
      default:
        res = t;
        break;
    }
    return Math.round(clamp(res * 255));
  };

  const r = Math.round(baseR * (1 - alpha) + blendChannel(baseR, topR) * alpha);
  const g = Math.round(baseG * (1 - alpha) + blendChannel(baseG, topG) * alpha);
  const b = Math.round(baseB * (1 - alpha) + blendChannel(baseB, topB) * alpha);
  const a = Math.round(clamp(baseA + topA * opacity * (1 - baseA / 255)));

  return [r, g, b, a];
}

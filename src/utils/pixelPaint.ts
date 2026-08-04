/** Pixel paint helpers (Aseprite-style). */

export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function rgbaToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function colorsMatch(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
  tol = 0
): boolean {
  return (
    Math.abs(data[i] - r) <= tol &&
    Math.abs(data[i + 1] - g) <= tol &&
    Math.abs(data[i + 2] - b) <= tol &&
    Math.abs(data[i + 3] - a) <= tol
  );
}

/** Scanline flood fill on ImageData. */
export function floodFill(
  image: ImageData,
  sx: number,
  sy: number,
  fill: [number, number, number, number]
): void {
  const { width: w, height: h, data } = image;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const start = (sy * w + sx) * 4;
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  if (tr === fill[0] && tg === fill[1] && tb === fill[2] && ta === fill[3]) return;

  const match = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return data[i] === tr && data[i + 1] === tg && data[i + 2] === tb && data[i + 3] === ta;
  };
  const paint = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  };

  const stack: Array<[number, number]> = [[sx, sy]];
  while (stack.length) {
    const [x0, y] = stack.pop()!;
    let x = x0;
    while (x >= 0 && match(x, y)) x--;
    x++;
    let spanUp = false;
    let spanDown = false;
    for (; x < w && match(x, y); x++) {
      paint(x, y);
      if (y > 0) {
        const up = match(x, y - 1);
        if (up && !spanUp) {
          stack.push([x, y - 1]);
          spanUp = true;
        } else if (!up) spanUp = false;
      }
      if (y < h - 1) {
        const down = match(x, y + 1);
        if (down && !spanDown) {
          stack.push([x, y + 1]);
          spanDown = true;
        } else if (!down) spanDown = false;
      }
    }
  }
}

export function drawBresenham(
  _ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  plot: (x: number, y: number) => void
): void {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    for (let by = 0; by < size; by++) {
      for (let bx = 0; bx < size; bx++) plot(x + bx, y + by);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

export function drawEllipseOutline(
  plot: (x: number, y: number) => void,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  if (rx <= 0 || ry <= 0) {
    plot(cx, cy);
    return;
  }
  let x = 0;
  let y = ry;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  let twoRx2 = 2 * rx2;
  let twoRy2 = 2 * ry2;
  let p;
  let px = 0;
  let py = twoRx2 * y;

  const mark = (xi: number, yi: number) => {
    plot(cx + xi, cy + yi);
    plot(cx - xi, cy + yi);
    plot(cx + xi, cy - yi);
    plot(cx - xi, cy - yi);
  };

  p = Math.round(ry2 - rx2 * ry + 0.25 * rx2);
  while (px < py) {
    mark(x, y);
    x++;
    px += twoRy2;
    if (p < 0) p += ry2 + px;
    else {
      y--;
      py -= twoRx2;
      p += ry2 + px - py;
    }
  }
  p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);
  while (y >= 0) {
    mark(x, y);
    y--;
    py -= twoRx2;
    if (p > 0) p += rx2 - py;
    else {
      x++;
      px += twoRy2;
      p += rx2 - py + px;
    }
  }
}

export const ASEPRITE_DEFAULT_PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#ffffff', '#94e2ff', '#ed7300', '#ed7300', '#e68619', '#ec5b62', '#2d9d78', '#6e6e6e',
  '#4d4d4d', '#8c8c8c', '#b3b3b3', '#e8e8e8', '#7b2cbf', '#f4a261', '#2a9d8f', '#e9c46a',
];

export type SymmetryMode = 'off' | 'horizontal' | 'vertical' | 'radial';
export type DitherPattern = 'bayer2x2' | 'bayer4x4' | 'checker' | 'stripe';

/** Calculate mirrored coordinates for pixel drawing. */
export function getSymmetryPoints(
  x: number,
  y: number,
  width: number,
  height: number,
  mode: SymmetryMode
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [{ x, y }];
  if (mode === 'off') return points;

  const mirrorX = width - 1 - x;
  const mirrorY = height - 1 - y;

  if (mode === 'horizontal' || mode === 'radial') {
    if (mirrorX !== x) points.push({ x: mirrorX, y });
  }
  if (mode === 'vertical' || mode === 'radial') {
    if (mirrorY !== y) points.push({ x, y: mirrorY });
  }
  if (mode === 'radial') {
    if (mirrorX !== x && mirrorY !== y) points.push({ x: mirrorX, y: mirrorY });
  }
  return points;
}

/** Check if pixel passes dither matrix pattern test. */
export function shouldDitherPixel(x: number, y: number, pattern: DitherPattern): boolean {
  if (pattern === 'checker') {
    return (x + y) % 2 === 0;
  }
  if (pattern === 'stripe') {
    return (x + y) % 3 === 0;
  }
  if (pattern === 'bayer2x2') {
    const matrix = [
      [0, 2],
      [3, 1],
    ];
    return matrix[y % 2][x % 2] < 2;
  }
  if (pattern === 'bayer4x4') {
    const matrix = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    return matrix[y % 4][x % 4] < 8;
  }
  return true;
}

/** Convert RGB to HSL. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

/** Convert HSL back to RGB hex. */
function hslToHex(h: number, s: number, l: number): string {
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
  return rgbaToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

/** Generate a 5-step shading color ramp from base color (Highlight, Light, Base, Shadow, Ambient). */
export function generateColorRamp(baseHex: string): string[] {
  const [r, g, b] = hexToRgba(baseHex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const highlight = hslToHex(h, Math.max(0, s - 0.05), Math.min(0.95, l + 0.25));
  const light = hslToHex(h, Math.max(0, s - 0.02), Math.min(0.9, l + 0.12));
  const base = baseHex;
  const shadow = hslToHex((h + 0.02) % 1, Math.min(1, s + 0.08), Math.max(0.08, l - 0.15));
  const ambient = hslToHex((h + 0.04) % 1, Math.min(1, s + 0.15), Math.max(0.04, l - 0.28));

  return [highlight, light, base, shadow, ambient];
}

/** 1-click Auto Outline: Draws a 1px solid stroke around all opaque non-transparent pixels. */
export function generatePixelOutline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  outlineHex: string
): void {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const outlineRgba = hexToRgba(outlineHex);

  const outlinePositions: Array<[number, number]> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha === 0) {
        // Check if any neighbor is opaque
        let hasOpaqueNeighbor = false;
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = (ny * width + nx) * 4;
            if (data[nIdx + 3] > 0) {
              hasOpaqueNeighbor = true;
              break;
            }
          }
        }
        if (hasOpaqueNeighbor) {
          outlinePositions.push([x, y]);
        }
      }
    }
  }

  for (const [ox, oy] of outlinePositions) {
    const oIdx = (oy * width + ox) * 4;
    data[oIdx] = outlineRgba[0];
    data[oIdx + 1] = outlineRgba[1];
    data[oIdx + 2] = outlineRgba[2];
    data[oIdx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
}

export { PAINT_PALETTES, getPaintPalette } from './paintPalettes';
export type { PaintPalette, PaintPaletteId } from './paintPalettes';

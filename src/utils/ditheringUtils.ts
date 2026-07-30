export interface GradientStop {
  id: string;
  color: string;
  position: number; // 0 to 100
  opacity: number; // 0 to 100
  midpoint?: number; // 0 to 100
}

export type GradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';

// 64-Color Professional Master Palette
export const PRO_ARTIST_64_PALETTE = [
  // Grayscale (8)
  '#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080', '#b3b3b3', '#ffffff',
  // Reds & Pinks (8)
  '#4a0e17', '#781d28', '#a82c35', '#d9383a', '#ef4444', '#f87171', '#f43f5e', '#fb7185',
  // Oranges & Yellows (8)
  '#7c2d12', '#9a3412', '#c2410c', '#ea580c', '#f97316', '#fb923c', '#eab308', '#facc15',
  // Greens & Teals (8)
  '#064e3b', '#047857', '#059669', '#10b981', '#34d399', '#0d9488', '#14b8a6', '#2dd4bf',
  // Blues & Cyans (8)
  '#0c4a6e', '#0369a1', '#0284c7', '#02a0e8', '#38bdf8', '#2563eb', '#3b82f6', '#60a5fa',
  // Purples & Violets (8)
  '#3b0764', '#581c87', '#7e22ce', '#9333ea', '#a855f7', '#c084fc', '#d8b4fe', '#f0abfc',
  // Earth Tones & Browns (8)
  '#271c19', '#452b1e', '#633b24', '#854d27', '#a66538', '#c7804a', '#e3a068', '#f5c99e',
  // Neons & Highlights (8)
  '#00ff66', '#00ffff', '#ff00ff', '#ff0055', '#ffcc00', '#a3e635', '#38edf6', '#ff99dd',
];

// Classic Game System Palette Presets
export const PICO_CAD_PALETTE = [
  '#000000', '#1D2B53', '#7E2553', '#008751',
  '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436',
  '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
];

export const GAME_BOY_DMG_PALETTE = [
  '#0f380f', '#306230', '#8bac0f', '#9bbc0f',
];

export const GAME_BOY_POCKET_PALETTE = [
  '#000000', '#545454', '#a9a9a9', '#ffffff',
];

export const NES_PALETTE = [
  '#000000', '#fcbcb0', '#f87858', '#f83800',
  '#e40058', '#980088', '#0000bc', '#0070ec',
  '#00b8f8', '#00f8f8', '#00b800', '#00f800',
  '#b8f818', '#f8d878', '#ac7c00', '#ffffff',
];

export const SNES_PALETTE = [
  '#0b0b0b', '#381c00', '#743a00', '#e06c00',
  '#ff9d3b', '#264a00', '#4a8a00', '#85d614',
  '#003874', '#006ce0', '#3b9dff', '#740085',
  '#d614e0', '#888888', '#cccccc', '#ffffff',
];

export const GENESIS_PALETTE = [
  '#000000', '#202020', '#404040', '#606060',
  '#0000a0', '#0040ff', '#00a0ff', '#00ffff',
  '#00a000', '#00ff00', '#a0ff00', '#ffff00',
  '#a00000', '#ff0000', '#ff00a0', '#ffffff',
];

export const C64_PALETTE = [
  '#000000', '#ffffff', '#880000', '#aaffee',
  '#cc44cc', '#00cc55', '#00ccaa', '#eeee77',
  '#dd8855', '#664400', '#ff7777', '#333333',
  '#777777', '#aaff66', '#0088ff', '#bbbbbb',
];

export const ZX_SPECTRUM_PALETTE = [
  '#000000', '#0000d7', '#d70000', '#d700d7',
  '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
];

export const PSX_PALETTE = [
  // Dark / Shading Tones (8)
  '#080808', '#14171a', '#222831', '#303841', '#3a4750', '#4a5568', '#718096', '#a0aec0',
  // Classic PSX 3D Tones (Metal Gear / Silent Hill / FF7) (8)
  '#1a365d', '#2b6cb0', '#3182ce', '#63b3ed', '#276749', '#2f855a', '#38a169', '#68d391',
  // Warm Low-Poly Colors (Crash / Spyro / Tekken) (8)
  '#7b341e', '#9c4221', '#c05621', '#dd6b20', '#ed8936', '#f6ad55', '#feebc8', '#ffffff',
  // Vibrant PS1 High-Color Accents (8)
  '#742a2a', '#9b2c2c', '#c53030', '#e53e3e', '#f56565', '#d69e2e', '#ecc94b', '#00f5d4',
];

export const CYBERPUNK_PALETTE = [
  '#0d0221', '#0f084b', '#26408b', '#00d2ff',
  '#ff007f', '#ff00ff', '#7928ca', '#430089',
  '#f80075', '#ff9900', '#ffe600', '#00ff66',
  '#00ffff', '#9900ff', '#ff0033', '#ffffff',
];

export const GAME_SYSTEM_PALETTES = [
  { id: 'pro64', name: 'Pro Artist 64-Color Spectrum', palette: PRO_ARTIST_64_PALETTE },
  { id: 'picocad', name: 'PolyStage 16', palette: PICO_CAD_PALETTE },
  { id: 'gb_dmg', name: 'Game Boy DMG', palette: GAME_BOY_DMG_PALETTE },
  { id: 'gb_pocket', name: 'Game Boy Pocket', palette: GAME_BOY_POCKET_PALETTE },
  { id: 'nes', name: 'NES / Famicom', palette: NES_PALETTE },
  { id: 'snes', name: 'SNES 16-Bit', palette: SNES_PALETTE },
  { id: 'genesis', name: 'Sega Genesis', palette: GENESIS_PALETTE },
  { id: 'c64', name: 'Commodore 64', palette: C64_PALETTE },
  { id: 'zx', name: 'ZX Spectrum', palette: ZX_SPECTRUM_PALETTE },
  { id: 'psx', name: 'PlayStation 1', palette: PSX_PALETTE },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', palette: CYBERPUNK_PALETTE },
];

/** Convert HEX color to RGB object */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
  }
  const num = parseInt(cleanHex, 16) || 0;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Convert RGB to HEX string */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Interpolate between two HEX colors at factor t (0..1) */
export function interpolateColor(color1: string, color2: string, t: number): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  const r = c1.r + (c2.r - c1.r) * t;
  const g = c1.g + (c2.g - c1.g) * t;
  const b = c1.b + (c2.b - c1.b) * t;
  return rgbToHex(r, g, b);
}

/** Render a multi-stop gradient onto an HTML5 Canvas */
export function renderGradientToCanvas(
  canvas: HTMLCanvasElement,
  stops: GradientStop[],
  type: GradientType = 'linear',
  angleDegrees: number = 0
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  if (sortedStops.length === 0) return;

  let gradient: CanvasGradient;

  if (type === 'radial') {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(width, height) / 2;
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  } else if (type === 'reflected') {
    const cx = width / 2;
    gradient = ctx.createLinearGradient(cx, 0, width, 0);
  } else {
    const rad = (angleDegrees * Math.PI) / 180;
    const x0 = width / 2 - (Math.cos(rad) * width) / 2;
    const y0 = height / 2 - (Math.sin(rad) * height) / 2;
    const x1 = width / 2 + (Math.cos(rad) * width) / 2;
    const y1 = height / 2 + (Math.sin(rad) * height) / 2;
    gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  }

  sortedStops.forEach((stop) => {
    const pos = Math.max(0, Math.min(1, stop.position / 100));
    const alpha = (stop.opacity ?? 100) / 100;
    const rgb = hexToRgb(stop.color);
    const rgba = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    try {
      gradient.addColorStop(pos, rgba);
    } catch {
      /* ignore invalid stop position edge cases */
    }
  });

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Bayer 4x4 Dithering matrix */
const BAYER_4X4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

/** Apply Bayer dithering & color palette quantization to a Canvas */
export function applyBayerDitheringToCanvas(
  canvas: HTMLCanvasElement,
  palette: string[] = PICO_CAD_PALETTE,
  spread: number = 32
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const paletteRgb = palette.map(hexToRgb);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];

      const bayerVal = (BAYER_4X4[y % 4][x % 4] / 16.0 - 0.5) * spread;

      r = Math.max(0, Math.min(255, r + bayerVal));
      g = Math.max(0, Math.min(255, g + bayerVal));
      b = Math.max(0, Math.min(255, b + bayerVal));

      let closestColor = paletteRgb[0];
      let minDistance = Infinity;

      for (let i = 0; i < paletteRgb.length; i++) {
        const p = paletteRgb[i];
        const dist = (r - p.r) ** 2 + (g - p.g) ** 2 + (b - p.b) ** 2;
        if (dist < minDistance) {
          minDistance = dist;
          closestColor = p;
        }
      }

      data[idx] = closestColor.r;
      data[idx + 1] = closestColor.g;
      data[idx + 2] = closestColor.b;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

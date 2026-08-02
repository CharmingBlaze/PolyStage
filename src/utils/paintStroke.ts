import type { CADMesh, Face } from '../types/cad';
import { buildUvTopology } from './uvTopology';

/** Bresenham-style UV texel walk (inclusive of end, exclusive of start when skipStart). */
export function walkUvTexels(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  textureSize: number,
  options?: { skipStart?: boolean; maxTexels?: number },
): Array<{ u: number; v: number; px: number; py: number }> {
  const tex = Math.max(1, textureSize | 0);
  const x0 = Math.max(0, Math.min(tex - 1, Math.floor(u0 * tex)));
  const y0 = Math.max(0, Math.min(tex - 1, Math.floor(v0 * tex)));
  const x1 = Math.max(0, Math.min(tex - 1, Math.floor(u1 * tex)));
  const y1 = Math.max(0, Math.min(tex - 1, Math.floor(v1 * tex)));

  const pts: Array<{ u: number; v: number; px: number; py: number }> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let first = true;
  const maxTexels = Math.max(1, options?.maxTexels ?? (dx + dy + 2));
  let guard = 0;

  while (guard++ < maxTexels) {
    if (!(first && options?.skipStart)) {
      pts.push({
        px: x,
        py: y,
        u: (x + 0.5) / tex,
        v: (y + 0.5) / tex,
      });
    }
    first = false;
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
  return pts;
}

export type UvBounds = { u0: number; v0: number; u1: number; v1: number };

function faceUvBounds(face: Face): UvBounds | null {
  if (!face.uvs?.length) return null;
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const uv of face.uvs) {
    if (!uv) continue;
    u0 = Math.min(u0, uv.u);
    v0 = Math.min(v0, uv.v);
    u1 = Math.max(u1, uv.u);
    v1 = Math.max(v1, uv.v);
  }
  if (!Number.isFinite(u0)) return null;
  return { u0, v0, u1, v1 };
}

/** UV bounds of the island containing `faceId` (falls back to that face alone). */
export function islandUvBoundsForFace(mesh: CADMesh | null | undefined, faceId: string | null | undefined): UvBounds | null {
  if (!mesh || !faceId) return null;
  try {
    const topo = buildUvTopology(mesh);
    const islandId = topo.faceToIsland.get(faceId);
    if (islandId) {
      const island = topo.islands.get(islandId);
      if (island) {
        let u0 = Infinity;
        let v0 = Infinity;
        let u1 = -Infinity;
        let v1 = -Infinity;
        for (const uvFaceId of island.uvFaceIds) {
          const face = mesh.faces.find((f) => f.id === uvFaceId);
          const b = face ? faceUvBounds(face) : null;
          if (!b) continue;
          u0 = Math.min(u0, b.u0);
          v0 = Math.min(v0, b.v0);
          u1 = Math.max(u1, b.u1);
          v1 = Math.max(v1, b.v1);
        }
        if (Number.isFinite(u0)) return { u0, v0, u1, v1 };
      }
    }
  } catch {
    /* fall through */
  }
  const face = mesh.faces.find((f) => f.id === faceId);
  return face ? faceUvBounds(face) : null;
}

/** True if texel center lies inside UV bounds (with tiny padding for edge texels). */
export function texelInUvBounds(
  px: number,
  py: number,
  textureSize: number,
  bounds: UvBounds,
  padTexels = 0.5,
): boolean {
  const tex = Math.max(1, textureSize);
  const pad = padTexels / tex;
  const u = (px + 0.5) / tex;
  const v = (py + 0.5) / tex;
  return (
    u >= bounds.u0 - pad
    && u <= bounds.u1 + pad
    && v >= bounds.v0 - pad
    && v <= bounds.v1 + pad
  );
}

export type BrushTexel = { x: number; y: number; strength: number };

/**
 * Brush footprint in texel space.
 * Default soft=false → hard square (pixel-art / pencil). Soft circular falloff
 * is opt-in for airbrush-like tools only — soft+alpha reads as smeared quads on 3D.
 */
export function collectBrushTexels(
  cx: number,
  cy: number,
  size: number,
  soft = false,
): BrushTexel[] {
  const s = Math.max(1, Math.round(size));
  if (s === 1 || !soft) {
    const half = Math.floor(s / 2);
    const out: BrushTexel[] = [];
    for (let by = 0; by < s; by++) {
      for (let bx = 0; bx < s; bx++) {
        out.push({ x: cx - half + bx, y: cy - half + by, strength: 1 });
      }
    }
    return out;
  }

  const radius = s * 0.5;
  const r2 = radius * radius;
  const out: BrushTexel[] = [];
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / radius;
      // Smooth falloff — solid core, soft rim.
      const strength = t <= 0.35 ? 1 : Math.max(0.08, (1 - t) * (1 - t) * 1.35);
      out.push({ x, y, strength: Math.min(1, strength) });
    }
  }
  return out.length ? out : [{ x: cx, y: cy, strength: 1 }];
}

/** Light EMA smoothing for pointer samples (tames jagged UV stamps). */
export function smoothPaintPoint(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number },
  alpha = 0.55,
): { x: number; y: number } {
  if (!prev) return next;
  const a = Math.max(0.15, Math.min(1, alpha));
  return {
    x: prev.x + (next.x - prev.x) * a,
    y: prev.y + (next.y - prev.y) * a,
  };
}

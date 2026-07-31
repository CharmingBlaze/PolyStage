/**
 * Vector Blockout — dual-silhouette loft (Front X × Side Z, optional Top XZ).
 * Matches Low Poly Character Modeler blockout:
 *   - Height rings follow Front/Side curves (taper to tips)
 *   - Missing axis uses configurable thickness (default 0.6 full width)
 *   - Side walls are quads; caps use an inner ring + pole (game-friendlier edge flow)
 *   - Top is optional and shapes the XZ cross-section (Front or Side required for height)
 */
import type { CADMesh, Face, Vertex } from '../types/cad';
import { createEdgesFromFaces, finalizeEditableMesh, generateId } from './topology';
import { recenterMeshOrigin } from './meshUtils';
import { smartUnwrapFaces } from './uvAdvanced';

export type VectorPlane = 'front' | 'side' | 'top';
export type VectorPoint = { u: number; v: number };
export type BezierAnchor = {
  point: VectorPoint;
  handleIn: VectorPoint;
  handleOut: VectorPoint;
};
export type BezierPath = {
  id: string;
  plane: VectorPlane;
  name: string;
  anchors: BezierAnchor[];
  closed: boolean;
};

/** Indexed mesh snapshot from the loft (before CAD id conversion). */
export type VectorMeshSnapshot = {
  vertices: { x: number; y: number; z: number }[];
  /** Logical polygons: wall quads + pole fan tris. */
  faces: number[][];
  edges: [number, number][];
};

export type VectorCapStyle = 'game' | 'pointed';

export type VectorLoftOptions = {
  /** Full width on the missing Front/Side axis (world units). Default 0.6. */
  thickness?: number;
  /**
   * Prefer even side counts (mirroring / UV friendly). Default true.
   */
  gameTopology?: boolean;
  /**
   * `game` — inset quad ring + small tip (editable, good for games).
   * `pointed` — single pole fan (organic tips).
   * Default `game`.
   */
  capStyle?: VectorCapStyle;
  /**
   * When only one silhouette is closed, taper thickness toward the tips
   * so ends aren't flat slabs. Default true.
   */
  taperThickness?: boolean;
  /**
   * `box` — cross-section hugs Front/Side extents (clean ortho seams, game default).
   * `ellipse` — softer elliptical section (can wander a center line in Side view).
   * Default `box` when gameTopology is on.
   * Prefer `roundness` (0–1) to blend square → rounded while keeping box seams.
   */
  crossSection?: 'box' | 'ellipse';
  /**
   * 0 = square/box cross-section (default).
   * 1 = fully elliptical. In-between uses a superellipse (rounded box).
   */
  roundness?: number;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Default full width when Front or Side silhouette is missing. */
export const DEFAULT_BLOCKOUT_THICKNESS = 0.6;

/** Snap radial segments to a multiple of 4 (box loft width seams / mirroring). */
export function evenRadialSegments(n: number, min = 4): number {
  const rounded = Math.max(min, Math.round(n));
  const even = rounded % 2 === 0 ? rounded : rounded + 1;
  if (even % 4 === 0) return even;
  return even + 2; // 2 or 6 mod 4 → next multiple of 4
}

/** Mesh Detail slider (0–100) → height rings + around count for low/mid poly. */
export function qualityToSegments(quality: number): {
  vertical: number;
  radial: number;
} {
  const t = Math.max(0, Math.min(1, quality / 100));
  // Ease slightly so the mid of the slider stays in the game/solid sweet spot.
  const eased = t * t * (3 - 2 * t);
  const vertical = Math.round(6 + eased * 12); // 6…18
  const radial = evenRadialSegments(8 + eased * 12, 8); // 8…20
  return { vertical, radial };
}

/** Inverse of qualityToSegments for the Mesh Detail slider thumb. */
export function segmentsToQuality(vertical: number, radial: number): number {
  const tV = (Math.max(6, vertical) - 6) / 12;
  const tR = (Math.max(8, radial) - 8) / 12;
  return Math.round(Math.max(0, Math.min(100, ((tV + tR) / 2) * 100)));
}

export function cubicPoint(
  a: VectorPoint,
  b: VectorPoint,
  c: VectorPoint,
  d: VectorPoint,
  t: number
): VectorPoint {
  const ab = { u: mix(a.u, b.u, t), v: mix(a.v, b.v, t) };
  const bc = { u: mix(b.u, c.u, t), v: mix(b.v, c.v, t) };
  const cd = { u: mix(c.u, d.u, t), v: mix(c.v, d.v, t) };
  const abc = { u: mix(ab.u, bc.u, t), v: mix(ab.v, bc.v, t) };
  const bcd = { u: mix(bc.u, cd.u, t), v: mix(bc.v, cd.v, t) };
  return { u: mix(abc.u, bcd.u, t), v: mix(abc.v, bcd.v, t) };
}

export function sampleBezierPath(path: BezierPath, stepsPerSegment = 16): VectorPoint[] {
  const { anchors } = path;
  if (!anchors.length) return [];
  if (anchors.length === 1) return [{ ...anchors[0].point }];
  const count = path.closed ? anchors.length : anchors.length - 1;
  const points: VectorPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    for (let j = 0; j < stepsPerSegment; j++) {
      points.push(cubicPoint(a.point, a.handleOut, b.handleIn, b.point, j / stepsPerSegment));
    }
  }
  points.push({ ...(path.closed ? anchors[0].point : anchors[anchors.length - 1].point) });
  return points;
}

/** Resample a closed path to N points evenly spaced by arc length. */
export function sampleClosedPathEvenly(path: BezierPath, count: number): VectorPoint[] {
  const dense = sampleBezierPath(path, 32);
  if (dense.length < 2 || count < 3) return dense.slice(0, Math.max(count, 0));

  const lengths: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const du = dense[i].u - dense[i - 1].u;
    const dv = dense[i].v - dense[i - 1].v;
    lengths.push(lengths[i - 1] + Math.hypot(du, dv));
  }
  const total = lengths[lengths.length - 1];
  if (total < 1e-8) {
    return Array.from({ length: count }, () => ({ ...dense[0] }));
  }

  const out: VectorPoint[] = [];
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    let seg = 0;
    while (seg < lengths.length - 2 && lengths[seg + 1] < target) seg++;
    const a = lengths[seg];
    const b = lengths[seg + 1];
    const t = b > a ? (target - a) / (b - a) : 0;
    out.push({
      u: mix(dense[seg].u, dense[seg + 1].u, t),
      v: mix(dense[seg].v, dense[seg + 1].v, t),
    });
  }
  return out;
}

function extentAtHeight(points: VectorPoint[], y: number): [number, number] | null {
  const hits: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if ((a.v <= y && b.v > y) || (b.v <= y && a.v > y)) {
      const t = (y - a.v) / (b.v - a.v);
      hits.push(mix(a.u, b.u, t));
    }
  }
  if (hits.length < 2) return null;
  return [Math.min(...hits), Math.max(...hits)];
}

/** Laplacian-smooth a centerline so vertical mesh seams don’t zigzag. */
function smoothSpine(values: number[], passes = 3): number[] {
  if (values.length < 3) return values.slice();
  let cur = values.slice();
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = cur[i] * 0.5 + cur[i - 1] * 0.25 + cur[i + 1] * 0.25;
    }
    cur = next;
  }
  return cur;
}

/**
 * Box ring via perimeter walk (CCW). `sides` should be a multiple of 4.
 * Optional width/depth fractions pull vertical seams under silhouette control points.
 */
function boxRingPerimeter(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  sides: number,
  widthFractions: number[] = [],
  depthFractions: number[] = []
): { x: number; y: number; z: number }[] {
  const perEdge = Math.max(1, Math.round(sides / 4));
  const xTs = boxEdgeSampleTs(perEdge, widthFractions);
  const zTs = boxEdgeSampleTs(perEdge, depthFractions);
  const out: { x: number; y: number; z: number }[] = [];
  // +Z: x1 → x0 (Front face — width seams)
  for (const t of xTs) out.push({ x: mix(x1, x0, t), y, z: z1 });
  // -X: z1 → z0 (Side face — depth seams)
  for (const t of zTs) out.push({ x: x0, y, z: mix(z1, z0, t) });
  // -Z: x0 → x1 (Back face)
  for (const t of xTs) out.push({ x: mix(x0, x1, t), y, z: z0 });
  // +X: z0 → z1
  for (const t of zTs) out.push({ x: x1, y, z: mix(z0, z1, t) });
  return out;
}

/**
 * Edge sample parameters t ∈ [0, 1) for a box face (start corner only; end is next face).
 * Always keeps outer corner (0) + center (0.5), merges silhouette width features, then
 * fills to `perEdge` for a clean even count.
 */
function boxEdgeSampleTs(perEdge: number, widthFractions: number[] = []): number[] {
  const n = Math.max(1, Math.round(perEdge));
  const set = new Set<number>([0]);
  if (n >= 2) set.add(0.5);
  for (const f of widthFractions) {
    const clamped = Math.min(0.95, Math.max(0.05, f));
    set.add((1 - clamped) / 2);
    set.add((1 + clamped) / 2);
  }
  let ts = [...set].filter((t) => t >= 0 && t < 1 - 1e-9).sort((a, b) => a - b);

  const insertMidInLargestGap = () => {
    let bestI = 0;
    let bestGap = 0;
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i];
      const b = i + 1 < ts.length ? ts[i + 1] : 1;
      const gap = b - a;
      if (gap > bestGap) {
        bestGap = gap;
        bestI = i;
      }
    }
    const a = ts[bestI];
    const b = bestI + 1 < ts.length ? ts[bestI + 1] : 1;
    ts.splice(bestI + 1, 0, (a + b) / 2);
  };

  while (ts.length < n) insertMidInLargestGap();

  if (ts.length > n) {
    const preferred = new Set<number>([0, 0.5]);
    for (const f of widthFractions) {
      const clamped = Math.min(0.95, Math.max(0.05, f));
      preferred.add((1 - clamped) / 2);
      preferred.add((1 + clamped) / 2);
    }
    const scored = ts.map((t) => {
      const nearPreferred = [...preferred].some((p) => Math.abs(p - t) < 1e-4);
      return { t, score: nearPreferred ? 0 : 1 };
    });
    scored.sort((a, b) => a.score - b.score || a.t - b.t);
    ts = scored
      .slice(0, n)
      .map((s) => s.t)
      .sort((a, b) => a - b);
    if (!ts.length || Math.abs(ts[0]) > 1e-9) ts = [0, ...ts.filter((t) => t > 1e-9)];
    while (ts.length < n) insertMidInLargestGap();
    ts = ts.slice(0, n).sort((a, b) => a - b);
    ts[0] = 0;
  }

  return ts;
}

/** Ray–superellipse hit: |x/rx|^n + |z/rz|^n = 1. n→∞ is boxy, n=2 is ellipse. */
function superellipseAtAngle(
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  angle: number,
  n: number
): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = Math.abs(c) / Math.max(rx, 1e-8);
  const az = Math.abs(s) / Math.max(rz, 1e-8);
  const denom = Math.pow(ax, n) + Math.pow(az, n);
  const t = denom > 1e-12 ? Math.pow(denom, -1 / n) : 0;
  return { x: cx + c * t, z: cz + s * t };
}

/**
 * Square ring by default; `roundness` 0→1 blends toward a rounded / elliptical section
 * while preserving the same column count (vertical seams stay aligned).
 */
function crossSectionRing(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  sides: number,
  roundness: number,
  widthFractions: number[] = [],
  depthFractions: number[] = []
): { x: number; y: number; z: number }[] {
  const box = boxRingPerimeter(
    x0,
    x1,
    z0,
    z1,
    y,
    sides,
    widthFractions,
    depthFractions
  );
  const r = Math.max(0, Math.min(1, roundness));
  if (r < 1e-4) return box;

  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const rx = Math.max((x1 - x0) / 2, 1e-6);
  const rz = Math.max((z1 - z0) / 2, 1e-6);
  // High exponent ≈ box with soft corners; 2 = ellipse.
  const n = mix(14, 2, Math.pow(r, 0.75));

  return box.map((p) => {
    const angle = Math.atan2(p.z - cz, p.x - cx);
    const rounded = superellipseAtAngle(cx, cz, rx, rz, angle, n);
    return {
      x: mix(p.x, rounded.x, r),
      y,
      z: mix(p.z, rounded.z, r),
    };
  });
}

function pathBounds(points: VectorPoint[]) {
  return {
    minV: Math.min(...points.map((p) => p.v)),
    maxV: Math.max(...points.map((p) => p.v)),
  };
}

/** Sharp corner (no curve handles) — default for game polygon blockouts. */
export function sharpAnchor(point: VectorPoint): BezierAnchor {
  return {
    point: { ...point },
    handleIn: { ...point },
    handleOut: { ...point },
  };
}

/**
 * Closed Front/Side companion cage from the other silhouette's height range.
 * Runs up the +u edge then down the −u edge so you can drag width/depth per height.
 */
export function buildCompanionCagePath(
  source: BezierPath,
  targetPlane: Exclude<VectorPlane, 'top'>,
  halfWidth: number,
  rungCount = 6
): BezierPath {
  const samples = sampleBezierPath(source, 24);
  if (samples.length < 2) {
    return {
      id: `${targetPlane}_silhouette`,
      plane: targetPlane,
      name: targetPlane,
      closed: true,
      anchors: [],
    };
  }
  const { minV, maxV } = pathBounds(samples);
  const hw = Math.max(0.05, halfWidth);
  // Prefer the source silhouette's own vertex heights so Front width rungs
  // line up with Side features (shoulders, waist, hips, etc.).
  let rungVs = silhouetteKeyHeights(source).filter((v) => v >= minV - 1e-6 && v <= maxV + 1e-6);
  if (rungVs.length < 3) {
    const n = Math.max(3, Math.round(rungCount));
    rungVs = Array.from({ length: n }, (_, i) => mix(minV, maxV, n === 1 ? 0 : i / (n - 1)));
  } else {
    // Ensure tips are included.
    if (rungVs[0] > minV + 1e-6) rungVs = [minV, ...rungVs];
    if (rungVs[rungVs.length - 1] < maxV - 1e-6) rungVs = [...rungVs, maxV];
  }
  const right: VectorPoint[] = rungVs.map((v) => ({ u: hw, v }));
  const left: VectorPoint[] = rungVs.map((v) => ({ u: -hw, v }));
  const points = [...right, ...left.slice().reverse()];
  return {
    id: `${targetPlane}_silhouette`,
    plane: targetPlane,
    name: targetPlane,
    closed: true,
    anchors: points.map(sharpAnchor),
  };
}

/**
 * Find the opposite-edge partner for symmetric width/depth edits (same height, mirrored u).
 */
export function findMirroredAnchorIndex(
  anchors: BezierAnchor[],
  index: number
): number {
  const src = anchors[index];
  if (!src) return -1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    if (i === index) continue;
    const a = anchors[i];
    const score = Math.abs(a.point.u + src.point.u) + Math.abs(a.point.v - src.point.v) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Require roughly mirrored across u=0 and similar height.
  if (best < 0 || bestScore > 0.35) return -1;
  return best;
}

/** Unique silhouette control heights ( fore + side anchors ), sorted. */
export function silhouetteKeyHeights(...paths: (BezierPath | null | undefined)[]): number[] {
  const set = new Set<number>();
  for (const path of paths) {
    if (!path?.anchors.length) continue;
    for (const anchor of path.anchors) set.add(Number(anchor.point.v.toFixed(6)));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Unique |u| features as fractions of the silhouette's max half-width (0 = center, 1 = outer).
 * Kept sparse (≤2) so box seams stay low/mid-poly: prefer half-width + one mid indent.
 */
export function silhouetteWidthFractions(
  ...paths: (BezierPath | null | undefined)[]
): number[] {
  const us: number[] = [];
  for (const path of paths) {
    if (!path?.anchors.length) continue;
    for (const anchor of path.anchors) us.push(Math.abs(anchor.point.u));
  }
  if (!us.length) return [];
  const maxU = Math.max(...us, 1e-6);
  const raw: number[] = [];
  const seen = new Set<number>();
  for (const u of us) {
    const f = Number((u / maxU).toFixed(3));
    if (f <= 0.08 || f >= 0.92) continue;
    if (seen.has(f)) continue;
    seen.add(f);
    raw.push(f);
  }
  if (raw.length <= 2) return raw.sort((a, b) => a - b);

  // Prefer one near-half indent and one further out — classic game character seams.
  const targets = [0.5, 0.72];
  const picked: number[] = [];
  for (const target of targets) {
    let best = -1;
    let bestD = Infinity;
    for (const f of raw) {
      if (picked.some((p) => Math.abs(p - f) < 0.12)) continue;
      const d = Math.abs(f - target);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best >= 0) picked.push(best);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * Build loft sample heights for game topology:
 * - Always include every silhouette key height (rings land on polygon points)
 * - Fill largest gaps until we reach verticalSegments+1 density
 */
export function buildLoftHeights(
  minY: number,
  maxY: number,
  verticalSegments: number,
  keyHeights: number[] = []
): number[] {
  if (maxY - minY < 1e-6) return [minY];
  const eps = Math.max((maxY - minY) * 1e-6, 1e-8);
  const quantize = (y: number) => Number(y.toFixed(6));
  const set = new Set<number>([quantize(minY), quantize(maxY)]);
  for (const key of keyHeights) {
    if (key < minY - eps || key > maxY + eps) continue;
    set.add(quantize(Math.min(maxY, Math.max(minY, key))));
  }
  let heights = [...set].sort((a, b) => a - b);

  // Density budget from the UI slider — never drop keys, only add fillers.
  const target = Math.max(heights.length, Math.max(4, Math.round(verticalSegments) + 1));
  while (heights.length < target) {
    let bestI = 0;
    let bestGap = 0;
    for (let i = 0; i < heights.length - 1; i++) {
      const gap = heights[i + 1] - heights[i];
      if (gap > bestGap) {
        bestGap = gap;
        bestI = i;
      }
    }
    if (bestGap < eps * 20) break;
    heights.splice(bestI + 1, 0, quantize((heights[bestI] + heights[bestI + 1]) / 2));
  }

  heights[0] = minY;
  heights[heights.length - 1] = maxY;
  return heights;
}

/** Closest point on a polygon/curve polyline segment (by straight chords between anchors). */
export function closestPointOnPath(
  path: BezierPath,
  point: VectorPoint
): { index: number; point: VectorPoint; distance: number } | null {
  const { anchors } = path;
  if (anchors.length < 2) return null;
  const count = path.closed ? anchors.length : anchors.length - 1;
  let bestIndex = 0;
  let bestDist = Infinity;
  let bestPoint = { ...anchors[0].point };
  for (let i = 0; i < count; i++) {
    const a = anchors[i].point;
    const b = anchors[(i + 1) % anchors.length].point;
    const abU = b.u - a.u;
    const abV = b.v - a.v;
    const len2 = abU * abU + abV * abV;
    const t =
      len2 < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((point.u - a.u) * abU + (point.v - a.v) * abV) / len2));
    const closest = { u: a.u + abU * t, v: a.v + abV * t };
    const dist = Math.hypot(point.u - closest.u, point.v - closest.v);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
      bestPoint = closest;
    }
  }
  return { index: bestIndex, point: bestPoint, distance: bestDist };
}

function edgesFromFaces(faces: number[][]): [number, number][] {
  const keys = new Set<string>();
  const edges: [number, number][] = [];
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (keys.has(key)) return;
    keys.add(key);
    edges.push([a, b]);
  };
  faces.forEach((face) => {
    for (let i = 0; i < face.length; i++) {
      add(face[i], face[(i + 1) % face.length]);
    }
  });
  return edges;
}

function ringCentroid(
  vertices: { x: number; y: number; z: number }[],
  start: number,
  sides: number
) {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let col = 0; col < sides; col++) {
    const v = vertices[start + col];
    sx += v.x;
    sy += v.y;
    sz += v.z;
  }
  return { x: sx / sides, y: sy / sides, z: sz / sides };
}

/**
 * Ring stack → wall quads + tip caps.
 * `game` caps: planar inset ring of quads, then a tiny pole fan (low valence at tip).
 * `pointed` caps: direct fan to silhouette tip (organic).
 */
function finishLoftWithPoles(
  ringVerts: { x: number; y: number; z: number }[],
  rings: number,
  sides: number,
  activeMinY: number,
  activeMaxY: number,
  capStyle: VectorCapStyle
): VectorMeshSnapshot {
  const vertices = ringVerts.map((v) => ({ ...v }));
  const faces: number[][] = [];

  for (let row = 0; row < rings; row++) {
    for (let col = 0; col < sides; col++) {
      const next = (col + 1) % sides;
      const a = row * sides + col;
      const b = row * sides + next;
      const c = (row + 1) * sides + next;
      const d = (row + 1) * sides + col;
      faces.push([a, b, c, d]);
    }
  }

  const addCap = (ringStart: number, tipY: number, winding: 'bottom' | 'top') => {
    const center = ringCentroid(vertices, ringStart, sides);

    if (capStyle === 'game' && sides >= 6 && sides % 2 === 0) {
      // Planar inset — most of the tip is quads (easy to select / bevel / UV later).
      const insetStart = vertices.length;
      for (let col = 0; col < sides; col++) {
        const outer = vertices[ringStart + col];
        vertices.push({
          x: mix(outer.x, center.x, 0.55),
          y: outer.y,
          z: mix(outer.z, center.z, 0.55),
        });
      }
      const pole = vertices.length;
      // Slight tip push so the end isn't a perfectly flat lid in perspective.
      const tipPush = (activeMaxY - activeMinY) * 0.012;
      vertices.push({
        x: center.x,
        y: winding === 'bottom' ? tipY - tipPush : tipY + tipPush,
        z: center.z,
      });

      for (let col = 0; col < sides; col++) {
        const next = (col + 1) % sides;
        const o0 = ringStart + col;
        const o1 = ringStart + next;
        const i0 = insetStart + col;
        const i1 = insetStart + next;
        if (winding === 'bottom') {
          faces.push([o0, o1, i1, i0]);
          faces.push([pole, i0, i1]);
        } else {
          faces.push([o0, i0, i1, o1]);
          faces.push([pole, i1, i0]);
        }
      }
      return;
    }

    const pole = vertices.length;
    vertices.push({ x: center.x, y: tipY, z: center.z });
    for (let col = 0; col < sides; col++) {
      const next = (col + 1) % sides;
      if (winding === 'bottom') {
        faces.push([pole, ringStart + col, ringStart + next]);
      } else {
        faces.push([pole, ringStart + next, ringStart + col]);
      }
    }
  };

  addCap(0, activeMinY, 'bottom');
  addCap(rings * sides, activeMaxY, 'top');

  return { vertices, faces, edges: edgesFromFaces(faces) };
}

/**
 * Builds a low-poly volume by combining the front silhouette's X extents with
 * the side silhouette's Z extents at matching heights (optional Top shapes XZ).
 */
export function vectorPathsToMesh(
  front: BezierPath | null,
  side: BezierPath | null,
  verticalSegments = 12,
  radialSegments = 10,
  topPath: BezierPath | null = null,
  options: VectorLoftOptions = {}
): VectorMeshSnapshot | null {
  const thickness = Math.max(0.05, options.thickness ?? DEFAULT_BLOCKOUT_THICKNESS);
  const half = thickness / 2;
  const gameTopology = options.gameTopology !== false;
  const capStyle: VectorCapStyle = options.capStyle ?? (gameTopology ? 'game' : 'pointed');
  const taperThickness = options.taperThickness !== false;
  const roundness = Math.max(0, Math.min(1, options.roundness ?? 0));
  const crossSection: 'box' | 'ellipse' =
    options.crossSection ?? (gameTopology || roundness < 0.999 ? 'box' : 'ellipse');
  const missingFront = !front?.closed;
  const missingSide = !side?.closed;
  const shouldTaperThickness = taperThickness && (missingFront !== missingSide);

  const frontPoints = front?.closed ? sampleBezierPath(front, 64) : [];
  const sidePoints = side?.closed ? sampleBezierPath(side, 64) : [];
  const topPoints = topPath?.closed ? sampleBezierPath(topPath, 48) : [];

  // Match reference blockout: need a Front or Side silhouette for height.
  // Top alone is not enough (it only shapes the XZ cross-section).
  if (!frontPoints.length && !sidePoints.length) return null;

  const frontBounds = frontPoints.length ? pathBounds(frontPoints) : null;
  const sideBounds = sidePoints.length ? pathBounds(sidePoints) : null;
  const minY = Math.max(
    frontBounds ? frontBounds.minV : -Infinity,
    sideBounds ? sideBounds.minV : -Infinity
  );
  const maxY = Math.min(
    frontBounds ? frontBounds.maxV : Infinity,
    sideBounds ? sideBounds.maxV : Infinity
  );

  const activeMinY = Number.isFinite(minY) ? minY : frontBounds?.minV ?? sideBounds?.minV ?? 0;
  const activeMaxY = Number.isFinite(maxY) ? maxY : frontBounds?.maxV ?? sideBounds?.maxV ?? 1;
  if (activeMaxY - activeMinY < 0.01) return null;

  const loftHeights = buildLoftHeights(
    activeMinY,
    activeMaxY,
    verticalSegments,
    silhouetteKeyHeights(front, side)
  );
  const rings = Math.max(1, loftHeights.length - 1);
  // Width/depth features snap into the user's radial budget — do NOT inflate
  // side count (that blows past low/mid-poly for detailed silhouettes).
  const widthFractions = gameTopology ? silhouetteWidthFractions(front) : [];
  const depthFractions = gameTopology ? silhouetteWidthFractions(side) : [];
  const sides = gameTopology
    ? evenRadialSegments(radialSegments, 4)
    : Math.max(4, Math.round(radialSegments));
  const epsilon = Math.max((activeMaxY - activeMinY) * 0.002, 0.0005);
  const tipFloor = 0.002;

  // Missing Front/Side axis → thickness (optionally tapered toward tips).
  const baseFx: [number, number] = [
    frontBounds ? Math.min(...frontPoints.map((p) => p.u)) : -half,
    frontBounds ? Math.max(...frontPoints.map((p) => p.u)) : half,
  ];
  const baseSz: [number, number] = [
    sideBounds ? Math.min(...sidePoints.map((p) => p.u)) : -half,
    sideBounds ? Math.max(...sidePoints.map((p) => p.u)) : half,
  ];

  // Gather per-ring extents first so we can stabilize the center spine.
  type RingExt = { y: number; fx: [number, number]; sz: [number, number] };
  const ringExt: RingExt[] = [];
  for (let row = 0; row <= rings; row++) {
    const rawY = loftHeights[row] ?? mix(activeMinY, activeMaxY, row / rings);
    const t = rings === 0 ? 0.5 : row / rings;
    let fx = frontPoints.length ? extentAtHeight(frontPoints, rawY) : null;
    let sz = sidePoints.length ? extentAtHeight(sidePoints, rawY) : null;
    if (frontPoints.length && !fx) {
      const sampleY = Math.min(activeMaxY - epsilon, Math.max(activeMinY + epsilon, rawY));
      fx = extentAtHeight(frontPoints, sampleY);
    }
    if (sidePoints.length && !sz) {
      const sampleY = Math.min(activeMaxY - epsilon, Math.max(activeMinY + epsilon, rawY));
      sz = extentAtHeight(sidePoints, sampleY);
    }
    const tipProfile = Math.sin(Math.PI * t);
    const taper = shouldTaperThickness ? mix(0.12, 1, tipProfile * tipProfile) : 1;
    const defaultFx: [number, number] = missingFront ? [-half * taper, half * taper] : baseFx;
    const defaultSz: [number, number] = missingSide ? [-half * taper, half * taper] : baseSz;
    fx = fx ?? defaultFx;
    sz = sz ?? defaultSz;
    ringExt.push({ y: rawY, fx, sz });
  }

  // Smooth centers, keep half-widths — kills the zigzag “middle line” in ortho views.
  const rawCx = ringExt.map((r) => (r.fx[0] + r.fx[1]) / 2);
  const rawCz = ringExt.map((r) => (r.sz[0] + r.sz[1]) / 2);
  // Extra passes when key-height rings sit on silhouette knuckles.
  const spineX = smoothSpine(rawCx, gameTopology ? 8 : 1);
  const spineZ = smoothSpine(rawCz, gameTopology ? 8 : 1);

  const topMinX = topPoints.length ? Math.min(...topPoints.map((point) => point.u)) : 0;
  const topMaxX = topPoints.length ? Math.max(...topPoints.map((point) => point.u)) : 0;
  const topMinZ = topPoints.length ? Math.min(...topPoints.map((point) => point.v)) : 0;
  const topMaxZ = topPoints.length ? Math.max(...topPoints.map((point) => point.v)) : 0;
  const topCenterX = (topMinX + topMaxX) / 2;
  const topCenterZ = (topMinZ + topMaxZ) / 2;
  const topRadiusX = Math.max((topMaxX - topMinX) / 2, 0.0001);
  const topRadiusZ = Math.max((topMaxZ - topMinZ) / 2, 0.0001);

  const topShapeAtAngle = (angle: number) => {
    if (topPoints.length < 3) return { x: Math.cos(angle), z: Math.sin(angle) };
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let bestT = Infinity;
    for (let index = 0; index < topPoints.length - 1; index++) {
      const a = topPoints[index];
      const b = topPoints[index + 1];
      const sx = b.u - a.u;
      const sz = b.v - a.v;
      const qx = a.u - topCenterX;
      const qz = a.v - topCenterZ;
      const cross = dx * sz - dz * sx;
      if (Math.abs(cross) < 1e-8) continue;
      const t = (qx * sz - qz * sx) / cross;
      const segmentT = (qx * dz - qz * dx) / cross;
      if (t >= 0 && segmentT >= 0 && segmentT <= 1) bestT = Math.min(bestT, t);
    }
    if (!Number.isFinite(bestT)) return { x: dx, z: dz };
    return {
      x: (dx * bestT) / topRadiusX,
      z: (dz * bestT) / topRadiusZ,
    };
  };

  const vertices: { x: number; y: number; z: number }[] = [];

  for (let row = 0; row <= rings; row++) {
    const { y: rawY, fx, sz } = ringExt[row];
    const rx = Math.max((fx[1] - fx[0]) / 2, tipFloor);
    const rz = Math.max((sz[1] - sz[0]) / 2, tipFloor);
    const cx = spineX[row];
    const cz = spineZ[row];
    // Re-center extents on the smoothed spine so vertical seams stay straight.
    const x0 = cx - rx;
    const x1 = cx + rx;
    const z0 = cz - rz;
    const z1 = cz + rz;

    if (topPoints.length >= 3) {
      for (let col = 0; col < sides; col++) {
        const angle = -Math.PI / 2 + (col / sides) * Math.PI * 2;
        const shape = topShapeAtAngle(angle);
        vertices.push({
          x: cx + shape.x * rx,
          y: rawY,
          z: cz + shape.z * rz,
        });
      }
    } else if (crossSection === 'ellipse' && roundness >= 0.999) {
      for (let col = 0; col < sides; col++) {
        const angle = -Math.PI / 2 + (col / sides) * Math.PI * 2;
        vertices.push({
          x: cx + Math.cos(angle) * rx,
          y: rawY,
          z: cz + Math.sin(angle) * rz,
        });
      }
    } else {
      vertices.push(
        ...crossSectionRing(
          x0,
          x1,
          z0,
          z1,
          rawY,
          sides,
          roundness,
          widthFractions,
          depthFractions
        )
      );
    }
  }

  return finishLoftWithPoles(vertices, rings, sides, activeMinY, activeMaxY, capStyle);
}

export function combineVectorMeshes(meshes: VectorMeshSnapshot[]): VectorMeshSnapshot {
  const combined: VectorMeshSnapshot = { vertices: [], edges: [], faces: [] };
  meshes.forEach((mesh) => {
    const offset = combined.vertices.length;
    combined.vertices.push(...mesh.vertices.map((v) => ({ ...v })));
    combined.edges.push(...mesh.edges.map(([a, b]) => [a + offset, b + offset] as [number, number]));
    combined.faces.push(...mesh.faces.map((face) => face.map((i) => i + offset)));
  });
  return combined;
}

function faceUVs(count: number): { u: number; v: number }[] {
  if (count === 4) {
    return [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ];
  }
  if (count === 3) {
    return [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 0.5, v: 1 },
    ];
  }
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { u: 0.5 + 0.5 * Math.cos(a), v: 0.5 + 0.5 * Math.sin(a) };
  });
}

/** Solid PNG data URL for an initial paintable / material texture. */
export function createSolidTextureDataUrl(color = '#d2b48c', size = 256): string {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      return canvas.toDataURL('image/png');
    }
  }
  // Node / tests without canvas — 1×1 opaque PNG (color is approximate).
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}

export function seedMeshSolidTexture(mesh: CADMesh, color = '#d2b48c', size = 256): CADMesh {
  return {
    ...mesh,
    textureCanvasDataUrl: createSolidTextureDataUrl(color, size),
    revision: (mesh.revision || 0) + 1,
  };
}

export type VectorCadConvertOptions = {
  /** When set, bake a solid texture so Mat / Paint / UV textured view work immediately. */
  seedTexture?: boolean | string;
};

/** Convert loft snapshot into a PolyStage CADMesh. */
export function vectorSnapshotToCADMesh(
  snapshot: VectorMeshSnapshot,
  name = 'Vector Blockout',
  options?: VectorCadConvertOptions
): CADMesh {
  const vertices: Vertex[] = snapshot.vertices.map((v) => ({
    id: generateId(),
    x: v.x,
    y: v.y,
    z: v.z,
  }));
  const faces: Face[] = snapshot.faces.map((idxs) => {
    const ids = idxs.map((i) => vertices[i].id);
    return {
      id: generateId(),
      vertexIds: ids,
      uvs: faceUVs(ids.length),
      color: '#d2b48c',
      materialId: 'mat_default',
    };
  });
  const mesh = finalizeEditableMesh({
    id: generateId(),
    name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
    visible: true,
    locked: false,
    revision: 1,
    doubleSided: true,
  });
  // Pivot at geometric center so object-mode gizmos sit on the mesh, not the floor.
  // Smart unwrap: planar project per face + pack atlas (paintable / UV-editor ready).
  let cad = smartUnwrapFaces(recenterMeshOrigin(mesh));
  if (options?.seedTexture) {
    const color = typeof options.seedTexture === 'string' ? options.seedTexture : '#d2b48c';
    cad = seedMeshSolidTexture(cad, color);
  }
  return cad;
}

/** Merge multiple CAD meshes into one (separate islands). */
export function combineCADMeshes(meshes: CADMesh[], name = 'Vector Blockout'): CADMesh {
  if (meshes.length === 1) {
    return { ...meshes[0], name, id: generateId(), revision: 0 };
  }
  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  const idMap = new Map<string, string>();

  meshes.forEach((mesh) => {
    mesh.vertices.forEach((v) => {
      const id = generateId();
      idMap.set(v.id, id);
      vertices.push({ ...v, id });
    });
    mesh.faces.forEach((face) => {
      faces.push({
        ...face,
        id: generateId(),
        vertexIds: face.vertexIds.map((vid) => idMap.get(vid) || vid),
        uvs: face.uvs.map((uv) => ({ ...uv })),
      });
    });
  });

  return finalizeEditableMesh({
    id: generateId(),
    name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    vertices,
    faces,
    edges: createEdgesFromFaces(faces),
    visible: true,
    locked: false,
    revision: 0,
  });
}

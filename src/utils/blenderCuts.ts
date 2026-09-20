/**
 * Blender-faithful Loop Cut & Knife helpers.
 *
 * Mirrors the documented behaviour of Blender's *Loop Cut and Slide* (Ctrl+R)
 * and *Knife* (K) tools, keeping the interaction math pure so it can be tested
 * without a viewport:
 *
 * Loop Cut and Slide is a two step interactive tool.
 *  1. Choose the face loop to cut: hover an edge the cut should pass through
 *     (perpendicular to the cutting direction). Blender previews the cut with a
 *     yellow line; LMB confirms, RMB aborts.
 *  2. Slide the new edge loop(s): the mouse moves the loop; LMB creates the cut
 *     at that position, RMB creates it at the center.
 * Number of Cuts: Wheel / PageUp / PageDown / typing a digit during step 1.
 * Even = E and Flipped = F during step 2; Clamp = C or hold Alt.
 *
 * The Knife tool places cut points on the mesh surface, with C for angle
 * constraint, Z for cut through (X-Ray), Shift for midpoint snapping and Ctrl to
 * ignore snapping.
 */
import type { CADMesh, Vector3D } from '../types/cad';
import { findEdgeLoop } from './meshCutTools';

/**
 * Blender 3D Viewport preview colours.
 *
 * `line` is the documented yellow cut preview; `crossedEdge` highlights the
 * edges the cut passes through the way Blender's viewport does.
 */
export const LOOP_CUT_COLORS = {
  line: 0xffee00,
  crossedEdge: 0xff2fd6,
} as const;

/** Blender-style knife overlay: bright line with marked cut points. */
export const KNIFE_COLORS = {
  line: 0x00e5ff,
  point: 0xff3b30,
} as const;

export interface LoopCutSettings {
  /** Blender "Number of Cuts". */
  count: number;
  /** Position of the cut group along the crossed edges (0 = start, 1 = end). */
  slide: number;
  /** Blender "Even": keep an even distance to the adjacent existing loop. */
  even: boolean;
  /** Blender "Flipped": keep the even distance to the other adjacent edge. */
  flipped: boolean;
  /** Blender "Clamp": keep the new loop(s) inside the face loop's boundaries. */
  clamp: boolean;
}

export const DEFAULT_LOOP_CUT_SETTINGS: LoopCutSettings = {
  count: 1,
  slide: 0.5,
  even: false,
  flipped: false,
  clamp: true,
};

export const LOOP_CUT_MIN_CUTS = 1;
export const LOOP_CUT_MAX_CUTS = 8;

/** Factors stay strictly inside the edge so no inverted quad can be produced. */
export const LOOP_CUT_MIN_FACTOR = 0.02;
export const LOOP_CUT_MAX_FACTOR = 0.98;

export function clampLoopCutCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(LOOP_CUT_MIN_CUTS, Math.min(LOOP_CUT_MAX_CUTS, Math.round(count)));
}

/** Wheel / PageUp / PageDown steps. */
export function adjustLoopCutCount(current: number, delta: number): number {
  return clampLoopCutCount(current + delta);
}

/**
 * Blender lets you "type a number" for the cuts during step 1, alongside
 * PageUp / PageDown. Returns the new count, or null when the key is not a
 * cut-count key.
 */
export function loopCutCountFromKey(key: string, current: number): number | null {
  if (key === 'PageUp') return adjustLoopCutCount(current, 1);
  if (key === 'PageDown') return adjustLoopCutCount(current, -1);
  if (/^[1-9]$/.test(key)) return clampLoopCutCount(Number(key));
  return null;
}

/**
 * Factors for the new loop(s) along every crossed edge.
 *
 * With Clamp on, the whole group of cuts is kept inside the boundary so the
 * spacing is preserved; with Clamp off the group may run past the ends and the
 * outer cuts squash against the boundary, which is Blender's "the new edge loop
 * can go outside the face loop's boundary edges".
 */
export function loopCutFactorsFor(settings: LoopCutSettings): number[] {
  const count = clampLoopCutCount(settings.count);
  const step = 1 / (count + 1);
  const rawSlide = settings.flipped ? 1 - settings.slide : settings.slide;
  const half = ((count - 1) / 2) * step;

  let slide = rawSlide;
  if (settings.clamp) {
    slide = Math.max(LOOP_CUT_MIN_FACTOR + half, Math.min(LOOP_CUT_MAX_FACTOR - half, slide));
  }
  if (settings.even) slide = Math.round(slide / step) * step;

  const factors: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = slide + (i - (count - 1) / 2) * step;
    factors.push(Math.max(LOOP_CUT_MIN_FACTOR, Math.min(LOOP_CUT_MAX_FACTOR, t)));
  }
  return factors;
}

/**
 * Slide position along an edge from the pointer ray.
 *
 * Blender slides the loop by projecting the cursor onto the crossed edge, which
 * is why the loop follows the mouse across the surface instead of the screen.
 * Falls back to the middle when the ray is parallel to the edge.
 */
export function loopCutSlideFromRay(
  edgeA: Vector3D,
  edgeB: Vector3D,
  rayOrigin: Vector3D,
  rayDirection: Vector3D,
  clamp = true,
): number {
  const ax = edgeB.x - edgeA.x;
  const ay = edgeB.y - edgeA.y;
  const az = edgeB.z - edgeA.z;
  const len2 = ax * ax + ay * ay + az * az;
  if (len2 < 1e-12) return 0.5;

  // Closest point between the edge line and the pointer ray.
  const wx = edgeA.x - rayOrigin.x;
  const wy = edgeA.y - rayOrigin.y;
  const wz = edgeA.z - rayOrigin.z;
  const b = ax * rayDirection.x + ay * rayDirection.y + az * rayDirection.z;
  const c = rayDirection.x * rayDirection.x
    + rayDirection.y * rayDirection.y
    + rayDirection.z * rayDirection.z;
  const d = ax * wx + ay * wy + az * wz;
  const e = rayDirection.x * wx + rayDirection.y * wy + rayDirection.z * wz;
  const denom = len2 * c - b * b;

  // Degenerate ray/edge configuration: nearest point of the edge to the ray head.
  const t = Math.abs(denom) < 1e-12 ? -d / len2 : (b * e - c * d) / denom;
  if (!Number.isFinite(t)) return 0.5;
  return clamp ? Math.max(LOOP_CUT_MIN_FACTOR, Math.min(LOOP_CUT_MAX_FACTOR, t)) : t;
}

/** The ring of parallel edges a loop cut will split (Blender's edge loop walk). */
export function loopCutCrossedEdgeIds(mesh: CADMesh, hoveredEdgeId: string): string[] {
  return findEdgeLoop(mesh, hoveredEdgeId);
}

/**
 * Blender shows the loop as a straight line through the crossed edges, so the
 * preview for multiple cuts is one polyline per cut.
 */
export function loopCutPreviewFactors(settings: LoopCutSettings): number[] {
  return loopCutFactorsFor(settings);
}

// ————————————————————————————————————————————————————————————
// Knife
// ————————————————————————————————————————————————————————————

/** Blender's knife angle constraint increments (C cycles 30 / 45 / 90). */
export const KNIFE_ANGLE_INCREMENTS = [45, 30, 90] as const;

/** C cycles the angle constraint: off -> 45 -> 30 -> 90 -> off. */
export function cycleKnifeAngleConstraint(current: number): number {
  if (!current) return KNIFE_ANGLE_INCREMENTS[0];
  const index = KNIFE_ANGLE_INCREMENTS.indexOf(
    current as (typeof KNIFE_ANGLE_INCREMENTS)[number],
  );
  if (index < 0) return KNIFE_ANGLE_INCREMENTS[0];
  return index === KNIFE_ANGLE_INCREMENTS.length - 1 ? 0 : KNIFE_ANGLE_INCREMENTS[index + 1];
}

/**
 * Snap a screen-space cut direction to the angle constraint, the way Blender's
 * knife constrains the cut line while you drag the cursor.
 */
export function snapScreenAngle(
  dx: number,
  dy: number,
  incrementDeg: number,
): { dx: number; dy: number } {
  if (!incrementDeg || incrementDeg <= 0) return { dx, dy };
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { dx, dy };
  const step = (incrementDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { dx: Math.cos(angle) * length, dy: Math.sin(angle) * length };
}

/** Default proximity (in edge parameter) at which the knife snaps to a vertex. */
export const KNIFE_VERTEX_SNAP_T = 0.12;

/**
 * Final cut parameter on the hit edge.
 *
 * Ctrl ignores snapping entirely, Shift snaps to the edge midpoint, and a point
 * close to either end snaps onto that vertex, matching Blender's knife.
 */
export function knifeSnapT(
  t: number,
  options: { ignoreSnapping?: boolean; midpoint?: boolean; vertexThreshold?: number } = {},
): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
  if (options.ignoreSnapping) return clamped;
  if (options.midpoint) return 0.5;
  const threshold = options.vertexThreshold ?? KNIFE_VERTEX_SNAP_T;
  if (clamped <= threshold) return 0;
  if (clamped >= 1 - threshold) return 1;
  return clamped;
}

/** E starts a new cut: current points are dropped, the tool stays active. */
export function knifeStartNewCut(): [] {
  return [];
}

/** Blender's knife status text while the tool is active. */
export function knifeStatusText(options: {
  points: number;
  angleConstraint: number;
  cutThrough: boolean;
  midpointSnap: boolean;
  ignoreSnapping: boolean;
}): string {
  const parts = [`${options.points} point${options.points === 1 ? '' : 's'}`];
  if (options.angleConstraint) parts.push(`Angle ${options.angleConstraint}°`);
  if (options.cutThrough) parts.push('Cut Through');
  if (options.midpointSnap) parts.push('Midpoint Snap');
  if (options.ignoreSnapping) parts.push('No Snap');
  return `KNIFE · click to cut · Enter/double-click to finish · Esc to cancel · ${parts.join(' · ')}`;
}
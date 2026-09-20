import type { CADMesh, Edge, Face, Vector3D, Vertex } from '../types/cad';
import { generateId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';

export type DoodleMode = 'sharp' | 'soft' | 'open';
export type DoodlePlane = 'free3d' | 'xy' | 'xz' | 'yz' | 'workplane' | 'camera' | 'surface';
export type SpatialDepthMode = 'auto' | 'surfaceAware' | 'pressure';
export type DoodleTopologyPreset = 'low' | 'mid' | 'custom';
export type OpenDoodleOutput =
  | 'edgeChain'
  | 'tube'
  | 'ribbon'
  | 'beveledCurve'
  | 'surfaceStrip'
  | 'extrusionPath'
  | 'meshStroke';
export type DoodleCapStyle = 'flat' | 'round' | 'none';
export type DoodleProfile = 'round' | 'square' | 'diamond' | 'flat';

export interface DoodleSettings {
  mode: DoodleMode;
  plane: DoodlePlane;
  openOutput: OpenDoodleOutput;
  depth: number;
  width: number;
  thickness: number;
  bevel: number;
  roundness: number;
  smoothing: number;
  resolution: number;
  topologyPreset: DoodleTopologyPreset;
  /** Custom-mode world-space simplification tolerance. */
  simplifyTolerance: number;
  capStyle: DoodleCapStyle;
  capEnds: boolean;
  profile: DoodleProfile;
  fillMode: 'ngon' | 'triangles';
  gridSnap: boolean;
  surfaceSnap: boolean;
  vertexSnap: boolean;
  edgeSnap: boolean;
  autoWeld: boolean;
  weldDistance: number;
  symmetry: boolean;
  mirrorAxis: 'x' | 'y' | 'z';
  generateUvs: boolean;
  previewOpacity: number;
  spatialDepthMode: SpatialDepthMode;
  /** Initial camera-distance offset for unconstrained strokes. */
  spatialDepthBias: number;
  /** How strongly stylus pressure moves a Free 3D stroke toward or away from the camera. */
  pressureDepth: number;
  materialId?: string;
}

export interface DoodleSession {
  settings: DoodleSettings;
  points: Vector3D[];
  drawing: boolean;
  closed: boolean;
  warning: string | null;
}

export interface DoodleBuildResult {
  mesh: CADMesh | null;
  warning: string | null;
  outlineVertexIds: string[];
}

export const DEFAULT_DOODLE_SETTINGS: DoodleSettings = {
  mode: 'sharp',
  plane: 'xz',
  openOutput: 'tube',
  depth: 0.8,
  width: 0.2,
  thickness: 0.2,
  bevel: 0.08,
  roundness: 0.45,
  smoothing: 0.55,
  resolution: 8,
  topologyPreset: 'mid',
  simplifyTolerance: 0.025,
  capStyle: 'flat',
  capEnds: true,
  profile: 'round',
  fillMode: 'ngon',
  gridSnap: true,
  surfaceSnap: false,
  vertexSnap: true,
  edgeSnap: true,
  autoWeld: true,
  weldDistance: 0.04,
  symmetry: false,
  mirrorAxis: 'x',
  generateUvs: true,
  previewOpacity: 0.32,
  spatialDepthMode: 'auto',
  spatialDepthBias: 0,
  pressureDepth: 1.25,
};

const add = (a: Vector3D, b: Vector3D): Vector3D => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vector3D, b: Vector3D): Vector3D => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v: Vector3D, s: number): Vector3D => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dot = (a: Vector3D, b: Vector3D) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3D, b: Vector3D): Vector3D => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (v: Vector3D) => Math.hypot(v.x, v.y, v.z);
const normalize = (v: Vector3D): Vector3D => {
  const d = length(v) || 1;
  return scale(v, 1 / d);
};
const distance = (a: Vector3D, b: Vector3D) => length(sub(a, b));
const lerp = (a: Vector3D, b: Vector3D, t: number): Vector3D => add(scale(a, 1 - t), scale(b, t));

export function doodlePlaneNormal(plane: DoodlePlane): Vector3D {
  if (plane === 'xy') return { x: 0, y: 0, z: 1 };
  if (plane === 'yz') return { x: 1, y: 0, z: 0 };
  return { x: 0, y: 1, z: 0 };
}

export function createDoodleSession(settings: DoodleSettings = DEFAULT_DOODLE_SETTINGS): DoodleSession {
  return { settings: { ...settings }, points: [], drawing: false, closed: false, warning: null };
}

export function appendDoodlePoint(session: DoodleSession, point: Vector3D): DoodleSession {
  const last = session.points.at(-1);
  const minimum = Math.max(0.006, session.settings.weldDistance * 0.35);
  if (last && distance(last, point) < minimum) return session;
  const points = [...session.points, { ...point }];
  const canClose = session.settings.mode !== 'open' && points.length > 3;
  const closed = canClose && distance(points[0], point) <= Math.max(session.settings.weldDistance * 2, minimum * 2);
  if (closed) points[points.length - 1] = { ...points[0] };
  return { ...session, points, drawing: !closed, closed, warning: null };
}

export function finishDoodleStroke(session: DoodleSession): DoodleSession {
  const closed = session.settings.mode !== 'open' && session.points.length >= 3;
  return { ...session, drawing: false, closed, warning: null };
}

function cleanPoints(input: Vector3D[], closed: boolean, weldDistance: number): Vector3D[] {
  const points: Vector3D[] = [];
  input.forEach((point) => {
    if (!points.length || distance(points.at(-1)!, point) > Math.max(1e-5, weldDistance)) points.push({ ...point });
  });
  if (closed && points.length > 1 && distance(points[0], points.at(-1)!) <= Math.max(1e-5, weldDistance * 2)) points.pop();
  return points;
}

function pointSegmentDistance(point: Vector3D, a: Vector3D, b: Vector3D): number {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  if (lengthSquared < 1e-12) return distance(point, a);
  const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / lengthSquared));
  return distance(point, add(a, scale(ab, t)));
}

function simplifyOpenPolyline(points: Vector3D[], tolerance: number): Vector3D[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((point) => ({ ...point }));
  let farthest = 0;
  let farthestIndex = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegmentDistance(points[i], points[0], points.at(-1)!);
    if (d > farthest) { farthest = d; farthestIndex = i; }
  }
  if (farthest <= tolerance || farthestIndex < 0) return [{ ...points[0] }, { ...points.at(-1)! }];
  const left = simplifyOpenPolyline(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyOpenPolyline(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function strokeExtent(points: Vector3D[]): number {
  if (!points.length) return 0;
  const min = { ...points[0] };
  const max = { ...points[0] };
  points.forEach((point) => {
    min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); max.z = Math.max(max.z, point.z);
  });
  return distance(min, max);
}

export function resolveDoodleTopology(settings: DoodleSettings): { profileSegments: number; toleranceRatio: number; label: string } {
  if (settings.topologyPreset === 'low') return { profileSegments: 6, toleranceRatio: 0.035, label: 'Low Poly' };
  if (settings.topologyPreset === 'mid') return { profileSegments: 10, toleranceRatio: 0.012, label: 'Mid Poly' };
  return { profileSegments: Math.max(3, Math.min(24, Math.round(settings.resolution))), toleranceRatio: 0, label: 'Custom' };
}

function simplifyDoodlePoints(points: Vector3D[], closed: boolean, settings: DoodleSettings): Vector3D[] {
  if (points.length < 3) return points;
  const topology = resolveDoodleTopology(settings);
  const tolerance = settings.topologyPreset === 'custom'
    ? Math.max(0, settings.simplifyTolerance)
    : strokeExtent(points) * topology.toleranceRatio;
  if (tolerance <= 0) return points;
  if (!closed) return simplifyOpenPolyline(points, tolerance);
  const loop = simplifyOpenPolyline([...points, points[0]], tolerance);
  if (loop.length > 1 && distance(loop[0], loop.at(-1)!) < 1e-7) loop.pop();
  return loop.length >= 3 ? loop : points;
}

function basisFromNormal(normal: Vector3D): { u: Vector3D; v: Vector3D } {
  const helper = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(helper, normal));
  return { u, v: normalize(cross(normal, u)) };
}

function point2(point: Vector3D, origin: Vector3D, u: Vector3D, v: Vector3D): [number, number] {
  const p = sub(point, origin);
  return [dot(p, u), dot(p, v)];
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -1e-8 && o3 * o4 < -1e-8;
}

export function validateDoodleOutline(points: Vector3D[], closed: boolean, normal: Vector3D): string | null {
  if (points.length < (closed ? 3 : 2)) return closed ? 'Draw at least three distinct points.' : 'Draw at least two distinct points.';
  const origin = points[0];
  const maxPlaneError = points.reduce((max, p) => Math.max(max, Math.abs(dot(sub(p, origin), normal))), 0);
  if (closed && maxPlaneError > 0.025) return 'The outline is non-planar. Use surface projection or a fixed drawing plane.';
  if (!closed) return null;
  const { u, v } = basisFromNormal(normal);
  const flat = points.map((point) => point2(point, origin, u, v));
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i];
    const b = flat[(i + 1) % flat.length];
    for (let j = i + 1; j < flat.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === flat.length - 1)) continue;
      const c = flat[j];
      const d = flat[(j + 1) % flat.length];
      if (segmentsIntersect(a, b, c, d)) return 'The outline crosses itself. Adjust the stroke before confirming.';
    }
  }
  const signedArea = flat.reduce((area, point, index) => {
    const next = flat[(index + 1) % flat.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) * 0.5;
  if (Math.abs(signedArea) < 1e-5) return 'The outline has no usable area. Draw a wider closed shape.';
  return null;
}

function chaikin(points: Vector3D[], amount: number, passes: number): Vector3D[] {
  let current = points;
  const t = Math.min(0.24, Math.max(0, amount) * 0.24);
  for (let pass = 0; pass < passes; pass++) {
    const next: Vector3D[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push(lerp(a, b, t), lerp(a, b, 1 - t));
    }
    current = next;
  }
  return current;
}

function face(idList: string[], materialId?: string, flip = false): Face {
  const ids = flip ? [...idList].reverse() : idList;
  return {
    id: generateId(),
    vertexIds: ids,
    uvs: ids.map((_, i) => ({ u: ids.length <= 1 ? 0 : i / (ids.length - 1), v: flip ? 0 : 1 })),
    materialId,
  };
}

function triangulatedCap(ids: string[], materialId: string | undefined, flip: boolean): Face[] {
  if (ids.length < 3) return [];
  const source = flip ? [...ids].reverse() : ids;
  const faces: Face[] = [];
  for (let i = 1; i < source.length - 1; i++) faces.push(face([source[0], source[i], source[i + 1]], materialId));
  return faces;
}

function closedMesh(points: Vector3D[], settings: DoodleSettings, normal: Vector3D): DoodleBuildResult {
  const outline = settings.mode === 'soft'
    ? chaikin(points, settings.roundness, Math.max(1, Math.min(2, Math.round(resolveDoodleTopology(settings).profileSegments / 8))))
    : points;
  const vertices: Vertex[] = [];
  const centroid = scale(outline.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 }), 1 / outline.length);
  const absDepth = Math.abs(settings.depth);
  const bevelDepth = settings.mode === 'soft' ? Math.min(absDepth * 0.45, Math.max(0, settings.bevel)) : 0;
  const bevelSign = Math.sign(settings.depth) || 1;
  const meanRadius = outline.reduce((sum, point) => sum + distance(point, centroid), 0) / outline.length;
  const insetFactor = meanRadius > 1e-6 ? Math.min(0.45, bevelDepth / meanRadius) : 0;
  const ringSpecs = settings.mode === 'soft' && bevelDepth > 1e-5
    ? [
        { offset: 0, inset: insetFactor },
        { offset: bevelDepth * bevelSign, inset: 0 },
        { offset: settings.depth - bevelDepth * bevelSign, inset: 0 },
        { offset: settings.depth, inset: insetFactor },
      ]
    : [{ offset: 0, inset: 0 }, { offset: settings.depth, inset: 0 }];
  const rings = ringSpecs.map((spec) => outline.map((point) => {
    const id = generateId();
    const insetPoint = lerp(point, centroid, spec.inset);
    vertices.push({ id, ...add(insetPoint, scale(normal, spec.offset)) });
    return id;
  }));
  const lowerIds = rings[0];
  const upperIds = rings.at(-1)!;
  const faces: Face[] = [];
  if (settings.fillMode === 'triangles') {
    faces.push(...triangulatedCap(lowerIds, settings.materialId, true));
    faces.push(...triangulatedCap(upperIds, settings.materialId, false));
  } else {
    faces.push(face(lowerIds, settings.materialId, true), face(upperIds, settings.materialId));
  }
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      faces.push(face([rings[ringIndex][i], rings[ringIndex][next], rings[ringIndex + 1][next], rings[ringIndex + 1][i]], settings.materialId));
    }
  }
  const mesh = finalizeEditableMesh({
    id: generateId(), name: settings.mode === 'soft' ? 'Soft Doodle' : 'Sharp Doodle',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    vertices, faces, visible: true,
  });
  if (settings.mode === 'sharp') mesh.edges = mesh.edges.map((edge) => ({ ...edge, sharp: true }));
  if (settings.mode === 'soft') {
    mesh.modifiers = [{ id: generateId(), type: 'subdivision', enabled: true, levels: settings.smoothing > 0.66 ? 2 : 1, algorithm: 'catmullClark' }];
  }
  return { mesh, warning: null, outlineVertexIds: rings[Math.min(1, rings.length - 1)] };
}

function openEdgeMesh(points: Vector3D[], settings: DoodleSettings): DoodleBuildResult {
  const vertices = points.map((point) => ({ id: generateId(), ...point }));
  const edges: Edge[] = vertices.slice(0, -1).map((vertex, i) => ({ id: generateId(), v1Id: vertex.id, v2Id: vertices[i + 1].id }));
  return {
    mesh: {
      id: generateId(), name: settings.openOutput === 'extrusionPath' ? 'Doodle Extrusion Path' : 'Doodle Edge Chain',
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      vertices, edges, faces: [], visible: true, revision: 1,
    },
    warning: null,
    outlineVertexIds: vertices.map((vertex) => vertex.id),
  };
}

function smoothedOpenPoints(points: Vector3D[], settings: DoodleSettings): Vector3D[] {
  if (settings.smoothing <= 0.02 || points.length < 3) return points;
  let current = points;
  const passes = Math.max(1, Math.min(2, Math.round(settings.smoothing * 2)));
  const t = Math.min(0.22, settings.smoothing * 0.22);
  for (let pass = 0; pass < passes; pass++) {
    const next: Vector3D[] = [{ ...current[0] }];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(lerp(current[i], current[i + 1], t), lerp(current[i], current[i + 1], 1 - t));
    }
    next.push({ ...current.at(-1)! });
    current = next;
  }
  return current;
}

function transportedSides(points: Vector3D[], preferredUp: Vector3D): Vector3D[] {
  const sides: Vector3D[] = [];
  let previous: Vector3D | null = null;
  points.forEach((_, index) => {
    const tangent = normalize(sub(points[Math.min(points.length - 1, index + 1)], points[Math.max(0, index - 1)]));
    let side = previous ? sub(previous, scale(tangent, dot(previous, tangent))) : cross(preferredUp, tangent);
    if (length(side) < 1e-4) side = basisFromNormal(tangent).u;
    side = normalize(side);
    if (previous && dot(side, previous) < 0) side = scale(side, -1);
    sides.push(side);
    previous = side;
  });
  return sides;
}

function ribbonMesh(inputPoints: Vector3D[], settings: DoodleSettings, normal: Vector3D): DoodleBuildResult {
  const points = smoothedOpenPoints(inputPoints, settings);
  const half = Math.max(0.005, settings.width * 0.5);
  const vertices: Vertex[] = [];
  const left: string[] = [];
  const right: string[] = [];
  const sides = transportedSides(points, normal);
  points.forEach((point, i) => {
    const side = sides[i];
    const l = generateId(); const r = generateId();
    left.push(l); right.push(r);
    vertices.push({ id: l, ...add(point, scale(side, half)) }, { id: r, ...add(point, scale(side, -half)) });
  });
  const faces: Face[] = [];
  for (let i = 0; i < points.length - 1; i++) faces.push(face([left[i], right[i], right[i + 1], left[i + 1]], settings.materialId));
  const mesh = finalizeEditableMesh({
    id: generateId(), name: settings.openOutput === 'surfaceStrip' ? 'Doodle Surface Strip' : 'Doodle Ribbon',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, vertices, faces, visible: true, doubleSided: true,
  });
  return { mesh, warning: null, outlineVertexIds: [...left, ...right] };
}

function tubeMesh(inputPoints: Vector3D[], settings: DoodleSettings, normal: Vector3D): DoodleBuildResult {
  const points = smoothedOpenPoints(inputPoints, settings);
  const segments = settings.profile === 'square' || settings.profile === 'diamond' ? 4 : Math.min(16, resolveDoodleTopology(settings).profileSegments);
  const radius = Math.max(0.005, settings.thickness * 0.5);
  const vertices: Vertex[] = [];
  const rings: string[][] = [];
  const sides = transportedSides(points, normal);
  const tangents = points.map((_, index) => normalize(sub(points[Math.min(points.length - 1, index + 1)], points[Math.max(0, index - 1)])));
  points.forEach((point, index) => {
    const tangent = tangents[index];
    const axisA = sides[index];
    const axisB = normalize(cross(tangent, axisA));
    const ring: string[] = [];
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2 + (settings.profile === 'diamond' ? Math.PI / 4 : 0);
      const id = generateId();
      ring.push(id);
      const offset = add(scale(axisA, Math.cos(angle) * radius), scale(axisB, Math.sin(angle) * radius));
      vertices.push({ id, ...add(point, offset) });
    }
    rings.push(ring);
  });
  const faces: Face[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const next = (j + 1) % segments;
      faces.push(face([rings[i][j], rings[i][next], rings[i + 1][next], rings[i + 1][j]], settings.materialId));
    }
  }
  if (settings.capEnds && settings.capStyle === 'flat') {
    faces.push(face(rings[0], settings.materialId, true), face(rings.at(-1)!, settings.materialId));
  } else if (settings.capEnds && settings.capStyle === 'round') {
    const addRoundCap = (pointIndex: number, direction: number) => {
      const point = points[pointIndex];
      const tangent = tangents[pointIndex];
      const axisA = sides[pointIndex];
      const axisB = normalize(cross(tangent, axisA));
      const baseRing = rings[pointIndex];
      const midCenter = add(point, scale(tangent, radius * 0.62 * direction));
      const midRing: string[] = [];
      for (let j = 0; j < segments; j++) {
        const angle = (j / segments) * Math.PI * 2 + (settings.profile === 'diamond' ? Math.PI / 4 : 0);
        const id = generateId();
        midRing.push(id);
        const offset = add(scale(axisA, Math.cos(angle) * radius * 0.72), scale(axisB, Math.sin(angle) * radius * 0.72));
        vertices.push({ id, ...add(midCenter, offset) });
      }
      const tipId = generateId();
      vertices.push({ id: tipId, ...add(point, scale(tangent, radius * direction)) });
      for (let j = 0; j < segments; j++) {
        const next = (j + 1) % segments;
        if (direction < 0) {
          faces.push(face([baseRing[next], baseRing[j], midRing[j], midRing[next]], settings.materialId));
          faces.push(face([midRing[next], midRing[j], tipId], settings.materialId));
        } else {
          faces.push(face([baseRing[j], baseRing[next], midRing[next], midRing[j]], settings.materialId));
          faces.push(face([midRing[j], midRing[next], tipId], settings.materialId));
        }
      }
    };
    addRoundCap(0, -1);
    addRoundCap(points.length - 1, 1);
  }
  const mesh = finalizeEditableMesh({
    id: generateId(), name: settings.openOutput === 'meshStroke' ? 'Doodle Mesh Stroke' : 'Doodle Tube',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, vertices, faces, visible: true,
  });
  return { mesh, warning: null, outlineVertexIds: rings.flat() };
}

export function buildDoodleMesh(session: DoodleSession, normal = doodlePlaneNormal(session.settings.plane)): DoodleBuildResult {
  const closed = session.settings.mode !== 'open' && session.closed;
  const cleaned = cleanPoints(session.points, closed, session.settings.autoWeld ? session.settings.weldDistance : 1e-6);
  const warning = validateDoodleOutline(cleaned, closed, normal);
  if (warning) return { mesh: null, warning, outlineVertexIds: [] };
  const points = simplifyDoodlePoints(cleaned, closed, session.settings);
  const simplifiedWarning = validateDoodleOutline(points, closed, normal);
  if (simplifiedWarning) return { mesh: null, warning: simplifiedWarning, outlineVertexIds: [] };
  if (closed) return closedMesh(points, session.settings, normal);
  if (session.settings.openOutput === 'edgeChain' || session.settings.openOutput === 'extrusionPath') return openEdgeMesh(points, session.settings);
  if (session.settings.openOutput === 'ribbon' || session.settings.openOutput === 'surfaceStrip' || session.settings.profile === 'flat') return ribbonMesh(points, session.settings, normal);
  return tubeMesh(points, session.settings, normal);
}

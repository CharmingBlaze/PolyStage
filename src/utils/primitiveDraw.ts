/**
 * Shared view-aware primitive creation.
 *
 * Every primitive is drawn inside one bounding box. The ghost preview and the
 * finalized mesh use the same dimensions, origin, construction plane, and
 * orientation — only the topology inside the box changes with type.
 */
import * as THREE from 'three';
import type { CADMesh, PrimitiveType, Vector3D, Vertex } from '../types/cad';
import { generatePrimitive } from './meshUtils';
import { formatLength } from './units';

export type DrawViewKind = 'perspective' | 'top' | 'front' | 'side';
export type DrawPhase = 'idle' | 'base' | 'height';
export type SnapKind = 'none' | 'grid' | 'vertex' | 'edge' | 'face' | 'surface';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ConstructionPlane {
  origin: Vec3;
  /** Width axis (local X). */
  u: Vec3;
  /** Depth axis (local Z). */
  v: Vec3;
  /** Height axis / plane normal (local Y). */
  n: Vec3;
}

export interface SnapResult {
  kind: SnapKind;
  point: Vec3;
}

export interface SnapCandidate {
  kind: Exclude<SnapKind, 'none' | 'grid'>;
  point: Vec3;
  a?: Vec3;
  b?: Vec3;
}

export interface PrimitiveDrawSession {
  primitiveType: PrimitiveType;
  viewKind: DrawViewKind;
  plane: ConstructionPlane;
  planeLocked: boolean;
  phase: DrawPhase;
  startPoint: Vec3;
  currentPoint: Vec3;
  /** Signed height along plane.n. Flat primitives keep this near 0. */
  height: number;
  snap: SnapResult;
  isFlat: boolean;
  gridSnap: number;
  /** True while Shift is held (grid snap). */
  shiftSnap: boolean;
}

export interface DrawBoundingBox {
  center: Vec3;
  size: Vec3;
  rotation: Vec3;
  corners: Vec3[];
  /** 12 line pairs of world corners for the outline. */
  edges: Array<[Vec3, Vec3]>;
  /** Base rectangle on the construction plane (4 corners, CCW). */
  baseCorners: Vec3[];
}

export interface CreationPreview {
  primitiveType: PrimitiveType;
  viewKind: DrawViewKind;
  plane: ConstructionPlane;
  startPoint: Vec3;
  currentPoint: Vec3;
  boundingBox: DrawBoundingBox;
  dimensions: Vec3;
  orientation: Vec3;
  snap: SnapResult;
  phase: DrawPhase;
  isFlat: boolean;
  constrained: boolean;
}

export const MIN_DRAW_SIZE = 0.05;
export const FLAT_THICKNESS = 0.001;
const SNAP_PIXELS = 14;

export function isFlatPrimitive(type: PrimitiveType | null | undefined): boolean {
  return type === 'plane' || type === 'circle' || type === 'ring';
}

export function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vecLen(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function vecNorm(a: Vec3): Vec3 {
  const l = vecLen(a);
  return l > 1e-12 ? vecScale(a, 1 / l) : vec(0, 1, 0);
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vecClone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function toThree(a: Vec3): THREE.Vector3 {
  return new THREE.Vector3(a.x, a.y, a.z);
}

export function fromThree(a: THREE.Vector3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

/** Right-handed plane: local X = u, local Y = n, local Z = v = u × n. */
export function makeConstructionPlane(origin: Vec3, normal: Vec3, hintU?: Vec3): ConstructionPlane {
  const n = vecNorm(normal);
  const upHint = Math.abs(n.y) < 0.92 ? vec(0, 1, 0) : vec(1, 0, 0);
  let u = vecNorm(vecCross(upHint, n));
  if (vecLen(u) < 1e-8) u = vecNorm(vecCross(vec(0, 0, 1), n));
  if (hintU) {
    const projected = vecSub(hintU, vecScale(n, vecDot(hintU, n)));
    if (vecLen(projected) > 1e-8) u = vecNorm(projected);
  }
  let v = vecNorm(vecCross(u, n));
  if (Math.abs(n.y) < 0.92 && v.y < 0) {
    u = vecScale(u, -1);
    v = vecScale(v, -1);
  }
  return { origin: vecClone(origin), u, v, n };
}

export function constructionPlaneForView(viewKind: DrawViewKind, origin: Vec3 = vec()): ConstructionPlane {
  switch (viewKind) {
    case 'front':
      // XY wall, height into the scene (−Z) so u×n = v = +Y.
      return { origin: vecClone(origin), u: vec(1, 0, 0), v: vec(0, 1, 0), n: vec(0, 0, -1) };
    case 'side':
      // ZY wall, height along +X, v = +Y.
      return { origin: vecClone(origin), u: vec(0, 0, 1), v: vec(0, 1, 0), n: vec(1, 0, 0) };
    case 'top':
    case 'perspective':
    default:
      return { origin: vecClone(origin), u: vec(1, 0, 0), v: vec(0, 0, 1), n: vec(0, 1, 0) };
  }
}

export function projectToPlane(point: Vec3, plane: ConstructionPlane): Vec3 {
  const d = vecSub(point, plane.origin);
  return vecSub(point, vecScale(plane.n, vecDot(d, plane.n)));
}

export function planeCoords(point: Vec3, plane: ConstructionPlane): { u: number; v: number } {
  const d = vecSub(point, plane.origin);
  return { u: vecDot(d, plane.u), v: vecDot(d, plane.v) };
}

export function planePoint(plane: ConstructionPlane, u: number, v: number, h = 0): Vec3 {
  return vecAdd(vecAdd(vecAdd(plane.origin, vecScale(plane.u, u)), vecScale(plane.v, v)), vecScale(plane.n, h));
}

export function intersectRayPlane(
  rayOrigin: Vec3,
  rayDir: Vec3,
  plane: ConstructionPlane,
): Vec3 | null {
  const denom = vecDot(rayDir, plane.n);
  if (Math.abs(denom) < 1e-10) return null;
  const t = vecDot(vecSub(plane.origin, rayOrigin), plane.n) / denom;
  if (!Number.isFinite(t) || t < -1e-4) return null;
  return vecAdd(rayOrigin, vecScale(rayDir, t));
}

/**
 * Work plane for a primitive click: the current view, or a mesh face under the
 * cursor. A locked session plane wins when the ray can hit it (CAD base/height).
 */
export function resolvePrimitiveWorkPlane(opts: {
  view: DrawViewKind;
  rayOrigin: Vec3;
  rayDir: Vec3;
  surface?: { point: Vec3; normal: Vec3 } | null;
  lockedPlane?: ConstructionPlane | null;
}): { plane: ConstructionPlane; hit: Vec3; surface: boolean } | null {
  if (opts.lockedPlane) {
    const hit = intersectRayPlane(opts.rayOrigin, opts.rayDir, opts.lockedPlane);
    if (!hit) return null;
    return { plane: opts.lockedPlane, hit, surface: false };
  }
  let plane = constructionPlaneForView(opts.view);
  let surface = false;
  if (opts.surface) {
    plane = makeConstructionPlane(opts.surface.point, opts.surface.normal);
    surface = true;
  }
  const hit = intersectRayPlane(opts.rayOrigin, opts.rayDir, plane);
  if (!hit) return null;
  return { plane: { ...plane, origin: vecClone(hit) }, hit, surface };
}

export function worldUnitsPerPixel(opts: {
  ortho: boolean;
  orthoSpan: number;
  fovDeg: number;
  distance: number;
  viewH: number;
}): number {
  const h = Math.max(1, opts.viewH);
  if (opts.ortho) return Math.max(1e-8, opts.orthoSpan / h);
  const fov = (opts.fovDeg * Math.PI) / 180;
  return Math.max(1e-8, (2 * Math.max(0.01, opts.distance) * Math.tan(fov / 2)) / h);
}

export function snapScalar(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = vecSub(b, a);
  const len2 = vecDot(ab, ab);
  if (len2 < 1e-16) return vecClone(a);
  const t = Math.max(0, Math.min(1, vecDot(vecSub(p, a), ab) / len2));
  return vecAdd(a, vecScale(ab, t));
}

/**
 * Snap a world point: Shift (or an enabled grid step) snaps on the plane;
 * nearby mesh vertices / edges / faces win when closer than the pixel threshold.
 */
export function snapDrawPoint(opts: {
  point: Vec3;
  plane: ConstructionPlane;
  gridStep: number;
  shiftSnap: boolean;
  candidates?: SnapCandidate[];
  camera?: THREE.Camera;
  viewW?: number;
  viewH?: number;
}): SnapResult {
  let point = projectToPlane(opts.point, opts.plane);
  let kind: SnapKind = 'none';

  const step = opts.shiftSnap ? (opts.gridStep > 0 ? opts.gridStep : 0.25) : 0;
  if (step > 0) {
    const uv = planeCoords(point, opts.plane);
    point = planePoint(opts.plane, snapScalar(uv.u, step), snapScalar(uv.v, step), 0);
    kind = 'grid';
  }

  const candidates = opts.candidates;
  if (candidates?.length && opts.camera && opts.viewW && opts.viewH) {
    const cam = opts.camera;
    const w = opts.viewW;
    const h = opts.viewH;
    const target = toThree(point).project(cam);
    const tx = ((target.x + 1) * 0.5) * w;
    const ty = ((1 - target.y) * 0.5) * h;
    let bestDist = SNAP_PIXELS;
    let best: SnapResult | null = null;

    for (const c of candidates) {
      const sample =
        c.kind === 'edge' && c.a && c.b ? closestOnSegment(point, c.a, c.b) : c.point;
      const ndc = toThree(sample).project(cam);
      if (ndc.z > 1) continue;
      const sx = ((ndc.x + 1) * 0.5) * w;
      const sy = ((1 - ndc.y) * 0.5) * h;
      const dist = Math.hypot(sx - tx, sy - ty);
      if (dist < bestDist) {
        bestDist = dist;
        best = { kind: c.kind, point: projectToPlane(sample, opts.plane) };
      }
    }
    if (best) return best;
  }

  return { kind, point };
}

export function eulerFromPlane(plane: ConstructionPlane): Vec3 {
  const m = new THREE.Matrix4().makeBasis(
    toThree(plane.u),
    toThree(plane.n),
    toThree(plane.v),
  );
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return { x: e.x, y: e.y, z: e.z };
}

export function computeDrawBox(session: PrimitiveDrawSession): DrawBoundingBox {
  const { plane, startPoint, currentPoint, isFlat } = session;
  const a = planeCoords(startPoint, plane);
  const b = planeCoords(currentPoint, plane);
  let u0 = Math.min(a.u, b.u);
  let u1 = Math.max(a.u, b.u);
  let v0 = Math.min(a.v, b.v);
  let v1 = Math.max(a.v, b.v);
  if (u1 - u0 < MIN_DRAW_SIZE) {
    const mid = (u0 + u1) / 2;
    u0 = mid - MIN_DRAW_SIZE / 2;
    u1 = mid + MIN_DRAW_SIZE / 2;
  }
  if (v1 - v0 < MIN_DRAW_SIZE) {
    const mid = (v0 + v1) / 2;
    v0 = mid - MIN_DRAW_SIZE / 2;
    v1 = mid + MIN_DRAW_SIZE / 2;
  }

  const width = u1 - u0;
  const depth = v1 - v0;
  const rawH = isFlat ? FLAT_THICKNESS : session.height;
  const height = Math.max(isFlat ? FLAT_THICKNESS : MIN_DRAW_SIZE, Math.abs(rawH));
  const hSign = !isFlat && rawH < 0 ? -1 : 1;
  const h0 = hSign < 0 ? -height : 0;
  const h1 = hSign < 0 ? 0 : height;

  const size = { x: width, y: height, z: depth };
  const center = planePoint(plane, (u0 + u1) / 2, (v0 + v1) / 2, (h0 + h1) / 2);
  const rotation = eulerFromPlane(plane);

  const cu = [u0, u1];
  const cv = [v0, v1];
  const ch = [h0, h1];
  const corners: Vec3[] = [];
  for (const hu of cu) for (const hv of cv) for (const hh of ch) {
    corners.push(planePoint(plane, hu, hv, hh));
  }

  const edges: Array<[Vec3, Vec3]> = [];
  const at = (iu: number, iv: number, ih: number) =>
    planePoint(plane, cu[iu], cv[iv], ch[ih]);
  for (let iu = 0; iu < 2; iu++) {
    for (let iv = 0; iv < 2; iv++) {
      edges.push([at(iu, iv, 0), at(iu, iv, 1)]);
    }
  }
  for (let iu = 0; iu < 2; iu++) {
    for (let ih = 0; ih < 2; ih++) {
      edges.push([at(iu, 0, ih), at(iu, 1, ih)]);
    }
  }
  for (let iv = 0; iv < 2; iv++) {
    for (let ih = 0; ih < 2; ih++) {
      edges.push([at(0, iv, ih), at(1, iv, ih)]);
    }
  }

  const baseCorners = [
    planePoint(plane, u0, v0, 0),
    planePoint(plane, u1, v0, 0),
    planePoint(plane, u1, v1, 0),
    planePoint(plane, u0, v1, 0),
  ];

  return { center, size, rotation, corners, edges, baseCorners };
}

export function sessionToPreview(session: PrimitiveDrawSession): CreationPreview {
  const boundingBox = computeDrawBox(session);
  return {
    primitiveType: session.primitiveType,
    viewKind: session.viewKind,
    plane: session.plane,
    startPoint: session.startPoint,
    currentPoint: session.currentPoint,
    boundingBox,
    dimensions: boundingBox.size,
    orientation: boundingBox.rotation,
    snap: session.snap,
    phase: session.phase,
    isFlat: session.isFlat,
    constrained: session.shiftSnap || session.snap.kind !== 'none',
  };
}

export function beginDrawSession(opts: {
  primitiveType: PrimitiveType;
  viewKind: DrawViewKind;
  plane: ConstructionPlane;
  start: Vec3;
  snap?: SnapResult;
  gridSnap?: number;
  shiftSnap?: boolean;
}): PrimitiveDrawSession {
  const isFlat = isFlatPrimitive(opts.primitiveType);
  return {
    primitiveType: opts.primitiveType,
    viewKind: opts.viewKind,
    plane: opts.plane,
    planeLocked: true,
    phase: 'base',
    startPoint: vecClone(opts.start),
    currentPoint: vecClone(opts.start),
    height: isFlat ? FLAT_THICKNESS : 0,
    snap: opts.snap ?? { kind: 'none', point: vecClone(opts.start) },
    isFlat,
    gridSnap: opts.gridSnap ?? 0,
    shiftSnap: opts.shiftSnap ?? false,
  };
}

export function updateDrawBase(
  session: PrimitiveDrawSession,
  point: Vec3,
  snap: SnapResult,
): PrimitiveDrawSession {
  return {
    ...session,
    currentPoint: vecClone(point),
    snap,
    phase: 'base',
  };
}

export function lockDrawBase(session: PrimitiveDrawSession): PrimitiveDrawSession {
  if (session.isFlat) return { ...session, phase: 'base' };
  const box = computeDrawBox(session);
  return {
    ...session,
    phase: 'height',
    height: Math.max(MIN_DRAW_SIZE, box.size.y > MIN_DRAW_SIZE ? box.size.y : MIN_DRAW_SIZE),
  };
}

export function updateDrawHeight(
  session: PrimitiveDrawSession,
  height: number,
  snap: SnapResult,
): PrimitiveDrawSession {
  const step = session.shiftSnap ? (session.gridSnap > 0 ? session.gridSnap : 0.25) : 0;
  let h = height;
  if (step > 0) h = snapScalar(h, step);
  if (Math.abs(h) < MIN_DRAW_SIZE) h = h < 0 ? -MIN_DRAW_SIZE : MIN_DRAW_SIZE;
  return { ...session, height: h, snap, phase: 'height' };
}

/**
 * Height along the construction normal from a world hit, or from screen motion
 * when the camera looks along the normal (ortho view of the drawing plane).
 */
export function heightAlongNormal(opts: {
  hit: Vec3 | null;
  plane: ConstructionPlane;
  screenDeltaPx: number;
  worldPerPixel: number;
  cameraParallelToNormal: boolean;
}): number {
  if (!opts.cameraParallelToNormal && opts.hit) {
    return vecDot(vecSub(opts.hit, opts.plane.origin), opts.plane.n);
  }
  return opts.screenDeltaPx * opts.worldPerPixel;
}

export function fitMeshToLocalBox(mesh: CADMesh, size: Vector3D): CADMesh {
  const verts = mesh.vertices;
  if (!verts.length) return mesh;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  const dx = Math.max(1e-8, maxX - minX);
  const dy = Math.max(1e-8, maxY - minY);
  const dz = Math.max(1e-8, maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const sx = size.x / dx;
  const sy = size.y / dy;
  const sz = size.z / dz;
  const next: Vertex[] = verts.map((v) => ({
    ...v,
    x: (v.x - cx) * sx,
    y: (v.y - cy) * sy,
    z: (v.z - cz) * sz,
  }));
  return { ...mesh, vertices: next, position: { x: 0, y: 0, z: 0 } };
}

export function meshFromPreview(preview: CreationPreview): CADMesh {
  const { dimensions, boundingBox, primitiveType } = preview;
  const size: Vector3D = {
    x: Math.max(MIN_DRAW_SIZE, dimensions.x),
    y: preview.isFlat ? FLAT_THICKNESS : Math.max(MIN_DRAW_SIZE, dimensions.y),
    z: Math.max(MIN_DRAW_SIZE, dimensions.z),
  };
  const generated = generatePrimitive(primitiveType, size);
  const fitted = fitMeshToLocalBox(generated, size);
  return {
    ...fitted,
    name: generated.name,
    position: { ...boundingBox.center },
    rotation: { ...boundingBox.rotation },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function formatDrawDimensions(size: Vec3): { w: string; h: string; d: string } {
  return {
    w: formatLength(size.x),
    h: formatLength(size.y),
    d: formatLength(size.z),
  };
}

/** Default-size primitive sitting on a construction / surface plane (click-to-place). */
export function placementSession(opts: {
  primitiveType: PrimitiveType;
  viewKind: DrawViewKind;
  plane: ConstructionPlane;
  size?: number;
}): PrimitiveDrawSession {
  const size = opts.size ?? 1;
  const plane = { ...opts.plane, origin: vecClone(opts.plane.origin) };
  const start = planePoint(plane, -size / 2, -size / 2, 0);
  const current = planePoint(plane, size / 2, size / 2, 0);
  let session = beginDrawSession({
    primitiveType: opts.primitiveType,
    viewKind: opts.viewKind,
    plane,
    start,
  });
  session = updateDrawBase(session, current, { kind: 'none', point: current });
  if (!session.isFlat) {
    session = lockDrawBase(session);
    session = updateDrawHeight(session, size, { kind: 'none', point: current });
  }
  return session;
}

export function collectMeshSnapCandidates(
  meshes: Array<{
    vertices: Vertex[];
    edges: Array<{ v1Id: string; v2Id: string }>;
    faces: Array<{ vertexIds: string[] }>;
    worldPoint: (x: number, y: number, z: number) => Vec3;
  }>,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const mesh of meshes) {
    const map = new Map(mesh.vertices.map((v) => [v.id, v]));
    for (const v of mesh.vertices) {
      out.push({ kind: 'vertex', point: mesh.worldPoint(v.x, v.y, v.z) });
    }
    for (const e of mesh.edges) {
      const a = map.get(e.v1Id);
      const b = map.get(e.v2Id);
      if (!a || !b) continue;
      const wa = mesh.worldPoint(a.x, a.y, a.z);
      const wb = mesh.worldPoint(b.x, b.y, b.z);
      out.push({
        kind: 'edge',
        point: vecScale(vecAdd(wa, wb), 0.5),
        a: wa,
        b: wb,
      });
    }
    for (const f of mesh.faces) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      for (const id of f.vertexIds) {
        const v = map.get(id);
        if (!v) continue;
        const w = mesh.worldPoint(v.x, v.y, v.z);
        sx += w.x;
        sy += w.y;
        sz += w.z;
        n++;
      }
      if (n) out.push({ kind: 'face', point: { x: sx / n, y: sy / n, z: sz / n } });
    }
  }
  return out;
}

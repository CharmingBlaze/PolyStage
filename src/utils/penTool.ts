/**
 * Modo-style Pen tool.
 *
 * Faithful implementation of Modo's Pen tool
 * (Model layout > Toolbox > Polygon > Pen):
 *
 *  - Click in the 3D viewport to place vertices one at a time.
 *  - Click directly on a vertex created in this session and drag it in 3D.
 *    Vertices turn yellow on hover; dragging one onto another welds them.
 *  - Clicking away from a vertex creates a new vertex in that location.
 *  - Shift+click starts a new polygon without dropping the tool.
 *  - Clicking a previously created vertex and then clicking away INSERTS the new
 *    vertex directly after the highlighted one.
 *  - "Make Quads" draws polygon strips: each click after the first two vertices
 *    completes a quad; Ctrl creates a single triangle instead.
 *
 * The session is pure state so it can be unit tested without a WebGL context;
 * the viewport only supplies world-space clicks and renders the overlay.
 */
import type { CADMesh, Face, UVCoord, Vertex } from '../types/cad';
import { generateId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';
import { worldPointToLocal } from './meshOrigin';
import type { ConstructionPlane, DrawViewKind, Vec3 } from './primitiveDraw';
import {
  constructionPlaneForView,
  intersectRayPlane,
  makeConstructionPlane,
  vecAdd,
  vecClone,
  vecCross,
  vecDot,
  vecLen,
  vecNorm,
  vecScale,
  vecSub,
} from './primitiveDraw';

// ————————————————————————————————————————————————————————————
// Options (mirrors Modo's Pen tool Properties panel)
// ————————————————————————————————————————————————————————————

export type PenType =
  | 'polygons'
  | 'lines'
  | 'vertices'
  | 'splinePatches'
  | 'subdivision'
  | 'polyline'
  | 'catmullClark'
  | 'bSpline';

export type PenWallMode = 'off' | 'inner' | 'outer' | 'both';
export type PenProjectTo = 'actionAxis' | 'backdrop' | 'uvDirection';

export interface PenToolSettings {
  /** Modo "Pen Type". */
  type: PenType;
  /** Modo "Make Quads" (Polygons only). */
  makeQuads: boolean;
  /** Modo "Wall Mode". */
  wallMode: PenWallMode;
  /** Modo "Offset": wall thickness. Doubled when Wall Mode is Both. */
  offset: number;
  /** Modo "Inset": corner bevel amount used while Wall Mode is on. */
  inset: number;
  /** Modo "Segments": corner vertices created for the inset. */
  segments: number;
  showAngles: boolean;
  showHandles: boolean;
  showNumbers: boolean;
  selectNew: boolean;
  /** Modo "Make UVs". */
  makeUvs: boolean;
  /** Modo "Project To". */
  projectTo: PenProjectTo;
  /** Grid snap step; 0 disables snapping. */
  gridSnap: number;
}

export interface PenOptionMeta<T> {
  id: T;
  label: string;
  hint: string;
}

export const PEN_TYPE_OPTIONS: Array<PenOptionMeta<PenType>> = [
  { id: 'polygons', label: 'Polygons', hint: 'Draw individual polygons vertex by vertex. Shift starts a new polygon.' },
  { id: 'lines', label: 'Lines', hint: 'A continuous string of two point polygon line segments.' },
  { id: 'vertices', label: 'Vertices', hint: 'Create new vertices with each click: a point cloud.' },
  { id: 'splinePatches', label: 'Spline Patches', hint: 'Like Polygons, but tags the face as a spline patch.' },
  { id: 'subdivision', label: 'Subdivision Surfaces', hint: 'Like Polygons, but tags the polygon as SDS.' },
  { id: 'polyline', label: 'Polyline', hint: 'A string of straight polyline segments (hair guide style).' },
  { id: 'catmullClark', label: 'Catmull-Clark', hint: 'Draw Catmull-Clark subdivision surface points.' },
  { id: 'bSpline', label: 'B-Spline', hint: 'Draw a B-spline control polygon (4+ points).' },
];

export const WALL_MODE_OPTIONS: Array<PenOptionMeta<PenWallMode>> = [
  { id: 'off', label: 'Off', hint: 'Draw plain polygons.' },
  { id: 'inner', label: 'Inner', hint: 'Wall segment on the inside of the polygon edge line.' },
  { id: 'outer', label: 'Outer', hint: 'Wall segment on the outside of the polygon edge line.' },
  { id: 'both', label: 'Both', hint: 'Walls on both sides. The Offset is doubled.' },
];

export const PROJECT_TO_OPTIONS: Array<PenOptionMeta<PenProjectTo>> = [
  { id: 'actionAxis', label: 'Action Axis', hint: 'Project along the current work plane: UVs are world space, so only 0-1 m falls inside 0-1 UV.' },
  { id: 'backdrop', label: 'Backdrop Item', hint: 'Project onto the backdrop item to match its position in UV space.' },
  { id: 'uvDirection', label: 'U/V Direction', hint: 'Wall Mode: generate a regular row of quad UVs along U or V.' },
];

export const DEFAULT_PEN_SETTINGS: PenToolSettings = {
  type: 'polygons',
  makeQuads: false,
  wallMode: 'off',
  offset: 0.2,
  inset: 0,
  segments: 1,
  showAngles: false,
  showHandles: true,
  showNumbers: true,
  selectNew: true,
  makeUvs: true,
  projectTo: 'actionAxis',
  gridSnap: 0.25,
};

/** Pen types that end up as real faces; the rest are construction geometry. */
export function penTypeCreatesFaces(type: PenType): boolean {
  return type === 'polygons' || type === 'splinePatches' || type === 'subdivision';
}

export function penTypeTag(type: PenType): string | undefined {
  if (type === 'splinePatches') return 'spline';
  if (type === 'subdivision') return 'sds';
  return undefined;
}

// ————————————————————————————————————————————————————————————
// Session
// ————————————————————————————————————————————————————————————

export type PenPatchKind = 'polygon' | 'quad' | 'triangle' | 'segment' | 'curve';

export interface PenPoint {
  id: string;
  position: Vec3;
  /** When set, commit reuses this existing mesh vertex instead of creating one. */
  meshVertexId?: string;
}

export interface PenPatch {
  id: string;
  kind: PenPatchKind;
  /** Point ids in winding order. */
  pointIds: string[];
  closed: boolean;
}

export interface PenSession {
  settings: PenToolSettings;
  /** Work plane the pen draws on (from the active viewport). */
  plane: ConstructionPlane;
  /** Every vertex this session created, in creation order (Modo numbering). */
  points: PenPoint[];
  /** Ordered ids of the polygon currently being drawn. */
  activeIds: string[];
  patches: PenPatch[];
  /** Modo "Current Point": the vertex edited by Position X/Y/Z. */
  currentPointId: string | null;
  /** Vertex under the mouse; drawn yellow. */
  hoverPointId: string | null;
  /** Vertex currently being dragged in 3D. */
  dragPointId: string | null;
}

export function createPenSession(settings: PenToolSettings, plane: ConstructionPlane): PenSession {
  return {
    settings: { ...settings },
    plane: { ...plane, origin: vecClone(plane.origin) },
    points: [],
    activeIds: [],
    patches: [],
    currentPointId: null,
    hoverPointId: null,
    dragPointId: null,
  };
}

/**
 * Work plane for a viewport click.
 *
 * First vertex: this view's construction plane, or a mesh face under the cursor
 * in any view. Later vertices stay on the session plane when the ray can hit it
 * (a cube face or Top/Front/Side sketch stays planar). If the ray is parallel —
 * Quad Front after starting in Top — fall back to the current view or a surface
 * so the polygon becomes real 3D instead of failing to place.
 */
export function resolvePenWorkPlane(opts: {
  view: DrawViewKind;
  sessionPlane: ConstructionPlane;
  hasPoints: boolean;
  rayOrigin: Vec3;
  rayDir: Vec3;
  surface?: { point: Vec3; normal: Vec3 } | null;
}): ConstructionPlane {
  const viewPlane = constructionPlaneForView(opts.view);
  if (opts.hasPoints) {
    const locked = intersectRayPlane(opts.rayOrigin, opts.rayDir, opts.sessionPlane);
    if (locked) return opts.sessionPlane;
    if (opts.surface) return makeConstructionPlane(opts.surface.point, opts.surface.normal);
    return viewPlane;
  }
  if (opts.surface) return makeConstructionPlane(opts.surface.point, opts.surface.normal);
  return viewPlane;
}

export function penFindPoint(session: PenSession, id: string | null | undefined): PenPoint | undefined {
  if (!id) return undefined;
  return session.points.find((p) => p.id === id);
}

/** Zero-based index in creation order, or -1. */
export function penPointIndex(session: PenSession, id: string): number {
  return session.points.findIndex((p) => p.id === id);
}

/** One-based number shown by "Show Numbers". */
export function penPointOrder(session: PenSession, id: string): number {
  const index = penPointIndex(session, id);
  return index < 0 ? -1 : index + 1;
}

export function penPointByOrder(session: PenSession, order: number): PenPoint | null {
  return session.points[Math.round(order) - 1] ?? null;
}

/** Minimum vertices before the active chain can become a patch. */
export function penMinPatchPoints(settings: PenToolSettings): number {
  return settings.type === 'lines' || settings.type === 'polyline' ? 2 : 3;
}

function patchFor(pointIds: string[], kind: PenPatchKind, closed: boolean): PenPatch {
  return { id: generateId(), kind, pointIds: [...pointIds], closed };
}

export interface PenClickOptions {
  /** Shift+click: start a new polygon without dropping the tool. */
  newPolygon?: boolean;
  /** Clicking away while a vertex is highlighted inserts AFTER that vertex. */
  insertAfterId?: string | null;
  /** Ctrl with Make Quads: create a single triangle instead of a quad. */
  triangle?: boolean;
  /** Clicked an existing mesh vertex — reuse it on commit. */
  meshVertexId?: string;
}

export function penFindByMeshVertex(session: PenSession, meshVertexId: string): PenPoint | undefined {
  return session.points.find((p) => p.meshVertexId === meshVertexId);
}

/**
 * Continue the chain through a vertex already in this session (including
 * adopted mesh corners). Clicking the first point of a 3+ chain closes it.
 */
export function penConnectExisting(
  session: PenSession,
  pointId: string,
  options: PenClickOptions = {},
): PenSession {
  if (!penFindPoint(session, pointId)) return session;
  const min = penMinPatchPoints(session.settings);
  if (options.newPolygon) {
    let next = session;
    if (next.activeIds.length >= min) next = penCommitActive(next);
    return { ...next, activeIds: [pointId], currentPointId: pointId };
  }
  if (session.activeIds.length >= min && session.activeIds[0] === pointId) {
    return penCommitActive(session);
  }
  if (session.activeIds[session.activeIds.length - 1] === pointId) return session;
  if (session.activeIds.includes(pointId)) return session;
  return {
    ...session,
    activeIds: [...session.activeIds, pointId],
    currentPointId: pointId,
  };
}

/**
 * Place a vertex.
 *
 * Handles all four Modo click flavours: plain continue, Shift = new polygon,
 * insert-after a highlighted vertex, and Make Quads strips (Ctrl = triangle).
 */
export function penAddPoint(
  session: PenSession,
  position: Vec3,
  options: PenClickOptions = {},
): PenSession {
  if (options.meshVertexId) {
    const existing = penFindByMeshVertex(session, options.meshVertexId);
    if (existing) return penConnectExisting(session, existing.id, options);
  }

  const settings = session.settings;
  const point: PenPoint = {
    id: generateId(),
    position: vecClone(position),
    ...(options.meshVertexId ? { meshVertexId: options.meshVertexId } : {}),
  };
  let points = [...session.points, point];
  let activeIds = [...session.activeIds];
  const patches = [...session.patches];

  if (options.newPolygon) {
    // Shift+click finishes the current polygon and starts a fresh one.
    if (activeIds.length >= penMinPatchPoints(settings)) {
      patches.push(patchFor(activeIds, settings.type === 'polygons' ? 'polygon' : 'curve', true));
    }
    activeIds = [point.id];
  } else if (options.insertAfterId && activeIds.includes(options.insertAfterId)) {
    // Highlight a previous vertex, then click away: insert AFTER it.
    const at = activeIds.indexOf(options.insertAfterId);
    activeIds = [...activeIds.slice(0, at + 1), point.id, ...activeIds.slice(at + 1)];
  } else if (settings.type === 'polygons' && settings.makeQuads && activeIds.length >= 2) {
    // Make Quads: one quad (or a Ctrl triangle) per click.
    const prev1 = activeIds[activeIds.length - 1];
    const prev2 = activeIds[activeIds.length - 2];
    const a = penFindPoint(session, prev2);
    const b = penFindPoint(session, prev1);

    if (options.triangle || !a || !b) {
      patches.push(patchFor([prev2, prev1, point.id], 'triangle', true));
      activeIds = [prev1, point.id];
    } else {
      // The last cross-section defines the strip width; the click starts the next
      // cross-section parallel to it, so clicking along one side of the strip
      // produces a clean run of quads.
      const width = vecSub(b.position, a.position);
      const corner: PenPoint = {
        id: generateId(),
        position: vecAdd(point.position, width),
      };
      points = [...points, corner];
      patches.push(patchFor([prev2, prev1, corner.id, point.id], 'quad', true));
      activeIds = [point.id, corner.id];
    }
  } else {
    activeIds = [...activeIds, point.id];
    // Lines / Polyline commit a segment per click, exactly like Modo.
    if ((settings.type === 'lines' || settings.type === 'polyline') && activeIds.length >= 2) {
      patches.push(patchFor(activeIds.slice(-2), 'segment', false));
    }
  }

  return { ...session, points, activeIds, patches, currentPointId: point.id };
}

/** Move a vertex that this session created (viewport drag or numeric entry). */
export function penMovePoint(session: PenSession, id: string, position: Vec3): PenSession {
  return {
    ...session,
    points: session.points.map((p) => (p.id === id ? { ...p, position: vecClone(position) } : p)),
  };
}

/** Edit by the 1-based "Current Point" number from the properties panel. */
export function penSetPointByOrder(session: PenSession, order: number, position: Vec3): PenSession {
  const point = penPointByOrder(session, order);
  return point ? penMovePoint(session, point.id, position) : session;
}

export function penSetHover(session: PenSession, id: string | null): PenSession {
  return session.hoverPointId === id ? session : { ...session, hoverPointId: id };
}

export function penSetDrag(session: PenSession, id: string | null): PenSession {
  return session.dragPointId === id ? session : { ...session, dragPointId: id };
}

export function penSetCurrent(session: PenSession, id: string | null): PenSession {
  return session.currentPointId === id ? session : { ...session, currentPointId: id };
}

/**
 * Welds two vertices: dragging one onto another merges them, like Modo.
 * Patches referencing the dragged vertex now reference the target, and the
 * active chain keeps drawing from the welded vertex.
 */
export function penWeldPoints(session: PenSession, fromId: string, toId: string): PenSession {
  if (fromId === toId) return session;
  if (!penFindPoint(session, toId) || !penFindPoint(session, fromId)) return session;

  const remap = (ids: string[]) => {
    const out: string[] = [];
    ids.forEach((id) => {
      const next = id === fromId ? toId : id;
      if (out[out.length - 1] !== next) out.push(next);
    });
    return out;
  };

  const patches = session.patches
    .map((patch) => {
      const pointIds = remap(patch.pointIds);
      const minPoints = patch.kind === 'segment' || patch.kind === 'curve' ? 2 : 3;
      if (new Set(pointIds).size < minPoints) return null;
      return pointIds.length === patch.pointIds.length ? patch : { ...patch, pointIds };
    })
    .filter((patch): patch is PenPatch => patch !== null);

  let activeIds = remap(session.activeIds);
  if (activeIds.length === 0) activeIds = [toId];

  return {
    ...session,
    points: session.points.filter((p) => p.id !== fromId),
    patches,
    activeIds,
    currentPointId: session.currentPointId === fromId ? toId : session.currentPointId,
    hoverPointId: session.hoverPointId === fromId ? toId : session.hoverPointId,
    dragPointId: session.dragPointId === fromId ? null : session.dragPointId,
  };
}

/** True when this session point is welded to a mesh vertex and should not be dragged. */
export function penPointIsLocked(point: PenPoint): boolean {
  return Boolean(point.meshVertexId);
}

/** Snap a free session point onto an existing mesh vertex. */
export function penBindMeshVertex(
  session: PenSession,
  pointId: string,
  meshVertexId: string,
  position: Vec3,
): PenSession {
  if (!penFindPoint(session, pointId)) return session;
  return {
    ...session,
    points: session.points.map((p) =>
      p.id === pointId ? { ...p, meshVertexId, position: vecClone(position) } : p,
    ),
    currentPointId: pointId,
  };
}

/** Nearest overlay / mesh handle under the cursor, in viewport pixels. */
export function penNearestScreenHit<T extends { id: string; sx: number; sy: number }>(
  mouseX: number,
  mouseY: number,
  candidates: T[],
  thresholdPx = 14,
): T | null {
  let best: T | null = null;
  let bestD = thresholdPx * thresholdPx;
  for (const c of candidates) {
    const dx = c.sx - mouseX;
    const dy = c.sy - mouseY;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Backspace: drop the last placed vertex, else the last completed patch. */
export function penUndoLastPoint(session: PenSession): PenSession {
  if (session.activeIds.length > 0) {
    const last = session.activeIds[session.activeIds.length - 1];
    const activeIds = session.activeIds.slice(0, -1);
    const stillUsed =
      activeIds.includes(last) || session.patches.some((p) => p.pointIds.includes(last));
    return {
      ...session,
      activeIds,
      points: stillUsed ? session.points : session.points.filter((p) => p.id !== last),
      patches: stillUsed
        ? session.patches
        : session.patches.filter((p) => !p.pointIds.includes(last)),
      currentPointId: activeIds[activeIds.length - 1] ?? null,
    };
  }
  if (session.patches.length > 0) {
    const last = session.patches[session.patches.length - 1];
    return {
      ...session,
      patches: session.patches.slice(0, -1),
      points: session.points.filter((p) => !last.pointIds.includes(p.id)),
    };
  }
  return session;
}

/** Enter / double-click: turn the active chain into a patch. */
export function penCommitActive(session: PenSession, closed = true): PenSession {
  if (session.activeIds.length < penMinPatchPoints(session.settings)) {
    return { ...session, activeIds: [] };
  }
  const kind: PenPatchKind = session.settings.type === 'polygons' ? 'polygon' : 'curve';
  return {
    ...session,
    patches: [...session.patches, patchFor(session.activeIds, kind, closed)],
    activeIds: [],
  };
}

/** Esc: abandon the in-progress chain but keep completed patches. */
export function penDropActive(session: PenSession): PenSession {
  return { ...session, activeIds: [], dragPointId: null, hoverPointId: null };
}

// ————————————————————————————————————————————————————————————
// Overlay + guides
// ————————————————————————————————————————————————————————————

/** Ordered world positions of a patch (or the active chain). */
export function penPatchPoints(session: PenSession, pointIds: string[]): Vec3[] {
  return pointIds
    .map((id) => penFindPoint(session, id)?.position)
    .filter((p): p is Vec3 => Boolean(p));
}

/** Line segments the viewport draws: completed patches + the in-progress chain. */
export function penOverlaySegments(session: PenSession): Vec3[][] {
  const segments: Vec3[][] = [];

  session.patches.forEach((patch) => {
    const pts = penPatchPoints(session, patch.pointIds);
    for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
    if (patch.closed && pts.length > 2) segments.push([pts[pts.length - 1], pts[0]]);
  });

  const active = penPatchPoints(session, session.activeIds);
  for (let i = 0; i < active.length - 1; i++) segments.push([active[i], active[i + 1]]);
  if (penTypeCreatesFaces(session.settings.type) && active.length >= 3) {
    segments.push([active[active.length - 1], active[0]]);
  }
  return segments;
}

export interface PenAngleLabel {
  pointId: string;
  position: Vec3;
  degrees: number;
}

/**
 * Modo "Show Angles": the corner angle between the two opposing edges, in
 * degrees, for every interior vertex of the active chain and the patches.
 */
export function penAngleLabels(session: PenSession): PenAngleLabel[] {
  const out: PenAngleLabel[] = [];
  const rings: string[][] = [
    ...session.patches.map((patch) => (patch.closed ? patch.pointIds : [])),
    session.activeIds,
  ];

  rings.forEach((ring) => {
    for (let i = 1; i < ring.length - 1; i++) {
      const prev = penFindPoint(session, ring[i - 1]);
      const cur = penFindPoint(session, ring[i]);
      const next = penFindPoint(session, ring[i + 1]);
      if (!prev || !cur || !next) continue;
      const a = vecNorm(vecSub(prev.position, cur.position));
      const b = vecNorm(vecSub(next.position, cur.position));
      const dot = Math.max(-1, Math.min(1, vecDot(a, b)));
      out.push({
        pointId: cur.id,
        position: cur.position,
        degrees: (Math.acos(dot) * 180) / Math.PI,
      });
    }
  });

  return out;
}

// ————————————————————————————————————————————————————————————
// UVs (Modo "Make UVs" + "Project To")
// ————————————————————————————————————————————————————————————

/**
 * Action Axis projection: UVs are world space relative to the work plane, so
 * only points drawn between 0 m and 1 m fall inside 0-1 UV space.
 *
 * "Backdrop Item" has no backdrop container in this build, so it falls back to
 * the same plane projection.
 */
export function penUVFor(point: Vec3, plane: ConstructionPlane): UVCoord {
  const d = vecSub(point, plane.origin);
  return { u: vecDot(d, plane.u), v: vecDot(d, plane.v) };
}

/** Normalized cumulative arc-length parameters along a polyline. */
export function penPolylineParams(points: Vec3[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + vecLen(vecSub(points[i], points[i - 1])));
  }
  const total = out[out.length - 1] || 1;
  return out.map((value) => value / total);
}

// ————————————————————————————————————————————————————————————
// Commit to the mesh
// ————————————————————————————————————————————————————————————

export interface PenCommitResult {
  mesh: CADMesh;
  /** Faces created by this commit, for Modo's "Select New". */
  faceIds: string[];
  /** Vertices created by this commit. */
  vertexIds: string[];
}

/**
 * Commit the session into a CADMesh.
 *
 * Face-producing types (Polygons / Spline Patches / Subdivision Surfaces) write
 * faces; Wall Mode writes the mitered wall footprint instead of the outline.
 * Point/curve types (Vertices, Lines, Polyline, B-Spline, Catmull-Clark) commit
 * their vertices so the drawn points survive as a point cloud; their connecting
 * segments stay on the viewport overlay because the mesh model is face based.
 */
export function penSessionToMesh(baseMesh: CADMesh, session: PenSession): PenCommitResult {
  const settings = session.settings;
  const createsFaces = penTypeCreatesFaces(settings.type);
  const vertices: Vertex[] = baseMesh.vertices.map((v) => ({ ...v }));
  const faces: Face[] = baseMesh.faces.map((f) => ({
    ...f,
    vertexIds: [...f.vertexIds],
    uvs: f.uvs.map((u) => ({ ...u })),
  }));
  const pointVertex = new Map<string, string>();
  const faceIds: string[] = [];
  const vertexIds: string[] = [];

  const addVertex = (key: string, world: Vec3, meshVertexId?: string): string => {
    const existing = pointVertex.get(key);
    if (existing) return existing;
    if (meshVertexId) {
      const reused = vertices.find((v) => v.id === meshVertexId);
      if (reused) {
        pointVertex.set(key, reused.id);
        return reused.id;
      }
    }
    const id = generateId();
    const local = worldPointToLocal(baseMesh, world);
    vertices.push({ id, x: local.x, y: local.y, z: local.z });
    pointVertex.set(key, id);
    vertexIds.push(id);
    return id;
  };

  const addFace = (ids: string[], uvs: UVCoord[]) => {
    // Collapse repeated corners (an overlapping click) so a degenerate quad can
    // never reach the mesh as an invalid duplicate-corner face.
    const cleanIds: string[] = [];
    const cleanUvs: UVCoord[] = [];
    ids.forEach((id, index) => {
      if (cleanIds[cleanIds.length - 1] === id) return;
      cleanIds.push(id);
      cleanUvs.push(uvs[index] ?? { u: 0, v: 0 });
    });
    if (cleanIds.length > 1 && cleanIds[0] === cleanIds[cleanIds.length - 1]) {
      cleanIds.pop();
      cleanUvs.pop();
    }
    if (new Set(cleanIds).size < 3) return;

    const tag = penTypeTag(settings.type);
    const face: Face = {
      id: generateId(),
      vertexIds: cleanIds,
      uvs: cleanUvs,
      ...(tag ? { smoothingGroup: tag } : {}),
    };
    faces.push(face);
    faceIds.push(face.id);
  };

  const livePatches =
    createsFaces && session.activeIds.length >= 3
      ? [
          ...session.patches,
          { id: '__pen_preview__', pointIds: session.activeIds, kind: 'polygon' as const, closed: true },
        ]
      : session.patches;

  livePatches.forEach((patch) => {
    const pts = penPatchPoints(session, patch.pointIds);
    if (pts.length < 2) return;

    if (createsFaces && settings.wallMode !== 'off') {
      const sides: Array<1 | -1> = settings.wallMode === 'both' ? [1, -1] : settings.wallMode === 'inner' ? [1] : [-1];
      sides.forEach((side) => {
        const profile = penWallProfile(pts, patch.closed, side, settings, session.plane);
        const tris = penBandTriangles(profile.base, profile.offset);
        if (tris.length === 0) return;

        const ring: string[] = [];
        profile.base.forEach((p, i) => ring.push(addVertex(`${patch.id}:${side}:b${i}`, p)));
        profile.offset.forEach((p, i) => ring.push(addVertex(`${patch.id}:${side}:o${i}`, p)));

        const baseParams = penPolylineParams(profile.base);
        const offParams = penPolylineParams(profile.offset);
        const uvAt = (index: number): UVCoord => {
          if (!settings.makeUvs) return { u: 0, v: 0 };
          if (settings.projectTo === 'uvDirection') {
            const isBase = index < profile.base.length;
            const param = isBase ? baseParams[index] : offParams[index - profile.base.length];
            return { u: param, v: isBase ? 0 : 1 };
          }
          const position = index < profile.base.length
            ? profile.base[index]
            : profile.offset[index - profile.base.length];
          return penUVFor(position, session.plane);
        };

        tris.forEach((tri) => {
          addFace(
            tri.map((index) => ring[index]),
            tri.map((index) => uvAt(index)),
          );
        });
      });
      return;
    }

    if (!createsFaces || patch.pointIds.length < 3) return;
    const ids = patch.pointIds.map((pid) => {
      const point = penFindPoint(session, pid);
      return addVertex(pid, point ? point.position : pts[0], point?.meshVertexId);
    });
    addFace(
      ids,
      settings.makeUvs
        ? pts.map((p) => penUVFor(p, session.plane))
        : ids.map(() => ({ u: 0, v: 0 })),
    );
  });

  // Point / curve types still commit their vertices as a point cloud.
  if (!createsFaces) {
    session.points.forEach((p) => addVertex(p.id, p.position, p.meshVertexId));
  }

  return {
    mesh: finalizeEditableMesh({ ...baseMesh, vertices, faces }, { validate: false }),
    faceIds,
    vertexIds,
  };
}

// ————————————————————————————————————————————————————————————
// Wall Mode
// ————————————————————————————————————————————————————————————

/** In-plane normal for a segment direction; points "inside" for CCW rings. */
function edgeNormal(dir: Vec3, plane: ConstructionPlane): Vec3 {
  return vecNorm(vecCross(dir, plane.n));
}

/** Mitered offset point so consecutive wall segments share a corner. */
function miterPoint(cur: Vec3, inNormal: Vec3, outNormal: Vec3, distance: number): Vec3 {
  const bisector = vecNorm(vecAdd(inNormal, outNormal));
  const cosHalf = Math.max(0.5, Math.abs(vecDot(bisector, inNormal)));
  return vecAdd(cur, vecScale(bisector, distance / cosHalf));
}

/**
 * Modo "Inset" + "Segments": bevel a wall corner into several vertices.
 * `segments` of 1 gives a flattened (chamfered) corner; higher values round it.
 */
export function penFilletCorner(
  corner: Vec3,
  inNormal: Vec3,
  outNormal: Vec3,
  distance: number,
  inset: number,
  segments: number,
): Vec3[] {
  const p0 = vecAdd(corner, vecScale(inNormal, distance));
  const p1 = vecAdd(corner, vecScale(outNormal, distance));
  const count = Math.max(1, Math.round(segments));
  if (count === 1) return [vecScale(vecAdd(p0, p1), 0.5)];

  const bisector = vecNorm(vecAdd(inNormal, outNormal));
  const out: Vec3[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const base = vecAdd(p0, vecScale(vecSub(p1, p0), t));
    out.push(vecAdd(base, vecScale(bisector, inset * Math.sin(Math.PI * t))));
  }
  return out;
}

export interface WallProfile {
  /** Original path, resampled to match the filleted corner resolution. */
  base: Vec3[];
  /** Offset path: the wall's far edge. */
  offset: Vec3[];
}

/**
 * Build the wall footprint for one side of the drawn path.
 *
 * `side` is +1 for the inside of a CCW ring (Modo's Inner) and -1 for the
 * outside (Modo's Outer). "Both" callers run this twice.
 */
export function penWallProfile(
  points: Vec3[],
  closed: boolean,
  side: 1 | -1,
  settings: PenToolSettings,
  plane: ConstructionPlane,
): WallProfile {
  const n = points.length;
  const offset = Math.max(0, settings.offset);
  const inset = Math.max(0, settings.inset);
  const segments = Math.max(1, Math.round(settings.segments));
  const base: Vec3[] = [];
  const far: Vec3[] = [];

  for (let j = 0; j < n; j++) {
    const cur = points[j];
    const hasPrev = closed || j > 0;
    const hasNext = closed || j < n - 1;
    const prev = hasPrev ? points[(j - 1 + n) % n] : cur;
    const next = hasNext ? points[(j + 1) % n] : cur;

    // Endpoints of an open path use the single segment they own, pointing
    // forward along the path, so the wall offsets consistently on both ends.
    const inDir = hasPrev ? vecNorm(vecSub(cur, prev)) : vecNorm(vecSub(next, cur));
    const outDir = hasNext ? vecNorm(vecSub(next, cur)) : vecNorm(vecSub(cur, prev));
    const inNormal = vecScale(edgeNormal(inDir, plane), side);
    const outNormal = vecScale(edgeNormal(outDir, plane), side);
    const needsCorner = hasPrev && hasNext;

    if (!needsCorner) {
      base.push(vecClone(cur));
      far.push(vecAdd(cur, vecScale(inNormal, offset)));
      continue;
    }

    const corner = penFilletCorner(cur, inNormal, outNormal, offset, inset, segments);
    if (inset <= 0) {
      base.push(vecClone(cur));
      far.push(miterPoint(cur, inNormal, outNormal, offset));
      continue;
    }
    // Mirror the fillet resolution on the base path so the band stays quads.
    corner.forEach(() => base.push(vecClone(cur)));
    far.push(...corner);
  }

  return { base, offset: far };
}

/**
 * Triangulate the band between two open polylines that share endpoints but may
 * differ in interior resolution (a filleted wall corner needs this).
 *
 * Returns triangles as index triples into `[...base, ...offset]`.
 */
export function penBandTriangles(base: Vec3[], offset: Vec3[]): number[][] {
  const n = base.length;
  const m = offset.length;
  const tris: number[][] = [];
  if (n < 2 || m < 2) return tris;

  const u = penPolylineParams(base);
  const v = penPolylineParams(offset);
  const off = n;

  let i = 0;
  let j = 0;
  while (i < n - 1 && j < m - 1) {
    if (u[i + 1] <= v[j + 1]) {
      tris.push([i, j + off, i + 1]);
      i++;
    } else {
      tris.push([i, j + off, j + 1 + off]);
      j++;
    }
  }
  while (i < n - 1) {
    tris.push([i, m - 1 + off, i + 1]);
    i++;
  }
  while (j < m - 1) {
    tris.push([n - 1, j + off, j + 1 + off]);
    j++;
  }
  return tris;
}
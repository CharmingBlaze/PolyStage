/**
 * Blender-style modal mesh ops: build topology once, then only move verts
 * while the mouse amount changes (Extrude / Inset / Bevel).
 */
import type { CADMesh, Face } from '../types/cad';
import { generateId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';
import { chamferEdges } from './bevelOps';
import type { ComponentMode } from './selection';
import { beginEdgeExtrude, beginVertexBevel, beginVertexExtrude, resolveOperatorTargets } from './meshOperators';

export type ModalMeshOpType = 'extrude' | 'inset' | 'bevel';

export interface VertMover {
  id: string;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  /** Inset depth unit (face/vertex normal). Ignored by extrude/bevel. */
  nx?: number;
  ny?: number;
  nz?: number;
}

/** Blender Inset Faces (I) modal flags. */
export interface InsetOptions {
  /** Each selected face insets on its own (press I again). Default: region. */
  individual?: boolean;
  /** Build the border around the selection (press O). Ignored in individual. */
  outset?: boolean;
  /** Inset open mesh-boundary edges (press B). Default on. Region only. */
  boundary?: boolean;
}

export interface ModalMeshSession {
  type: ModalMeshOpType;
  /** Topology with stable IDs; vertex positions updated by applyAmount. */
  mesh: CADMesh;
  movers: VertMover[];
  /** Faces to select after confirm (extruded caps / inset inners / bevel strips). */
  resultFaceIds: string[];
  resultVertexIds?: string[];
  resultEdgeIds?: string[];
  /** Face region extrude: constrain grab to this local-space unit axis. */
  axis?: { x: number; y: number; z: number };
  grab?: 'axis' | 'view';
  /** Bevel only */
  segments?: number;
  edgeIds?: string[];
  amount: number;
  /** Inset only: offset along averaged face normals (hold Ctrl). */
  depth?: number;
  inset?: Required<InsetOptions>;
}

function faceNormalNewell(faceVerts: { x: number; y: number; z: number }[]) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < faceVerts.length; i++) {
    const cur = faceVerts[i];
    const next = faceVerts[(i + 1) % faceVerts.length];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/** Face normal pointing away from the mesh (primitives are often CW-wound). */
function outwardFaceNormal(
  faceVerts: { x: number; y: number; z: number }[],
  meshCenter: { x: number; y: number; z: number },
) {
  const n = faceNormalNewell(faceVerts);
  let fx = 0;
  let fy = 0;
  let fz = 0;
  faceVerts.forEach((v) => {
    fx += v.x;
    fy += v.y;
    fz += v.z;
  });
  const inv = 1 / Math.max(1, faceVerts.length);
  fx *= inv;
  fy *= inv;
  fz *= inv;
  // If normal points toward mesh center, flip it.
  const toOutsideX = fx - meshCenter.x;
  const toOutsideY = fy - meshCenter.y;
  const toOutsideZ = fz - meshCenter.z;
  if (n.x * toOutsideX + n.y * toOutsideY + n.z * toOutsideZ < 0) {
    return { x: -n.x, y: -n.y, z: -n.z };
  }
  return n;
}

function meshCentroid(mesh: CADMesh) {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = mesh.vertices.length || 1;
  mesh.vertices.forEach((v) => {
    x += v.x;
    y += v.y;
    z += v.z;
  });
  return { x: x / n, y: y / n, z: z / n };
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function applyMovers(mesh: CADMesh, movers: VertMover[], amount: number, depth = 0): CADMesh {
  if (movers.length === 0) return mesh;
  const byId = new Map(movers.map((m) => [m.id, m]));
  const vertices = mesh.vertices.map((v) => {
    const m = byId.get(v.id);
    if (!m) return v;
    return {
      ...v,
      x: m.ox + m.dx * amount + (m.nx ?? 0) * depth,
      y: m.oy + m.dy * amount + (m.ny ?? 0) * depth,
      z: m.oz + m.dz * amount + (m.nz ?? 0) * depth,
    };
  });
  return { ...mesh, vertices, revision: (mesh.revision ?? 0) + 1 };
}

const INSET_SMALL = 1e-8;

type Vec3 = { x: number; y: number; z: number };

function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vNorm(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len < INSET_SMALL) return { x: 0, y: 0, z: 0 };
  return vScale(a, 1 / len);
}

/** Blender `shell_v3v3_mid_normalized_to_dist` — even border width at a corner. */
function shellMidNormalizedToDist(a: Vec3, b: Vec3): number {
  const ab = vNorm(vAdd(a, b));
  const angleCos = ab.x === 0 && ab.y === 0 && ab.z === 0 ? 0 : Math.abs(vDot(a, ab));
  return angleCos < INSET_SMALL ? 1 : 1 / angleCos;
}

export function evenInsetVector(enoPrev: Vec3, enoNext: Vec3): Vec3 {
  return vScale(vNorm(vAdd(enoPrev, enoNext)), shellMidNormalizedToDist(enoPrev, enoNext));
}

/** Inward face-plane tangent of an edge (`BM_edge_calc_face_tangent`). */
export function edgeFaceTangent(a: Vec3, b: Vec3, faceNormal: Vec3): Vec3 {
  return vNorm(vCross(faceNormal, vSub(b, a)));
}

export function orderedEdgeOnFace(face: Face, a: string, b: string): [string, string] {
  const n = face.vertexIds.length;
  for (let i = 0; i < n; i++) {
    const x = face.vertexIds[i];
    const y = face.vertexIds[(i + 1) % n];
    if (x === a && y === b) return [a, b];
    if (x === b && y === a) return [b, a];
  }
  return [a, b];
}

export function makeRimQuad(b1: string, b2: string, t1: string, t2: string): Face {
  return {
    id: generateId(),
    vertexIds: [b1, b2, t2, t1],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
  };
}

export function averageNormal(normals: Vec3[]): Vec3 {
  if (normals.length === 0) return { x: 0, y: 1, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  normals.forEach((n) => {
    x += n.x;
    y += n.y;
    z += n.z;
  });
  return vNorm({ x, y, z });
}

/** Extrude like Blender E: region extrude at depth 0, then grab along average normal. */
export function beginExtrude(mesh: CADMesh, faceIds: string[]): ModalMeshSession | null {
  const idSet = new Set(faceIds);
  const targets = mesh.faces.filter((f) => idSet.has(f.id));
  if (targets.length === 0) return null;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const vertsToExtrude = new Set<string>();
  targets.forEach((f) => f.vertexIds.forEach((id) => vertsToExtrude.add(id)));
  const center = meshCentroid(mesh);

  let nx = 0;
  let ny = 0;
  let nz = 0;
  targets.forEach((f) => {
    const fv = f.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fv.length < 3) return;
    const n = outwardFaceNormal(fv, center);
    nx += n.x;
    ny += n.y;
    nz += n.z;
  });
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  const newVertMap = new Map<string, string>();
  const newVertices = [...mesh.vertices];
  const movers: VertMover[] = [];

  vertsToExtrude.forEach((oldId) => {
    const oldV = vertMap.get(oldId);
    if (!oldV) return;
    const newId = generateId();
    newVertMap.set(oldId, newId);
    newVertices.push({ id: newId, x: oldV.x, y: oldV.y, z: oldV.z });
    movers.push({
      id: newId,
      ox: oldV.x,
      oy: oldV.y,
      oz: oldV.z,
      dx: nx,
      dy: ny,
      dz: nz,
    });
  });

  const edgeUse = new Map<string, { a: string; b: string; count: number; faceId: string }>();
  targets.forEach((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % n];
      const key = edgeKey(a, b);
      const prev = edgeUse.get(key);
      if (prev) prev.count++;
      else edgeUse.set(key, { a, b, count: 1, faceId: f.id });
    }
  });

  const sideFaces: Face[] = [];
  edgeUse.forEach((info) => {
    if (info.count !== 1) return;
    const owner = targets.find((f) => f.id === info.faceId)!;
    const n = owner.vertexIds.length;
    let b1 = info.a;
    let b2 = info.b;
    for (let i = 0; i < n; i++) {
      if (owner.vertexIds[i] === info.a && owner.vertexIds[(i + 1) % n] === info.b) {
        b1 = info.a;
        b2 = info.b;
        break;
      }
      if (owner.vertexIds[i] === info.b && owner.vertexIds[(i + 1) % n] === info.a) {
        b1 = info.b;
        b2 = info.a;
        break;
      }
    }
    const t1 = newVertMap.get(b1)!;
    const t2 = newVertMap.get(b2)!;
    sideFaces.push({
      id: generateId(),
      vertexIds: [b1, b2, t2, t1],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  });

  const topFaces: Face[] = targets.map((f) => ({
    ...f,
    id: generateId(),
    vertexIds: f.vertexIds.map((oldId) => newVertMap.get(oldId)!),
  }));

  const built = finalizeEditableMesh(
    {
      ...mesh,
      vertices: newVertices,
      faces: mesh.faces.filter((f) => !idSet.has(f.id)).concat([...topFaces, ...sideFaces]),
    },
    { validate: false },
  );

  return {
    type: 'extrude',
    mesh: built,
    movers,
    resultFaceIds: topFaces.map((f) => f.id),
    resultVertexIds: [...newVertMap.values()],
    axis: { x: nx, y: ny, z: nz },
    grab: 'axis',
    amount: 0,
  };
}

/**
 * Region inset like Blender I (default): only the selection boundary is bridged;
 * shared interior verts stay put. Amount 0–0.95 lerps boundary verts toward
 * the average of their selected-face centroids (stable on any face size).
 */
export function beginInset(mesh: CADMesh, faceIds: string[]): ModalMeshSession | null {
  const idSet = new Set(faceIds);
  const targets = mesh.faces.filter((f) => idSet.has(f.id));
  if (targets.length === 0) return null;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  const edgeUse = new Map<string, { a: string; b: string; count: number; faceId: string; order: [string, string] }>();
  targets.forEach((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % n];
      const key = edgeKey(a, b);
      const prev = edgeUse.get(key);
      if (prev) prev.count++;
      else edgeUse.set(key, { a, b, count: 1, faceId: f.id, order: [a, b] });
    }
  });

  const boundaryKeys = new Set<string>();
  edgeUse.forEach((info, key) => {
    if (info.count === 1) boundaryKeys.add(key);
  });

  const boundaryVerts = new Set<string>();
  boundaryKeys.forEach((key) => {
    const [a, b] = key.split('|');
    boundaryVerts.add(a);
    boundaryVerts.add(b);
  });

  const faceCentroid = (f: Face) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    f.vertexIds.forEach((id) => {
      const v = vertMap.get(id);
      if (!v) return;
      cx += v.x;
      cy += v.y;
      cz += v.z;
      n++;
    });
    const inv = 1 / Math.max(1, n);
    return { x: cx * inv, y: cy * inv, z: cz * inv };
  };

  // Pull each boundary vert toward the average centroid of selected faces that use it.
  const pullAcc = new Map<string, { x: number; y: number; z: number; n: number }>();
  targets.forEach((f) => {
    const c = faceCentroid(f);
    f.vertexIds.forEach((id) => {
      if (!boundaryVerts.has(id)) return;
      const v = vertMap.get(id);
      if (!v) return;
      const acc = pullAcc.get(id) || { x: 0, y: 0, z: 0, n: 0 };
      acc.x += c.x - v.x;
      acc.y += c.y - v.y;
      acc.z += c.z - v.z;
      acc.n += 1;
      pullAcc.set(id, acc);
    });
  });

  const newVertMap = new Map<string, string>();
  const newVertices = [...mesh.vertices];
  const movers: VertMover[] = [];

  boundaryVerts.forEach((oldId) => {
    const oldV = vertMap.get(oldId);
    if (!oldV) return;
    const acc = pullAcc.get(oldId);
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (acc && acc.n > 0) {
      dx = acc.x / acc.n;
      dy = acc.y / acc.n;
      dz = acc.z / acc.n;
    }
    // Guaranteed non-zero pull on real faces — avoid frozen inset.
    if (Math.hypot(dx, dy, dz) < 1e-8) {
      dx = 0.001;
    }
    const newId = generateId();
    newVertMap.set(oldId, newId);
    newVertices.push({ id: newId, x: oldV.x, y: oldV.y, z: oldV.z });
    movers.push({ id: newId, ox: oldV.x, oy: oldV.y, oz: oldV.z, dx, dy, dz });
  });

  const remap = (id: string) => newVertMap.get(id) || id;

  const innerFaces: Face[] = targets.map((f) => ({
    ...f,
    id: generateId(),
    vertexIds: f.vertexIds.map(remap),
    uvs: f.uvs.map((uv) => ({ ...uv })),
  }));

  const rimFaces: Face[] = [];
  edgeUse.forEach((info) => {
    if (info.count !== 1) return;
    const owner = targets.find((f) => f.id === info.faceId)!;
    const n = owner.vertexIds.length;
    let b1 = info.a;
    let b2 = info.b;
    for (let i = 0; i < n; i++) {
      if (owner.vertexIds[i] === info.a && owner.vertexIds[(i + 1) % n] === info.b) {
        b1 = info.a;
        b2 = info.b;
        break;
      }
      if (owner.vertexIds[i] === info.b && owner.vertexIds[(i + 1) % n] === info.a) {
        b1 = info.b;
        b2 = info.a;
        break;
      }
    }
    const t1 = newVertMap.get(b1)!;
    const t2 = newVertMap.get(b2)!;
    rimFaces.push({
      id: generateId(),
      vertexIds: [b1, b2, t2, t1],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  });

  const built = finalizeEditableMesh(
    {
      ...mesh,
      vertices: newVertices,
      faces: mesh.faces.filter((f) => !idSet.has(f.id)).concat([...innerFaces, ...rimFaces]),
    },
    { validate: false },
  );

  return {
    type: 'inset',
    mesh: built,
    movers,
    resultFaceIds: innerFaces.map((f) => f.id),
    amount: 0,
  };
}

/** Collect every mesh edge that belongs to any of the given faces (Blender face-bevel). */
function edgeIdsTouchingFaces(mesh: CADMesh, faceIds: string[]): string[] {
  const idSet = new Set(faceIds);
  const keys = new Set<string>();
  mesh.faces.forEach((f) => {
    if (!idSet.has(f.id)) return;
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      keys.add(edgeKey(f.vertexIds[i], f.vertexIds[(i + 1) % n]));
    }
  });
  if (keys.size === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  mesh.edges.forEach((e) => {
    const k = edgeKey(e.v1Id, e.v2Id);
    if (!keys.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(e.id);
  });
  return out;
}

/** Bevel like Blender Ctrl+B: width from mouse, segments from scroll. */
export function beginBevel(
  mesh: CADMesh,
  edgeIds: string[],
  faceIds: string[] = [],
  segments = 1,
): ModalMeshSession | null {
  const segs = Math.max(1, Math.min(8, Math.round(segments)));

  // Face mode: bevel every edge belonging to the selected faces (not inset).
  const resolvedEdges =
    edgeIds.length > 0 ? [...edgeIds] : faceIds.length > 0 ? edgeIdsTouchingFaces(mesh, faceIds) : [];
  if (resolvedEdges.length === 0) return null;

  // Build topology at amount=0 so movers encode the full offset unit.
  const beveled = chamferEdges(mesh, resolvedEdges, 0, segs);
  if (beveled.movers.length === 0) return null;

  return {
    type: 'bevel',
    mesh: beveled.mesh,
    movers: beveled.movers,
    resultFaceIds: beveled.stripFaceIds,
    segments: segs,
    edgeIds: resolvedEdges,
    amount: 0,
  };
}

export function applyModalAmount(session: ModalMeshSession, amount: number): ModalMeshSession {
  let a = amount;
  if (session.type === 'inset') a = Math.max(0, Math.min(0.95, amount));
  if (session.type === 'bevel') a = Math.max(0, Math.min(0.5, amount));
  // Extrude allows negative (push in) like Blender
  const mesh = applyMovers(session.mesh, session.movers, a);
  return { ...session, mesh, amount: a };
}

/** Uniform local-space offset for view-plane extrude (edge / vertex E). */
export function applyModalOffset(
  session: ModalMeshSession,
  lx: number,
  ly: number,
  lz: number,
): ModalMeshSession {
  if (session.movers.length === 0) return session;
  const byId = new Map(session.movers.map((m) => [m.id, m]));
  const vertices = session.mesh.vertices.map((v) => {
    const m = byId.get(v.id);
    if (!m) return v;
    return { ...v, x: m.ox + lx, y: m.oy + ly, z: m.oz + lz };
  });
  return {
    ...session,
    mesh: { ...session.mesh, vertices, revision: (session.mesh.revision ?? 0) + 1 },
    amount: Math.hypot(lx, ly, lz),
  };
}

/**
 * Resolve the selection for the active mode, then dispatch to the matching
 * Blender-style operator.
 *
 * Extrude works in every mode (region cap in face mode, a bridged strip in
 * edge/vertex mode), Inset needs faces, and Bevel falls back to a vertex bevel
 * when only corners are selected.
 */
export function beginModalMeshOp(
  type: ModalMeshOpType,
  mesh: CADMesh,
  faceIds: string[],
  edgeIds: string[],
  segments = 1,
  vertexIds: string[] = [],
  mode?: ComponentMode,
): ModalMeshSession | null {
  const activeMode: ComponentMode =
    mode ?? (faceIds.length > 0 ? 'face' : edgeIds.length > 0 ? 'edge' : 'vertex');
  const targets = resolveOperatorTargets(mesh, activeMode, { vertexIds, edgeIds, faceIds });

  if (type === 'extrude') {
    // Blender E is mode-locked: faces = region, edges = strip, verts = verts.
    // Implied faces from a closed vert/edge loop must not steal region extrude.
    if (activeMode === 'face' && targets.faceIds.length > 0) return beginExtrude(mesh, targets.faceIds);
    if (activeMode === 'edge' && targets.edgeIds.length > 0) {
      const session = beginEdgeExtrude(mesh, targets.edgeIds);
      if (!session) return null;
      return {
        type: 'extrude',
        mesh: session.mesh,
        movers: session.movers,
        resultFaceIds: session.resultFaceIds,
        resultVertexIds: session.resultVertexIds,
        resultEdgeIds: session.resultEdgeIds,
        grab: 'view',
        amount: 0,
      };
    }
    if (activeMode === 'vertex' && targets.vertexIds.length > 0) {
      const session = beginVertexExtrude(mesh, targets.vertexIds);
      if (!session) return null;
      return {
        type: 'extrude',
        mesh: session.mesh,
        movers: session.movers,
        resultFaceIds: session.resultFaceIds,
        resultVertexIds: session.resultVertexIds,
        resultEdgeIds: session.resultEdgeIds,
        grab: 'view',
        amount: 0,
      };
    }
    return null;
  }

  if (type === 'inset') {
    return targets.faceIds.length > 0 ? beginInset(mesh, targets.faceIds) : null;
  }

  const segs = Math.max(1, Math.min(8, Math.round(segments)));
  if (targets.edgeIds.length > 0) return beginBevel(mesh, targets.edgeIds, targets.faceIds, segs);
  if (targets.vertexIds.length > 0) {
    const session = beginVertexBevel(mesh, targets.vertexIds, segs);
    if (!session) return null;
    return {
      type: 'bevel',
      mesh: session.mesh,
      movers: session.movers,
      resultFaceIds: session.resultFaceIds,
      segments: segs,
      edgeIds: [],
      amount: 0,
    };
  }
  return null;
}

/** Convenience one-shot (tests / non-modal). */
export function extrudeFacesOnce(mesh: CADMesh, faceIds: string[], depth: number): CADMesh {
  const s = beginExtrude(mesh, faceIds);
  if (!s) return mesh;
  return applyModalAmount(s, depth).mesh;
}

export function insetFacesOnce(mesh: CADMesh, faceIds: string[], factor: number): CADMesh {
  const s = beginInset(mesh, faceIds);
  if (!s) return mesh;
  return applyModalAmount(s, factor).mesh;
}

/**
 * Blender-style edge / vertex bevel.
 *
 * Topology is built once at width 0. Movers encode a 1-unit Offset so the modal
 * preview only moves verts. Adjacent selected edges are beveled together (not
 * one after another), new verts slide along existing edges / even miters, and
 * original corners that are fully replaced are dropped so the mesh stays manifold.
 */
import type { CADMesh, Face, Vertex, UVCoord } from '../types/cad';
import { generateId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';

export interface BevelMover {
  id: string;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ChamferEdgesResult {
  mesh: CADMesh;
  movers: BevelMover[];
  stripFaceIds: string[];
}

type Vec3 = { x: number; y: number; z: number };

const EPS = 1e-8;

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

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
function vLen(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function vNorm(a: Vec3): Vec3 {
  const len = vLen(a);
  if (len < EPS) return { x: 0, y: 0, z: 0 };
  return vScale(a, 1 / len);
}

function faceNewell(verts: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const cur = verts[i];
    const next = verts[(i + 1) % verts.length];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  return vNorm({ x: nx, y: ny, z: nz });
}

function faceCentroid(verts: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  verts.forEach((p) => {
    x += p.x;
    y += p.y;
    z += p.z;
  });
  const inv = 1 / Math.max(1, verts.length);
  return { x: x * inv, y: y * inv, z: z * inv };
}

/** Inward (into the face) unit normal of directed edge a→b, in the face plane. */
function inwardEdgeNormal(a: Vec3, b: Vec3, normal: Vec3, centroid: Vec3): Vec3 {
  let n = vNorm(vCross(normal, vSub(b, a)));
  const mid = vScale(vAdd(a, b), 0.5);
  if (vDot(n, vSub(centroid, mid)) < 0) n = vScale(n, -1);
  return n;
}

function shellMid(a: Vec3, b: Vec3): number {
  const ab = vNorm(vAdd(a, b));
  const c = ab.x === 0 && ab.y === 0 && ab.z === 0 ? 0 : Math.abs(vDot(a, ab));
  return c < EPS ? 1 : 1 / c;
}

function evenOffsetDir(n0: Vec3, n1: Vec3): Vec3 {
  return vScale(vNorm(vAdd(n0, n1)), shellMid(n0, n1));
}

/** Unit-width slide along `toward` so the perpendicular distance to `edgeInward` is 1. */
function slideDir(from: Vec3, toward: Vec3, edgeInward: Vec3): Vec3 {
  const dir = vNorm(vSub(toward, from));
  const d = vDot(dir, edgeInward);
  if (Math.abs(d) < 1e-4) return dir;
  return vScale(dir, 1 / d);
}

function slerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  const la = vLen(a);
  const lb = vLen(b);
  const na = vNorm(a);
  const nb = vNorm(b);
  const dot = Math.max(-1, Math.min(1, vDot(na, nb)));
  const len = la * (1 - t) + lb * t;
  if (dot > 0.9995) {
    return vScale(vNorm({ x: na.x * (1 - t) + nb.x * t, y: na.y * (1 - t) + nb.y * t, z: na.z * (1 - t) + nb.z * t }), len);
  }
  const omega = Math.acos(dot);
  const so = Math.sin(omega) || 1;
  const w0 = Math.sin((1 - t) * omega) / so;
  const w1 = Math.sin(t * omega) / so;
  return vScale(vNorm(vAdd(vScale(na, w0), vScale(nb, w1))), len);
}

/** Circular-fillet offset between two even-offset vectors (t=0 → d0, t=1 → d1). */
function profileOffset(d0: Vec3, d1: Vec3, t: number): Vec3 {
  if (t <= 0) return d0;
  if (t >= 1) return d1;
  const r0 = vScale(d1, -1);
  const r1 = vScale(d0, -1);
  return vAdd(vAdd(d0, d1), slerpVec(r0, r1, t));
}

function uvAt(face: Face, index: number): UVCoord {
  return face.uvs[index] ? { ...face.uvs[index] } : { u: 0, v: 0 };
}

function dedupeRing(ids: string[], uvs: UVCoord[]): { ids: string[]; uvs: UVCoord[] } {
  const outIds: string[] = [];
  const outUvs: UVCoord[] = [];
  ids.forEach((id, i) => {
    if (outIds.length > 0 && outIds[outIds.length - 1] === id) return;
    outIds.push(id);
    outUvs.push(uvs[i]);
  });
  if (outIds.length > 1 && outIds[0] === outIds[outIds.length - 1]) {
    outIds.pop();
    outUvs.pop();
  }
  return { ids: outIds, uvs: outUvs };
}

export function chamferEdges(
  mesh: CADMesh,
  edgeIds: string[],
  amount = 0.1,
  segments = 1,
): ChamferEdgesResult {
  const empty: ChamferEdgesResult = { mesh, movers: [], stripFaceIds: [] };
  if (edgeIds.length === 0) return empty;

  const byId = new Map(mesh.edges.map((e) => [e.id, e]));
  const beveledKeys = new Set<string>();
  const targetPairs: Array<[string, string]> = [];
  for (const id of edgeIds) {
    const e = byId.get(id) || mesh.edges.find((ed) => ed.id === id);
    if (!e) continue;
    const k = edgeKey(e.v1Id, e.v2Id);
    if (beveledKeys.has(k)) continue;
    beveledKeys.add(k);
    targetPairs.push([e.v1Id, e.v2Id]);
  }
  if (targetPairs.length === 0) return empty;

  const segs = Math.max(1, Math.min(8, Math.round(segments)));
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const facesByEdge = new Map<string, Face[]>();
  mesh.faces.forEach((face) => {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const k = edgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      const list = facesByEdge.get(k) || [];
      list.push(face);
      facesByEdge.set(k, list);
    }
  });

  const endpoints = new Set<string>();
  targetPairs.forEach(([a, b]) => {
    endpoints.add(a);
    endpoints.add(b);
  });

  const movers: BevelMover[] = [];
  const newVertices: Vertex[] = [...mesh.vertices];

  const addVert = (origin: Vec3, dir: Vec3): string => {
    const id = generateId();
    newVertices.push({
      id,
      x: origin.x + dir.x * amount,
      y: origin.y + dir.y * amount,
      z: origin.z + dir.z * amount,
    });
    movers.push({ id, ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
    return id;
  };

  const slideIds = new Map<string, string>();
  const slideDirOf = new Map<string, Vec3>();
  const miterIds = new Map<string, string>();
  const miterDirOf = new Map<string, Vec3>();

  const faceGeom = new Map<string, { normal: Vec3; centroid: Vec3; pts: Vec3[] }>();
  mesh.faces.forEach((face) => {
    const pts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    faceGeom.set(face.id, { pts, normal: faceNewell(pts), centroid: faceCentroid(pts) });
  });

  const ensureSlide = (fromId: string, towardId: string, eno: Vec3): string => {
    const k = `${fromId}>${towardId}`;
    const existing = slideIds.get(k);
    if (existing) return existing;
    const from = vertMap.get(fromId)!;
    const toward = vertMap.get(towardId)!;
    const dir = slideDir(from, toward, eno);
    const id = addVert(from, dir);
    slideIds.set(k, id);
    slideDirOf.set(id, dir);
    return id;
  };

  const ensureMiter = (face: Face, vId: string, prevId: string, nextId: string): string => {
    const k = `${face.id}:${vId}`;
    const existing = miterIds.get(k);
    if (existing) return existing;
    const geom = faceGeom.get(face.id)!;
    const v = vertMap.get(vId)!;
    const p = vertMap.get(prevId)!;
    const n = vertMap.get(nextId)!;
    const nPrev = inwardEdgeNormal(p, v, geom.normal, geom.centroid);
    const nNext = inwardEdgeNormal(v, n, geom.normal, geom.centroid);
    const dir = evenOffsetDir(nPrev, nNext);
    const id = addVert(v, dir);
    miterIds.set(k, id);
    miterDirOf.set(id, dir);
    return id;
  };

  const peekSlide = (fromId: string, towardId: string) => slideIds.get(`${fromId}>${towardId}`);

  // Create all slide / miter verts from face corners first so rebuild can peek slides.
  mesh.faces.forEach((face) => {
    const ids = face.vertexIds;
    const n = ids.length;
    const geom = faceGeom.get(face.id);
    if (!geom || n < 3) return;
    for (let i = 0; i < n; i++) {
      const V = ids[i];
      const P = ids[(i + n - 1) % n];
      const N = ids[(i + 1) % n];
      const prevB = beveledKeys.has(edgeKey(P, V));
      const nextB = beveledKeys.has(edgeKey(V, N));
      if (prevB && nextB) {
        ensureMiter(face, V, P, N);
      } else if (nextB) {
        const eno = inwardEdgeNormal(vertMap.get(V)!, vertMap.get(N)!, geom.normal, geom.centroid);
        ensureSlide(V, P, eno);
      } else if (prevB) {
        const eno = inwardEdgeNormal(vertMap.get(P)!, vertMap.get(V)!, geom.normal, geom.centroid);
        ensureSlide(V, N, eno);
      }
    }
  });

  const cornerOnFace = (face: Face, i: number): string[] => {
    const ids = face.vertexIds;
    const n = ids.length;
    const V = ids[i];
    const P = ids[(i + n - 1) % n];
    const N = ids[(i + 1) % n];
    const prevB = beveledKeys.has(edgeKey(P, V));
    const nextB = beveledKeys.has(edgeKey(V, N));
    if (prevB && nextB) return [miterIds.get(`${face.id}:${V}`)!];
    if (nextB) return [slideIds.get(`${V}>${P}`)!];
    if (prevB) return [slideIds.get(`${V}>${N}`)!];
    if (endpoints.has(V)) {
      const a = peekSlide(V, P);
      const b = peekSlide(V, N);
      const out: string[] = [];
      if (a) out.push(a);
      if (b && b !== a) out.push(b);
      if (out.length) return out;
    }
    return [V];
  };

  type EdgeCut = { a: string; b: string; aNew: string; bNew: string; face: Face };
  const cutsByEdge = new Map<string, EdgeCut[]>();

  const rebuiltFaces: Face[] = [];
  const usedIds = new Set<string>();

  mesh.faces.forEach((face) => {
    const ids = face.vertexIds;
    const n = ids.length;
    const newIds: string[] = [];
    const newUvs: UVCoord[] = [];
    const cornerFirst = new Array<string>(n);
    const cornerLast = new Array<string>(n);

    for (let i = 0; i < n; i++) {
      const reps = cornerOnFace(face, i).filter(Boolean);
      const uv = uvAt(face, i);
      if (reps.length === 0) continue;
      cornerFirst[i] = reps[0];
      cornerLast[i] = reps[reps.length - 1];
      reps.forEach((id) => {
        newIds.push(id);
        newUvs.push({ ...uv });
      });
    }

    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % n];
      const k = edgeKey(a, b);
      if (!beveledKeys.has(k)) continue;
      const aNew = cornerLast[i];
      const bNew = cornerFirst[(i + 1) % n];
      if (!aNew || !bNew) continue;
      const list = cutsByEdge.get(k) || [];
      list.push({ a, b, aNew, bNew, face });
      cutsByEdge.set(k, list);
    }

    const ring = dedupeRing(newIds, newUvs);
    if (ring.ids.length < 3) return;
    ring.ids.forEach((id) => usedIds.add(id));
    rebuiltFaces.push({
      ...face,
      id: generateId(),
      vertexIds: ring.ids,
      uvs: ring.uvs,
    });
  });

  const stripFaceIds: string[] = [];
  const moverById = new Map(movers.map((m) => [m.id, m]));

  const makeProfile = (origin: Vec3, d0: Vec3, d1: Vec3): string[] => {
    const ids: string[] = [];
    for (let i = 0; i <= segs; i++) {
      if (i === 0) {
        // endpoint already exists as the face-0 vert; caller passes that id separately
        continue;
      }
      if (i === segs) continue;
      const dir = profileOffset(d0, d1, i / segs);
      ids.push(addVert(origin, dir));
    }
    return ids;
  };

  targetPairs.forEach(([a, b]) => {
    const k = edgeKey(a, b);
    const cuts = cutsByEdge.get(k) || [];
    if (cuts.length >= 2) {
      const c0 = cuts[0];
      const c1 = cuts[1];
      // Match original vertices: c0.aNew is replacement of c0.a, etc.
      const a0 = c0.a === a ? c0.aNew : c0.bNew;
      const b0 = c0.a === a ? c0.bNew : c0.aNew;
      const a1 = c1.a === a ? c1.aNew : c1.bNew;
      const b1 = c1.a === a ? c1.bNew : c1.aNew;
      const originA = vertMap.get(a)!;
      const originB = vertMap.get(b)!;
      const mA0 = moverById.get(a0);
      const mA1 = moverById.get(a1);
      const mB0 = moverById.get(b0);
      const mB1 = moverById.get(b1);
      const dA0 = mA0 ? { x: mA0.dx, y: mA0.dy, z: mA0.dz } : { x: 0, y: 0, z: 0 };
      const dA1 = mA1 ? { x: mA1.dx, y: mA1.dy, z: mA1.dz } : { x: 0, y: 0, z: 0 };
      const dB0 = mB0 ? { x: mB0.dx, y: mB0.dy, z: mB0.dz } : { x: 0, y: 0, z: 0 };
      const dB1 = mB1 ? { x: mB1.dx, y: mB1.dy, z: mB1.dz } : { x: 0, y: 0, z: 0 };

      const ringA = [a0, ...makeProfile(originA, dA0, dA1), a1];
      const ringB = [b0, ...makeProfile(originB, dB0, dB1), b1];
      // If c0 walked a→b, outward chamfer is a0→b0 then across to face1.
      const flip = c0.a !== a;
      for (let i = 0; i < segs; i++) {
        const aL = ringA[i];
        const aR = ringA[i + 1];
        const bL = ringB[i];
        const bR = ringB[i + 1];
        const id = generateId();
        stripFaceIds.push(id);
        const verts = flip ? [bL, aL, aR, bR] : [aL, bL, bR, aR];
        verts.forEach((v) => usedIds.add(v));
        rebuiltFaces.push({
          id,
          vertexIds: verts,
          uvs: [
            { u: 0, v: 0 },
            { u: 1, v: 0 },
            { u: 1, v: 1 },
            { u: 0, v: 1 },
          ],
        });
      }
    } else if (cuts.length === 1) {
      const c = cuts[0];
      const id = generateId();
      stripFaceIds.push(id);
      const verts = [c.a, c.b, c.bNew, c.aNew];
      verts.forEach((v) => usedIds.add(v));
      rebuiltFaces.push({
        id,
        vertexIds: verts,
        uvs: [
          { u: 0, v: 0 },
          { u: 1, v: 0 },
          { u: 1, v: 1 },
          { u: 0, v: 1 },
        ],
      });
    }
  });

  // Fill the hole at a vertex where 3+ beveled edges meet (cube corner, etc).
  const beveledAt = new Map<string, number>();
  targetPairs.forEach(([a, b]) => {
    beveledAt.set(a, (beveledAt.get(a) || 0) + 1);
    beveledAt.set(b, (beveledAt.get(b) || 0) + 1);
  });

  const facesAround = (vId: string): Face[] => {
    const incident = mesh.faces.filter((f) => f.vertexIds.includes(vId));
    if (incident.length === 0) return [];
    const result: Face[] = [];
    const visited = new Set<string>();
    let face: Face | undefined = incident[0];
    const startId = face.id;
    while (face && !visited.has(face.id)) {
      const curFace: Face = face;
      visited.add(curFace.id);
      result.push(curFace);
      const ids: string[] = curFace.vertexIds;
      const i = ids.indexOf(vId);
      const next: string = ids[(i + 1) % ids.length];
      const others = (facesByEdge.get(edgeKey(vId, next)) || []).filter((f) => f.id !== curFace.id);
      face = others[0];
      if (face && face.id === startId) break;
    }
    incident.forEach((f) => {
      if (!visited.has(f.id)) result.push(f);
    });
    return result;
  };

  beveledAt.forEach((count, vId) => {
    if (count < 2) return;
    const ring: string[] = [];
    facesAround(vId).forEach((face) => {
      const ids = face.vertexIds;
      const i = ids.indexOf(vId);
      if (i < 0) return;
      cornerOnFace(face, i).forEach((id) => {
        if (id && id !== vId && (ring.length === 0 || ring[ring.length - 1] !== id)) ring.push(id);
      });
    });
    if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length < 3) return;
    const id = generateId();
    stripFaceIds.push(id);
    ring.forEach((v) => usedIds.add(v));
    rebuiltFaces.push({
      id,
      vertexIds: ring,
      uvs: ring.map((_, i) => ({ u: i / ring.length, v: 0 })),
    });
  });

  const vertices = newVertices.filter((v) => usedIds.has(v.id) || !endpoints.has(v.id));
  // Drop unused originals that were bevel endpoints; keep everything still referenced.
  const referenced = new Set<string>();
  rebuiltFaces.forEach((f) => f.vertexIds.forEach((id) => referenced.add(id)));
  const liveVerts = vertices.filter((v) => referenced.has(v.id));
  const liveMovers = movers.filter((m) => referenced.has(m.id));

  const built = finalizeEditableMesh(
    { ...mesh, vertices: liveVerts, faces: rebuiltFaces },
    { validate: false },
  );

  return { mesh: built, movers: liveMovers, stripFaceIds };
}

/**
 * Blender vertex bevel: replace each selected corner with an n-gon whose
 * vertices slide along the incident edges. Does not chamfer the whole edges.
 */
export function bevelVertices(
  mesh: CADMesh,
  vertexIds: string[],
  amount = 0.1,
  segments = 1,
): ChamferEdgesResult {
  const empty: ChamferEdgesResult = { mesh, movers: [], stripFaceIds: [] };
  const targets = vertexIds.filter((id) => mesh.vertices.some((v) => v.id === id));
  if (targets.length === 0) return empty;

  const segs = Math.max(1, Math.min(8, Math.round(segments)));
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const targetSet = new Set(targets);

  const facesByEdge = new Map<string, Face[]>();
  mesh.faces.forEach((face) => {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const k = edgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      const list = facesByEdge.get(k) || [];
      list.push(face);
      facesByEdge.set(k, list);
    }
  });

  const movers: BevelMover[] = [];
  const newVertices: Vertex[] = [...mesh.vertices];
  const addVert = (origin: Vec3, dir: Vec3): string => {
    const id = generateId();
    newVertices.push({
      id,
      x: origin.x + dir.x * amount,
      y: origin.y + dir.y * amount,
      z: origin.z + dir.z * amount,
    });
    movers.push({ id, ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
    return id;
  };

  const slideOnEdge = new Map<string, string[]>(); // `${v}>${n}` -> ring from inner to outer (length segs)

  const facesAround = (vId: string): Face[] => {
    const incident = mesh.faces.filter((f) => f.vertexIds.includes(vId));
    if (incident.length === 0) return [];
    const result: Face[] = [];
    const visited = new Set<string>();
    let face: Face | undefined = incident[0];
    const startId = face.id;
    while (face && !visited.has(face.id)) {
      const curFace: Face = face;
      visited.add(curFace.id);
      result.push(curFace);
      const ids: string[] = curFace.vertexIds;
      const i = ids.indexOf(vId);
      const next: string = ids[(i + 1) % ids.length];
      const others = (facesByEdge.get(edgeKey(vId, next)) || []).filter((f) => f.id !== curFace.id);
      face = others[0];
      if (face && face.id === startId) break;
    }
    incident.forEach((f) => {
      if (!visited.has(f.id)) result.push(f);
    });
    return result;
  };

  const neighborOrder = (vId: string): string[] => {
    const ordered: string[] = [];
    facesAround(vId).forEach((face) => {
      const ids = face.vertexIds;
      const i = ids.indexOf(vId);
      const next = ids[(i + 1) % ids.length];
      if (next && (ordered.length === 0 || ordered[ordered.length - 1] !== next)) ordered.push(next);
    });
    if (ordered.length > 1 && ordered[0] === ordered[ordered.length - 1]) ordered.pop();
    if (ordered.length === 0) {
      mesh.edges.forEach((e) => {
        if (e.v1Id === vId) ordered.push(e.v2Id);
        else if (e.v2Id === vId) ordered.push(e.v1Id);
      });
    }
    return ordered;
  };

  targets.forEach((vId) => {
    const origin = vertMap.get(vId);
    if (!origin) return;
    neighborOrder(vId).forEach((nId) => {
      const toward = vertMap.get(nId);
      if (!toward) return;
      const dir = vNorm(vSub(toward, origin));
      const ring: string[] = [];
      for (let i = 1; i <= segs; i++) {
        ring.push(addVert(origin, vScale(dir, i / segs)));
      }
      slideOnEdge.set(`${vId}>${nId}`, ring);
    });
  });

  const stripFaceIds: string[] = [];
  const rebuiltFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    const ids = face.vertexIds;
    const n = ids.length;
    const newIds: string[] = [];
    const newUvs: UVCoord[] = [];
    for (let i = 0; i < n; i++) {
      const V = ids[i];
      const P = ids[(i + n - 1) % n];
      const N = ids[(i + 1) % n];
      const uv = uvAt(face, i);
      if (!targetSet.has(V)) {
        newIds.push(V);
        newUvs.push(uv);
        continue;
      }
      const inRing = slideOnEdge.get(`${V}>${P}`);
      const outRing = slideOnEdge.get(`${V}>${N}`);
      const inOuter = inRing?.[inRing.length - 1];
      const outOuter = outRing?.[outRing.length - 1];
      if (inOuter) {
        newIds.push(inOuter);
        newUvs.push(uv);
      }
      if (outOuter && outOuter !== inOuter) {
        newIds.push(outOuter);
        newUvs.push(uv);
      }
    }
    const ring = dedupeRing(newIds, newUvs);
    if (ring.ids.length < 3) return;
    rebuiltFaces.push({ ...face, id: generateId(), vertexIds: ring.ids, uvs: ring.uvs });
  });

  targets.forEach((vId) => {
    const neighbors = neighborOrder(vId);
    const outer = neighbors
      .map((nId) => {
        const ring = slideOnEdge.get(`${vId}>${nId}`);
        return ring?.[ring.length - 1];
      })
      .filter((id): id is string => Boolean(id));
    if (outer.length >= 3) {
      const id = generateId();
      stripFaceIds.push(id);
      rebuiltFaces.push({
        id,
        vertexIds: outer,
        uvs: outer.map((_, i) => ({ u: i / outer.length, v: 0 })),
      });
    }
    if (segs > 1) {
      for (let s = 0; s < segs - 1; s++) {
        for (let i = 0; i < neighbors.length; i++) {
          const n0 = neighbors[i];
          const n1 = neighbors[(i + 1) % neighbors.length];
          const r0 = slideOnEdge.get(`${vId}>${n0}`);
          const r1 = slideOnEdge.get(`${vId}>${n1}`);
          if (!r0 || !r1) continue;
          const id = generateId();
          stripFaceIds.push(id);
          rebuiltFaces.push({
            id,
            vertexIds: [r0[s], r0[s + 1], r1[s + 1], r1[s]],
            uvs: [
              { u: 0, v: 0 },
              { u: 1, v: 0 },
              { u: 1, v: 1 },
              { u: 0, v: 1 },
            ],
          });
        }
      }
    }
  });

  const referenced = new Set<string>();
  rebuiltFaces.forEach((f) => f.vertexIds.forEach((id) => referenced.add(id)));
  const liveVerts = newVertices.filter((v) => referenced.has(v.id));
  const liveMovers = movers.filter((m) => referenced.has(m.id));

  const built = finalizeEditableMesh(
    { ...mesh, vertices: liveVerts, faces: rebuiltFaces },
    { validate: false },
  );
  return { mesh: built, movers: liveMovers, stripFaceIds };
}

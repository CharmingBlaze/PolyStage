import type { CADMesh, Edge, Face, UVCoord, Vector3D, Vertex } from '../types/cad';
import { generateId } from './meshUtils';
import { edgeKey } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';

export type KnifeHit = {
  faceId: string;
  edgeId?: string;
  t?: number;
  point: Vector3D;
};

function ek(a: string, b: string) {
  return edgeKey(a, b);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpV(a: Vector3D, b: Vector3D, t: number): Vector3D {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function lerpUV(a: UVCoord | undefined, b: UVCoord | undefined, t: number): UVCoord {
  const ua = a || { u: 0, v: 0 };
  const ub = b || { u: 1, v: 0 };
  return { u: lerp(ua.u, ub.u, t), v: lerp(ua.v, ub.v, t) };
}

function buildIndex(mesh: CADMesh) {
  const facesByEdge = new Map<string, string[]>();
  const faceEdgeKeys = new Map<string, string[]>();
  const edgeByKey = new Map<string, Edge>();
  mesh.edges.forEach((e) => edgeByKey.set(ek(e.v1Id, e.v2Id), e));
  mesh.faces.forEach((face) => {
    const keys: string[] = [];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const key = ek(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      keys.push(key);
      const list = facesByEdge.get(key) || [];
      list.push(face.id);
      facesByEdge.set(key, list);
    }
    faceEdgeKeys.set(face.id, keys);
  });
  return { facesByEdge, faceEdgeKeys, edgeByKey };
}

function oppositeOnQuad(
  faceEdgeKeys: Map<string, string[]>,
  faceMap: Map<string, Face>,
  faceId: string,
  key: string,
): string | null {
  const face = faceMap.get(faceId);
  const keys = faceEdgeKeys.get(faceId);
  if (!face || !keys || face.vertexIds.length !== 4) return null;
  const idx = keys.indexOf(key);
  if (idx < 0) return null;
  return keys[(idx + 2) % 4];
}

function walkDirection(
  startKey: string,
  firstFaceId: string | null,
  facesByEdge: Map<string, string[]>,
  faceEdgeKeys: Map<string, string[]>,
  edgeByKey: Map<string, Edge>,
  faceMap: Map<string, Face>,
  maxEdges: number,
): string[] {
  const result: string[] = [];
  let currentKey = startKey;
  let prevFaceId: string | null = null;
  const visited = new Set<string>();

  for (let guard = 0; guard < maxEdges + 2; guard++) {
    if (visited.has(currentKey)) break;
    visited.add(currentKey);
    const edge = edgeByKey.get(currentKey);
    if (!edge) break;
    result.push(edge.id);

    const faceIds = facesByEdge.get(currentKey) || [];
    let nextFace: string | null = null;
    if (prevFaceId == null) {
      nextFace = firstFaceId && faceIds.includes(firstFaceId) ? firstFaceId : faceIds[0] || null;
    } else {
      nextFace = faceIds.find((id) => id !== prevFaceId) || null;
    }
    if (!nextFace) break;
    const opp = oppositeOnQuad(faceEdgeKeys, faceMap, nextFace, currentKey);
    if (!opp) break;
    prevFaceId = nextFace;
    if (opp === startKey) break;
    currentKey = opp;
  }
  return result;
}

/** Ordered edge ids forming a Blender-style edge loop / strip through quads. */
export function findEdgeLoop(mesh: CADMesh, startEdgeId: string): string[] {
  const start = mesh.edges.find((e) => e.id === startEdgeId);
  if (!start) return [];

  const { facesByEdge, faceEdgeKeys, edgeByKey } = buildIndex(mesh);
  const faceMap = new Map(mesh.faces.map((f) => [f.id, f]));
  const startKey = ek(start.v1Id, start.v2Id);
  const faceIds = facesByEdge.get(startKey) || [];

  const forward = walkDirection(
    startKey,
    faceIds[0] || null,
    facesByEdge,
    faceEdgeKeys,
    edgeByKey,
    faceMap,
    mesh.edges.length,
  );
  const backward =
    faceIds.length > 1
      ? walkDirection(startKey, faceIds[1], facesByEdge, faceEdgeKeys, edgeByKey, faceMap, mesh.edges.length)
      : [];

  const merged = [...backward.slice(1).reverse(), startEdgeId, ...forward.slice(1)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of merged) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : [startEdgeId];
}

export function loopCutFactors(count: number): number[] {
  const n = Math.max(1, Math.min(8, Math.round(count)));
  if (n === 1) return [0.5];
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i / (n + 1));
  return out;
}

/** Local-space polylines for viewport preview (one polyline per factor). */
export function getLoopCutPreviewPolylines(
  mesh: CADMesh,
  loopEdgeIds: string[],
  factors: number[],
): Vector3D[][] {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const edgeMap = new Map(mesh.edges.map((e) => [e.id, e]));
  const { facesByEdge } = buildIndex(mesh);
  const lines: Vector3D[][] = [];

  factors.forEach((factor) => {
    const t = Math.max(0.02, Math.min(0.98, factor));
    const pts: Vector3D[] = [];
    loopEdgeIds.forEach((id) => {
      const e = edgeMap.get(id);
      if (!e) return;
      const a = vertMap.get(e.v1Id);
      const b = vertMap.get(e.v2Id);
      if (!a || !b) return;
      pts.push(lerpV(a, b, t));
    });
    if (pts.length < 2) return;
    const first = edgeMap.get(loopEdgeIds[0]);
    if (first && loopEdgeIds.length >= 3) {
      const fk = ek(first.v1Id, first.v2Id);
      if ((facesByEdge.get(fk) || []).length >= 1) pts.push({ ...pts[0] });
    }
    lines.push(pts);
  });
  return lines;
}

/**
 * Apply loop cuts at factors along loop edges.
 * Splits each quad that contains two opposite loop edges into parallel strips.
 */
export function applyLoopCut(mesh: CADMesh, loopEdgeIds: string[], factors: number[]): CADMesh {
  if (!loopEdgeIds.length || !factors.length) return mesh;
  const cleanFactors = [...new Set(factors.map((f) => Math.max(0.02, Math.min(0.98, f))))].sort(
    (a, b) => a - b,
  );
  if (!cleanFactors.length) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const { faceEdgeKeys } = buildIndex(mesh);
  const loopKeySet = new Set<string>();
  const loopEdgeByKey = new Map<string, Edge>();
  loopEdgeIds.forEach((id) => {
    const e = mesh.edges.find((ed) => ed.id === id);
    if (!e) return;
    const key = ek(e.v1Id, e.v2Id);
    loopKeySet.add(key);
    loopEdgeByKey.set(key, e);
  });

  const cutCache = new Map<string, string>();
  const newVertices: Vertex[] = [...mesh.vertices];

  const cutOnEdge = (edge: Edge, factor: number): string => {
    const key = `${edge.id}|${factor.toFixed(5)}`;
    const hit = cutCache.get(key);
    if (hit) return hit;
    const a = vertMap.get(edge.v1Id)!;
    const b = vertMap.get(edge.v2Id)!;
    const p = lerpV(a, b, factor);
    const id = generateId();
    const v: Vertex = { id, x: p.x, y: p.y, z: p.z };
    newVertices.push(v);
    vertMap.set(id, v);
    cutCache.set(key, id);
    return id;
  };

  const newFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    const keys = faceEdgeKeys.get(face.id) || [];
    const loopOnFace: Edge[] = [];
    keys.forEach((k) => {
      const e = loopEdgeByKey.get(k);
      if (e) loopOnFace.push(e);
    });

    if (loopOnFace.length !== 2 || face.vertexIds.length !== 4) {
      newFaces.push(face);
      return;
    }

    const ring = face.vertexIds;
    const uvs = face.uvs.length === 4 ? face.uvs : ring.map(() => ({ u: 0, v: 0 }));
    const edgeA = loopOnFace[0];
    const edgeB = loopOnFace[1];

    const edgeIndex = (e: Edge) => {
      for (let i = 0; i < 4; i++) {
        if (ek(ring[i], ring[(i + 1) % 4]) === ek(e.v1Id, e.v2Id)) return i;
      }
      return -1;
    };
    const iA = edgeIndex(edgeA);
    const iB = edgeIndex(edgeB);
    if (iA < 0 || iB < 0 || (iA + 2) % 4 !== iB && (iB + 2) % 4 !== iA) {
      newFaces.push(face);
      return;
    }

    // Orient so iB is opposite of iA
    const ia = iA;
    const ib = (iA + 2) % 4;

    const ringFactorToEdgeFactor = (e: Edge, ringIdx: number, tRing: number) => {
      const a = ring[ringIdx];
      const b = ring[(ringIdx + 1) % 4];
      return a === e.v1Id && b === e.v2Id ? tRing : 1 - tRing;
    };

    type Node = { id: string; uv: UVCoord };
    const aStart = ring[ia];
    const aEnd = ring[(ia + 1) % 4];
    const bStart = ring[ib];
    const bEnd = ring[(ib + 1) % 4];
    const eA = loopEdgeByKey.get(ek(aStart, aEnd))!;
    const eB = loopEdgeByKey.get(ek(bStart, bEnd))!;

    const railA: Node[] = [{ id: aStart, uv: uvs[ia] }];
    const railB: Node[] = [{ id: bEnd, uv: uvs[(ib + 1) % 4] }];

    cleanFactors.forEach((f) => {
      const tA = f;
      const idA = cutOnEdge(eA, ringFactorToEdgeFactor(eA, ia, tA));
      railA.push({ id: idA, uv: lerpUV(uvs[ia], uvs[(ia + 1) % 4], tA) });

      // Match visual factor from bEnd toward bStart
      const tB = f;
      const idB = cutOnEdge(eB, ringFactorToEdgeFactor(eB, ib, 1 - tB));
      railB.push({ id: idB, uv: lerpUV(uvs[(ib + 1) % 4], uvs[ib], tB) });
    });

    railA.push({ id: aEnd, uv: uvs[(ia + 1) % 4] });
    railB.push({ id: bStart, uv: uvs[ib] });

    for (let i = 0; i < railA.length - 1; i++) {
      const a0 = railA[i];
      const a1 = railA[i + 1];
      const b0 = railB[i];
      const b1 = railB[i + 1];
      newFaces.push({
        id: generateId(),
        vertexIds: [a0.id, a1.id, b1.id, b0.id],
        uvs: [a0.uv, a1.uv, b1.uv, b0.uv],
        materialId: face.materialId,
        color: face.color,
      });
    }
  });

  return finalizeEditableMesh({
    ...mesh,
    vertices: newVertices,
    faces: newFaces,
  });
}

function projectT(p: Vector3D, a: Vector3D, b: Vector3D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLen2 = abx * abx + aby * aby + abz * abz || 1e-12;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLen2;
  return Math.max(0.02, Math.min(0.98, t));
}

function distPointSeg(p: Vector3D, a: Vector3D, b: Vector3D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLen2 = abx * abx + aby * aby + abz * abz || 1e-12;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLen2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

function splitFaceBetweenHits(mesh: CADMesh, faceId: string, hitA: KnifeHit, hitB: KnifeHit): CADMesh {
  const face = mesh.faces.find((f) => f.id === faceId);
  if (!face || face.vertexIds.length < 3) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const ring = [...face.vertexIds];
  const uvs = face.uvs.length === ring.length ? [...face.uvs] : ring.map(() => ({ u: 0, v: 0 }));
  const n = ring.length;
  const newVertices = [...mesh.vertices];

  const resolveHit = (hit: KnifeHit) => {
    let idx = -1;
    let localT = 0.5;
    if (hit.edgeId) {
      const edge = mesh.edges.find((e) => e.id === hit.edgeId);
      if (edge) {
        for (let i = 0; i < n; i++) {
          if (ek(ring[i], ring[(i + 1) % n]) === ek(edge.v1Id, edge.v2Id)) {
            idx = i;
            const same = ring[i] === edge.v1Id && ring[(i + 1) % n] === edge.v2Id;
            localT = hit.t != null ? (same ? hit.t : 1 - hit.t) : 0.5;
            break;
          }
        }
      }
    }
    if (idx < 0) {
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const va = vertMap.get(ring[i])!;
        const vb = vertMap.get(ring[(i + 1) % n])!;
        const d = distPointSeg(hit.point, va, vb);
        if (d < best) {
          best = d;
          idx = i;
          localT = projectT(hit.point, va, vb);
        }
      }
    }
    const va = vertMap.get(ring[idx])!;
    const vb = vertMap.get(ring[(idx + 1) % n])!;
    const p = lerpV(va, vb, localT);
    const id = generateId();
    const v: Vertex = { id, x: p.x, y: p.y, z: p.z };
    newVertices.push(v);
    vertMap.set(id, v);
    return {
      vertId: id,
      insertAfter: idx,
      uv: lerpUV(uvs[idx], uvs[(idx + 1) % n], localT),
    };
  };

  const ha = resolveHit(hitA);
  const hb = resolveHit(hitB);
  if (ha.insertAfter === hb.insertAfter) return mesh;

  type Node = { id: string; uv: UVCoord };
  const nodes: Node[] = ring.map((id, i) => ({ id, uv: uvs[i] }));
  [ha, hb]
    .sort((x, y) => y.insertAfter - x.insertAfter)
    .forEach((ins) => {
      nodes.splice(ins.insertAfter + 1, 0, { id: ins.vertId, uv: ins.uv });
    });

  const idxA = nodes.findIndex((n) => n.id === ha.vertId);
  const idxB = nodes.findIndex((n) => n.id === hb.vertId);
  if (idxA < 0 || idxB < 0) return mesh;

  const walk = (from: number, to: number) => {
    const out: Node[] = [];
    let i = from;
    for (let s = 0; s <= nodes.length; s++) {
      out.push(nodes[i]);
      if (i === to) break;
      i = (i + 1) % nodes.length;
    }
    return out;
  };

  const poly1 = walk(idxA, idxB);
  const poly2 = walk(idxB, idxA);
  if (poly1.length < 3 || poly2.length < 3) return mesh;

  const f1: Face = {
    id: generateId(),
    vertexIds: poly1.map((p) => p.id),
    uvs: poly1.map((p) => p.uv),
    materialId: face.materialId,
    color: face.color,
  };
  const f2: Face = {
    id: generateId(),
    vertexIds: poly2.map((p) => p.id),
    uvs: poly2.map((p) => p.uv),
    materialId: face.materialId,
    color: face.color,
  };

  return finalizeEditableMesh({
    ...mesh,
    vertices: newVertices,
    faces: mesh.faces.filter((f) => f.id !== faceId).concat([f1, f2]),
  });
}

function sharedEdgeOfFaces(mesh: CADMesh, faceA: Face, faceB: Face): Edge | null {
  const keysA = new Set<string>();
  for (let i = 0; i < faceA.vertexIds.length; i++) {
    keysA.add(ek(faceA.vertexIds[i], faceA.vertexIds[(i + 1) % faceA.vertexIds.length]));
  }
  for (let i = 0; i < faceB.vertexIds.length; i++) {
    const a = faceB.vertexIds[i];
    const b = faceB.vertexIds[(i + 1) % faceB.vertexIds.length];
    const key = ek(a, b);
    if (keysA.has(key)) {
      return mesh.edges.find((e) => ek(e.v1Id, e.v2Id) === key) || null;
    }
  }
  return null;
}

function knifeSplitSegment(mesh: CADMesh, a: KnifeHit, b: KnifeHit): CADMesh {
  if (a.faceId === b.faceId) return splitFaceBetweenHits(mesh, a.faceId, a, b);

  const faceA = mesh.faces.find((f) => f.id === a.faceId);
  const faceB = mesh.faces.find((f) => f.id === b.faceId);
  if (!faceA || !faceB) return mesh;
  const shared = sharedEdgeOfFaces(mesh, faceA, faceB);
  if (!shared) return mesh;

  const va = mesh.vertices.find((v) => v.id === shared.v1Id)!;
  const vb = mesh.vertices.find((v) => v.id === shared.v2Id)!;
  // Project midpoint of segment onto shared edge
  const midPt = lerpV(a.point, b.point, 0.5);
  const t = projectT(midPt, va, vb);
  const point = lerpV(va, vb, t);
  const midA: KnifeHit = { faceId: a.faceId, edgeId: shared.id, t, point };
  const midB: KnifeHit = { faceId: b.faceId, edgeId: shared.id, t, point };

  let next = splitFaceBetweenHits(mesh, a.faceId, a, midA);
  // Face B may still exist
  if (next.faces.some((f) => f.id === b.faceId)) {
    next = splitFaceBetweenHits(next, b.faceId, midB, b);
  } else {
    const target = next.faces.find((f) => {
      const hasShared = f.vertexIds.includes(shared.v1Id) && f.vertexIds.includes(shared.v2Id);
      if (!hasShared) {
        // mid vert was inserted — find face near point and hit b
        return f.vertexIds.some((id) => {
          const v = next.vertices.find((vv) => vv.id === id);
          return v && Math.hypot(v.x - point.x, v.y - point.y, v.z - point.z) < 1e-5;
        });
      }
      return true;
    });
    if (target) next = splitFaceBetweenHits(next, target.id, { ...midB, faceId: target.id }, { ...b, faceId: target.id });
  }
  return next;
}

/** Knife-cut along a polyline of surface hits. */
export function applyKnifeCut(mesh: CADMesh, hits: KnifeHit[]): CADMesh {
  if (hits.length < 2) return mesh;
  let current = mesh;
  for (let i = 0; i < hits.length - 1; i++) {
    current = knifeSplitSegment(current, hits[i], hits[i + 1]);
  }
  return current;
}

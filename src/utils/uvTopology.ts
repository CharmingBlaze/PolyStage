import type { CADMesh, Face, UVCoord } from '../types/cad';

export type UvSelectionMode = 'vertex' | 'edge' | 'face' | 'island';
export type UvVertexId = string;
export type UvEdgeId = string;
export type UvFaceId = string;
export type UvIslandId = string;

export interface UvVertex {
  id: UvVertexId;
  meshVertexId: string;
  meshFaceId: string;
  cornerIndex: number;
  position: UVCoord;
  pinned: boolean;
}

export interface UvEdge {
  id: UvEdgeId;
  meshEdgeId: string | null;
  meshFaceId: string;
  cornerA: UvVertexId;
  cornerB: UvVertexId;
  boundary: boolean;
  seam: boolean;
}

export interface UvFace {
  id: UvFaceId;
  meshFaceId: string;
  uvVertexIds: UvVertexId[];
  materialId?: string;
}

export interface UvIsland {
  id: UvIslandId;
  uvFaceIds: UvFaceId[];
  uvVertexIds: UvVertexId[];
  boundaryUvEdgeIds: UvEdgeId[];
}

export interface UvTopology {
  vertices: Map<UvVertexId, UvVertex>;
  edges: Map<UvEdgeId, UvEdge>;
  faces: Map<UvFaceId, UvFace>;
  islands: Map<UvIslandId, UvIsland>;
  faceToIsland: Map<string, UvIslandId>;
}

export const uvVertexId = (faceId: string, corner: number) => `uvv:${faceId}:${corner}`;
export const uvEdgeId = (faceId: string, corner: number) => `uve:${faceId}:${corner}`;
const meshEdgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

function cornersWelded(a: Face, b: Face, shared: string[]) {
  return shared.every((vertexId) => {
    const ai = a.vertexIds.indexOf(vertexId);
    const bi = b.vertexIds.indexOf(vertexId);
    const auv = a.uvs[ai], buv = b.uvs[bi];
    return !!auv && !!buv && Math.hypot(auv.u - buv.u, auv.v - buv.v) < 1e-5;
  });
}

export function buildUvTopology(mesh: CADMesh): UvTopology {
  const vertices = new Map<UvVertexId, UvVertex>();
  const edges = new Map<UvEdgeId, UvEdge>();
  const faces = new Map<UvFaceId, UvFace>();
  const pinned = new Set(mesh.uvPinnedVertexIds || []);
  const meshEdges = new Map(mesh.edges.map((edge) => [meshEdgeKey(edge.v1Id, edge.v2Id), edge]));
  const edgeUseCount = new Map<string, number>();

  mesh.faces.forEach((face) => {
    const ids = face.vertexIds.map((meshVertexId, cornerIndex) => {
      const id = uvVertexId(face.id, cornerIndex);
      vertices.set(id, {
        id, meshVertexId, meshFaceId: face.id, cornerIndex,
        position: face.uvs[cornerIndex] || { u: 0, v: 0 },
        pinned: pinned.has(id),
      });
      return id;
    });
    faces.set(face.id, { id: face.id, meshFaceId: face.id, uvVertexIds: ids, materialId: face.materialId });
    face.vertexIds.forEach((a, corner) => {
      const b = face.vertexIds[(corner + 1) % face.vertexIds.length];
      const key = meshEdgeKey(a, b);
      edgeUseCount.set(key, (edgeUseCount.get(key) || 0) + 1);
    });
  });

  mesh.faces.forEach((face) => {
    face.vertexIds.forEach((a, corner) => {
      const b = face.vertexIds[(corner + 1) % face.vertexIds.length];
      const key = meshEdgeKey(a, b);
      const meshEdge = meshEdges.get(key);
      const id = uvEdgeId(face.id, corner);
      edges.set(id, {
        id,
        meshEdgeId: meshEdge?.id || null,
        meshFaceId: face.id,
        cornerA: uvVertexId(face.id, corner),
        cornerB: uvVertexId(face.id, (corner + 1) % face.vertexIds.length),
        boundary: (edgeUseCount.get(key) || 0) < 2,
        seam: !!meshEdge?.seam,
      });
    });
  });

  const neighbors = new Map<string, string[]>();
  mesh.faces.forEach((face) => neighbors.set(face.id, []));
  for (let i = 0; i < mesh.faces.length; i++) {
    for (let j = i + 1; j < mesh.faces.length; j++) {
      const a = mesh.faces[i], b = mesh.faces[j];
      const shared = a.vertexIds.filter((id) => b.vertexIds.includes(id));
      if (shared.length !== 2) continue;
      const edge = meshEdges.get(meshEdgeKey(shared[0], shared[1]));
      if (!edge?.seam && cornersWelded(a, b, shared)) {
        neighbors.get(a.id)!.push(b.id);
        neighbors.get(b.id)!.push(a.id);
      }
    }
  }

  const islands = new Map<UvIslandId, UvIsland>();
  const faceToIsland = new Map<string, UvIslandId>();
  const visited = new Set<string>();
  mesh.faces.forEach((seed) => {
    if (visited.has(seed.id)) return;
    const queue = [seed.id], faceIds: string[] = [];
    visited.add(seed.id);
    while (queue.length) {
      const id = queue.shift()!;
      faceIds.push(id);
      (neighbors.get(id) || []).forEach((next) => {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      });
    }
    const id = `uvi:${[...faceIds].sort().join('+')}`;
    const faceSet = new Set(faceIds);
    const vertexIds = faceIds.flatMap((faceId) => faces.get(faceId)?.uvVertexIds || []);
    const boundaryUvEdgeIds = [...edges.values()]
      .filter((edge) => faceSet.has(edge.meshFaceId) && (edge.boundary || edge.seam || isSplitUvEdge(mesh, edge)))
      .map((edge) => edge.id);
    islands.set(id, { id, uvFaceIds: faceIds, uvVertexIds: vertexIds, boundaryUvEdgeIds });
    faceIds.forEach((faceId) => faceToIsland.set(faceId, id));
  });

  return { vertices, edges, faces, islands, faceToIsland };
}

function isSplitUvEdge(mesh: CADMesh, edge: UvEdge) {
  const face = mesh.faces.find((f) => f.id === edge.meshFaceId);
  if (!face) return true;
  const aId = face.vertexIds[Number(edge.id.split(':').pop())];
  const corner = Number(edge.id.split(':').pop());
  const bId = face.vertexIds[(corner + 1) % face.vertexIds.length];
  const other = mesh.faces.find((f) => f.id !== face.id && f.vertexIds.includes(aId) && f.vertexIds.includes(bId));
  if (!other) return true;
  return !cornersWelded(face, other, [aId, bId]);
}

export function applyUvPositions(mesh: CADMesh, positions: Map<UvVertexId, UVCoord>): CADMesh {
  return {
    ...mesh,
    faces: mesh.faces.map((face) => ({
      ...face,
      uvs: face.uvs.map((uv, corner) => positions.get(uvVertexId(face.id, corner)) || uv),
    })),
  };
}

export function faceUvArea(face: Face) {
  let area = 0;
  for (let i = 0; i < face.uvs.length; i++) {
    const a = face.uvs[i], b = face.uvs[(i + 1) % face.uvs.length];
    area += a.u * b.v - b.u * a.v;
  }
  return area / 2;
}

export function faceWorldArea(mesh: CADMesh, face: Face) {
  const map = new Map(mesh.vertices.map((v) => [v.id, v]));
  const origin = map.get(face.vertexIds[0]);
  if (!origin) return 0;
  let area = 0;
  for (let i = 1; i < face.vertexIds.length - 1; i++) {
    const b = map.get(face.vertexIds[i]), c = map.get(face.vertexIds[i + 1]);
    if (!b || !c) continue;
    const ab = { x: b.x-origin.x, y: b.y-origin.y, z: b.z-origin.z };
    const ac = { x: c.x-origin.x, y: c.y-origin.y, z: c.z-origin.z };
    area += Math.hypot(
      ab.y*ac.z-ab.z*ac.y,
      ab.z*ac.x-ab.x*ac.z,
      ab.x*ac.y-ab.y*ac.x,
    ) / 2;
  }
  return area;
}

export function getDistortionByFace(mesh: CADMesh) {
  const ratios = mesh.faces.map((face) => Math.abs(faceUvArea(face)) / Math.max(1e-8, faceWorldArea(mesh, face)));
  const sorted = [...ratios].filter(Number.isFinite).sort((a, b) => a-b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return new Map(mesh.faces.map((face, i) => [face.id, Math.log2(Math.max(1e-8, ratios[i]) / median)]));
}

export function getOverlappingFaceIds(mesh: CADMesh) {
  const result = new Set<string>();
  const bounds = (face: Face) => ({
    minU: Math.min(...face.uvs.map((p) => p.u)), maxU: Math.max(...face.uvs.map((p) => p.u)),
    minV: Math.min(...face.uvs.map((p) => p.v)), maxV: Math.max(...face.uvs.map((p) => p.v)),
  });
  mesh.faces.forEach((a, i) => {
    const ab = bounds(a);
    mesh.faces.slice(i + 1).forEach((b) => {
      const bb = bounds(b);
      if (ab.minU < bb.maxU-1e-6 && ab.maxU > bb.minU+1e-6 && ab.minV < bb.maxV-1e-6 && ab.maxV > bb.minV+1e-6) {
        result.add(a.id); result.add(b.id);
      }
    });
  });
  return result;
}

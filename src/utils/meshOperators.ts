/**
 * Mode-aware mesh operators.
 *
 * Every operator is defined once and then *resolved* against whatever the user
 * has selected in Object / Vertex / Edge / Face mode.  This is how Blender
 * behaves: `E` extrudes edges in edge mode and regions in face mode, `F` fills a
 * vertex loop or an edge loop, `Ctrl+M` mirrors only the selected geometry, etc.
 *
 * The module is deliberately renderer-free.
 */
import type { CADMesh, Face, MirrorAxis, UVCoord, Vector3D } from '../types/cad';
import { generateId, makeEdgeId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';
import type { ComponentMode } from './selection';
import { buildTopologyIndex, edgesFullyInVertices, facesFullyInVertices, verticesOfEdges } from './selection';
import { bevelVertices } from './bevelOps';
import type { VertMover } from './modalMeshOps';

/** Selection snapshot in the shape the operators want. */
export interface MeshSelection {
  vertexIds: string[];
  edgeIds: string[];
  faceIds: string[];
}

/** A selection resolved into all three component domains. */
export interface OperatorTargets {
  faceIds: string[];
  edgeIds: string[];
  vertexIds: string[];
  mode: ComponentMode;
}

/** Topology-plus-movers result shared by the modal operators. */
export interface OperatorSession {
  mesh: CADMesh;
  movers: VertMover[];
  resultFaceIds: string[];
  resultVertexIds?: string[];
  resultEdgeIds?: string[];
}

export const edgeKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function axisCoord(v: Vector3D, axis: MirrorAxis): number {
  return axis === 'x' ? v.x : axis === 'y' ? v.y : v.z;
}

/** Newell normal of a polygon given its ordered corners. */
export function faceNormal(verts: Vector3D[]): Vector3D {
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
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function faceCentroid(verts: Vector3D[]): Vector3D {
  let x = 0;
  let y = 0;
  let z = 0;
  verts.forEach((v) => {
    x += v.x;
    y += v.y;
    z += v.z;
  });
  const inv = 1 / Math.max(1, verts.length);
  return { x: x * inv, y: y * inv, z: z * inv };
}

/** Faces whose every boundary edge is present in `edgeIds`. */
export function facesAllEdgesSelected(mesh: CADMesh, edgeIds: Iterable<string>): string[] {
  const keyById = new Map(mesh.edges.map((e) => [e.id, edgeKeyOf(e.v1Id, e.v2Id)]));
  const selectedKeys = new Set<string>();
  for (const id of edgeIds) {
    const key = keyById.get(id);
    if (key) selectedKeys.add(key);
  }
  return mesh.faces
    .filter((face) => {
      const n = face.vertexIds.length;
      if (n < 3) return false;
      for (let i = 0; i < n; i++) {
        if (!selectedKeys.has(edgeKeyOf(face.vertexIds[i], face.vertexIds[(i + 1) % n]))) return false;
      }
      return true;
    })
    .map((f) => f.id);
}

/**
 * Translate the active selection into the sets each operator needs.
 *
 * Widening follows Blender's contract rules: vertices imply the edges and faces
 * fully enclosed by them; edges imply a face only when *all* of that face's
 * edges are selected (so one edge never silently grabs a whole face for region
 * operations); faces imply their boundary edges and corners.
 */
export function resolveOperatorTargets(
  mesh: CADMesh,
  mode: ComponentMode,
  selection: MeshSelection,
): OperatorTargets {
  const liveVertex = new Set(mesh.vertices.map((v) => v.id));
  const liveEdge = new Set(mesh.edges.map((e) => e.id));
  const liveFace = new Set(mesh.faces.map((f) => f.id));

  if (mode === 'face') {
    const faceIds = selection.faceIds.filter((id) => liveFace.has(id));
    const index = buildTopologyIndex(mesh);
    const edgeIds = new Set<string>();
    const vertexIds = new Set<string>();
    faceIds.forEach((id) => {
      const face = index.faceById.get(id);
      if (!face) return;
      face.vertexIds.forEach((v) => vertexIds.add(v));
      const n = face.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const edge = index.edgeByKey.get(edgeKeyOf(face.vertexIds[i], face.vertexIds[(i + 1) % n]));
        if (edge) edgeIds.add(edge.id);
      }
    });
    return {
      faceIds,
      edgeIds: mesh.edges.filter((e) => edgeIds.has(e.id)).map((e) => e.id),
      vertexIds: mesh.vertices.filter((v) => vertexIds.has(v.id)).map((v) => v.id),
      mode,
    };
  }

  if (mode === 'edge') {
    const edgeIds = selection.edgeIds.filter((id) => liveEdge.has(id));
    return {
      faceIds: facesAllEdgesSelected(mesh, edgeIds),
      edgeIds,
      vertexIds: verticesOfEdges(mesh, edgeIds),
      mode,
    };
  }

  const vertexIds = selection.vertexIds.filter((id) => liveVertex.has(id));
  return {
    faceIds: facesFullyInVertices(mesh, vertexIds),
    edgeIds: edgesFullyInVertices(mesh, vertexIds),
    vertexIds,
    mode,
  };
}

// ————————————————————————————————————————————————————————————
// Extrude
// ————————————————————————————————————————————————————————————

/**
 * Blender `E` in edge/vertex mode: duplicate the selected edges and bridge each
 * one with a quad, so an open border grows a strip instead of a region cap.
 */
export function beginEdgeExtrude(mesh: CADMesh, edgeIds: string[]): OperatorSession | null {
  const targetEdges = mesh.edges.filter((e) => edgeIds.includes(e.id));
  if (targetEdges.length === 0) return null;

  const index = buildTopologyIndex(mesh);
  const vertById = new Map(mesh.vertices.map((v) => [v.id, v]));

  const newVertMap = new Map<string, string>();
  const newVertices = [...mesh.vertices];
  const movers: VertMover[] = [];

  const duplicateVertex = (vertexId: string): string | null => {
    const cached = newVertMap.get(vertexId);
    if (cached) return cached;
    const v = vertById.get(vertexId);
    if (!v) return null;
    const id = generateId();
    newVertMap.set(vertexId, id);
    newVertices.push({ ...v, id });
    // View-plane grab applies a uniform offset; keep a unit placeholder.
    movers.push({ id, ox: v.x, oy: v.y, oz: v.z, dx: 0, dy: 0, dz: 0 });
    return id;
  };

  const sideFaces: Face[] = [];
  targetEdges.forEach((edge) => {
    const top1 = duplicateVertex(edge.v1Id);
    const top2 = duplicateVertex(edge.v2Id);
    if (!top1 || !top2) return;
    // Match an adjacent face's winding so the new strip faces outward.
    const owner = (index.facesByEdgeKey.get(edgeKeyOf(edge.v1Id, edge.v2Id)) || [])[0];
    let a = edge.v1Id;
    let b = edge.v2Id;
    if (owner) {
      const n = owner.vertexIds.length;
      for (let i = 0; i < n; i++) {
        if (owner.vertexIds[i] === edge.v2Id && owner.vertexIds[(i + 1) % n] === edge.v1Id) {
          a = edge.v2Id;
          b = edge.v1Id;
          break;
        }
      }
    }
    const t1 = a === edge.v1Id ? top1 : top2;
    const t2 = a === edge.v1Id ? top2 : top1;
    sideFaces.push({
      id: generateId(),
      vertexIds: [a, b, t2, t1],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  });

  if (sideFaces.length === 0) return null;

  const built = finalizeEditableMesh(
    { ...mesh, vertices: newVertices, faces: [...mesh.faces, ...sideFaces] },
    { validate: false },
  );

  const resultEdgeIds = targetEdges
    .map((edge) => {
      const a = newVertMap.get(edge.v1Id);
      const b = newVertMap.get(edge.v2Id);
      if (!a || !b) return null;
      return makeEdgeId(a, b);
    })
    .filter((id): id is string => Boolean(id));

  return {
    mesh: built,
    movers,
    resultFaceIds: sideFaces.map((f) => f.id),
    resultVertexIds: [...newVertMap.values()],
    resultEdgeIds,
  };
}

/**
 * Blender vertex `E` (`extrude_vertices_move`): duplicate selected verts and
 * connect each to its original with a stem edge. Never creates faces.
 */
export function beginVertexExtrude(mesh: CADMesh, vertexIds: string[]): OperatorSession | null {
  const selected = new Set(vertexIds.filter((id) => mesh.vertices.some((v) => v.id === id)));
  if (selected.size === 0) return null;

  const vertById = new Map(mesh.vertices.map((v) => [v.id, v]));
  const newVertices = [...mesh.vertices];
  const movers: VertMover[] = [];
  const stemEdges: { id: string; v1Id: string; v2Id: string }[] = [];
  const newIds: string[] = [];
  selected.forEach((oldId) => {
    const v = vertById.get(oldId);
    if (!v) return;
    const id = generateId();
    newVertices.push({ ...v, id });
    movers.push({ id, ox: v.x, oy: v.y, oz: v.z, dx: 0, dy: 0, dz: 0 });
    stemEdges.push({ id: generateId(), v1Id: oldId, v2Id: id });
    newIds.push(id);
  });
  if (movers.length === 0) return null;
  const built = finalizeEditableMesh({ ...mesh, vertices: newVertices, faces: mesh.faces }, { validate: false });
  return {
    mesh: { ...built, edges: [...built.edges, ...stemEdges] },
    movers,
    resultFaceIds: [],
    resultVertexIds: newIds,
    resultEdgeIds: stemEdges.map((e) => e.id),
  };
}

// ————————————————————————————————————————————————————————————
// Bevel
// ————————————————————————————————————————————————————————————

/**
 * Vertex bevel (`Ctrl+Shift+B`): replace each selected corner with an n-gon
 * whose vertices slide along the incident edges — not a full edge chamfer.
 */
export function beginVertexBevel(
  mesh: CADMesh,
  vertexIds: string[],
  segments = 1,
): OperatorSession | null {
  const segs = Math.max(1, Math.min(8, Math.round(segments)));
  const beveled = bevelVertices(mesh, vertexIds, 0, segs);
  if (beveled.movers.length === 0) return null;
  return {
    mesh: beveled.mesh,
    movers: beveled.movers,
    resultFaceIds: beveled.stripFaceIds,
  };
}

// ————————————————————————————————————————————————————————————
// Subdivide
// ————————————————————————————————————————————————————————————

interface ExpandedRing {
  ids: string[];
  uvs: UVCoord[];
  /** Indices of inserted edge midpoints inside `ids`. */
  inserted: number[];
}

/** Walk `ids` from `from` to `to` inclusive, wrapping around. */
function walkRing(ids: string[], from: number, to: number): number[] {
  const out: number[] = [];
  let i = from;
  for (let guard = 0; guard <= ids.length; guard++) {
    out.push(i);
    if (i === to) break;
    i = (i + 1) % ids.length;
  }
  return out;
}

function polygonFrom(ring: ExpandedRing, indices: number[], face: Face): Face {
  return {
    id: generateId(),
    vertexIds: indices.map((i) => ring.ids[i]),
    uvs: indices.map((i) => ({ ...ring.uvs[i] })),
    materialId: face.materialId,
    color: face.color,
  };
}

/**
 * Blender `Subdivide`.
 *
 * Faces whose every edge is selected get the classic quad/triangle fan (each
 * corner, its two edge midpoints and the face centre). Faces with only some
 * edges selected split across the new midpoints, so subdividing one edge of a
 * quad yields a triangle plus a quad, exactly like Blender.
 *
 * Midpoints are shared between neighbouring faces, so the result stays watertight.
 */
export function subdivideTargets(mesh: CADMesh, targets: OperatorTargets, cuts = 1): CADMesh {
  const targetEdge = new Set(targets.edgeIds);
  let keys = new Set<string>();
  mesh.edges.forEach((e) => {
    if (targetEdge.has(e.id)) keys.add(edgeKeyOf(e.v1Id, e.v2Id));
  });
  if (keys.size === 0) return mesh;

  // In face mode only the chosen faces are split; neighbours that merely share a
  // split edge absorb the new midpoint and become n-gons (exactly like Blender).
  const faceTargets = targets.mode === 'face' ? new Set(targets.faceIds) : null;

  let current = mesh;
  const passes = Math.max(1, Math.min(8, Math.round(cuts)));
  for (let pass = 0; pass < passes; pass++) {
    if (keys.size === 0) break;
    const result = subdivideOnce(current, keys, faceTargets);
    current = result.mesh;
    keys = result.nextKeys;
  }
  return current;
}

function subdivideOnce(
  mesh: CADMesh,
  selectedKeys: Set<string>,
  faceTargets: Set<string> | null,
): { mesh: CADMesh; nextKeys: Set<string> } {
  const vertById = new Map(mesh.vertices.map((v) => [v.id, v]));
  const newVertices = [...mesh.vertices];
  const midpoint = new Map<string, string>();
  const nextKeys = new Set<string>();

  const getMidpoint = (a: string, b: string): string => {
    const key = edgeKeyOf(a, b);
    const cached = midpoint.get(key);
    if (cached) return cached;
    const va = vertById.get(a);
    const vb = vertById.get(b);
    const id = generateId();
    if (va && vb) {
      const vert = { id, x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, z: (va.z + vb.z) / 2 };
      newVertices.push(vert);
      vertById.set(id, vert);
    }
    midpoint.set(key, id);
    nextKeys.add(edgeKeyOf(a, id));
    nextKeys.add(edgeKeyOf(id, b));
    return id;
  };

  const out: Face[] = [];

  /** Grow a face ring by inserting a midpoint on every selected edge. */
  const expandRing = (face: Face): ExpandedRing => {
    const ring: ExpandedRing = { ids: [], uvs: [], inserted: [] };
    const count = face.vertexIds.length;
    for (let i = 0; i < count; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % count];
      const ua = face.uvs[i] ?? { u: 0, v: 0 };
      const ub = face.uvs[(i + 1) % count] ?? ua;
      ring.ids.push(a);
      ring.uvs.push({ ...ua });
      if (selectedKeys.has(edgeKeyOf(a, b))) {
        ring.ids.push(getMidpoint(a, b));
        ring.uvs.push({ u: (ua.u + ub.u) / 2, v: (ua.v + ub.v) / 2 });
        ring.inserted.push(ring.ids.length - 1);
      }
    }
    return ring;
  };

  mesh.faces.forEach((face) => {
    const n = face.vertexIds.length;
    if (n < 3) {
      out.push(face);
      return;
    }

    const selectedIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (selectedKeys.has(edgeKeyOf(face.vertexIds[i], face.vertexIds[(i + 1) % n]))) selectedIdx.push(i);
    }
    if (selectedIdx.length === 0) {
      out.push(face);
      return;
    }

    if (selectedIdx.length === n) {
      // Full subdivide: corner -> next midpoint -> centre -> previous midpoint.
      const corners = face.vertexIds.map((id) => vertById.get(id)).filter(Boolean) as Vector3D[];
      const c = faceCentroid(corners);
      const centerId = generateId();
      newVertices.push({ id: centerId, x: c.x, y: c.y, z: c.z });
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const prev = (i + n - 1) % n;
        const u0 = face.uvs[i] ?? { u: 0, v: 0 };
        const uNext = face.uvs[next] ?? { u: 1, v: 0 };
        const uPrev = face.uvs[prev] ?? { u: 0, v: 1 };
        out.push({
          id: generateId(),
          vertexIds: [
            face.vertexIds[i],
            getMidpoint(face.vertexIds[i], face.vertexIds[next]),
            centerId,
            getMidpoint(face.vertexIds[prev], face.vertexIds[i]),
          ],
          uvs: [
            { ...u0 },
            { u: (u0.u + uNext.u) / 2, v: (u0.v + uNext.v) / 2 },
            { u: (u0.u + uNext.u + uPrev.u) / 3, v: (u0.v + uNext.v + uPrev.v) / 3 },
            { u: (u0.u + uPrev.u) / 2, v: (u0.v + uPrev.v) / 2 },
          ],
          materialId: face.materialId,
          color: face.color,
        });
      }
      return;
    }

    // Blender keeps neighbouring faces whole: they absorb the new midpoint and
    // simply gain a corner (a 5-gon in the classic single-face subdivide).
    if (faceTargets && !faceTargets.has(face.id)) {
      const absorbed = expandRing(face);
      out.push(polygonFrom(absorbed, absorbed.ids.map((_, i) => i), face));
      return;
    }

    // Partial subdivide: expand the ring with the new midpoints, then split it.
    const ring = expandRing(face);

    const k = ring.inserted.length;
    const size = ring.ids.length;

    if (k === 1) {
      // Blender: one cut connects the midpoint to the opposite corner.
      const idx = ring.inserted[0];
      const opposite = (idx + Math.floor(size / 2)) % size;
      out.push(polygonFrom(ring, walkRing(ring.ids, idx, opposite), face));
      out.push(polygonFrom(ring, walkRing(ring.ids, opposite, idx), face));
      return;
    }

    if (k === 2) {
      // Two cuts: join the midpoints, which is what a loop cut produces.
      const [i0, i1] = ring.inserted;
      out.push(polygonFrom(ring, walkRing(ring.ids, i0, i1), face));
      out.push(polygonFrom(ring, walkRing(ring.ids, i1, i0), face));
      return;
    }

    // Three or more cuts: fan each arc back to a fresh face centre.
    const corners = face.vertexIds.map((id) => vertById.get(id)).filter(Boolean) as Vector3D[];
    const c = faceCentroid(corners);
    const centerId = generateId();
    newVertices.push({ id: centerId, x: c.x, y: c.y, z: c.z });
    for (let i = 0; i < k; i++) {
      const arc = walkRing(ring.ids, ring.inserted[i], ring.inserted[(i + 1) % k]);
      out.push({
        ...polygonFrom(ring, arc, face),
        id: generateId(),
        vertexIds: [...arc.map((idx) => ring.ids[idx]), centerId],
        uvs: [...arc.map((idx) => ({ ...ring.uvs[idx] })), { u: c.x, v: c.z }],
      });
    }
  });

  return { mesh: finalizeEditableMesh({ ...mesh, vertices: newVertices, faces: out }, { validate: false }), nextKeys };
}

// ————————————————————————————————————————————————————————————
// Fill (F)
// ————————————————————————————————————————————————————————————

/** Order the supplied edges into closed vertex rings. Open chains are dropped. */
export function orderEdgeLoops(mesh: CADMesh, edgeIds: string[]): string[][] {
  const wanted = new Set(edgeIds);
  const edges = mesh.edges.filter((e) => wanted.has(e.id));
  if (edges.length < 3) return [];

  const adjacency = new Map<string, string[]>();
  const push = (from: string, to: string) => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };
  edges.forEach((e) => {
    push(e.v1Id, e.v2Id);
    push(e.v2Id, e.v1Id);
  });

  const visited = new Set<string>();
  const rings: string[][] = [];

  edges.forEach((start) => {
    if (visited.has(edgeKeyOf(start.v1Id, start.v2Id))) return;
    const ring: string[] = [start.v1Id, start.v2Id];
    visited.add(edgeKeyOf(start.v1Id, start.v2Id));
    let prev = start.v1Id;
    let cur = start.v2Id;
    let closed = false;

    for (let guard = 0; guard <= edges.length; guard++) {
      const nextCandidates = (adjacency.get(cur) || []).filter((n) => n !== prev);
      if (nextCandidates.length === 0) break;
      const next = nextCandidates[0];
      const key = edgeKeyOf(cur, next);
      if (visited.has(key)) {
        if (next === ring[0]) closed = true;
        break;
      }
      visited.add(key);
      if (next === ring[0]) {
        closed = true;
        break;
      }
      ring.push(next);
      prev = cur;
      cur = next;
    }

    if (closed && ring.length >= 3) rings.push(ring);
  });

  return rings;
}

/** Edges touched by exactly one face (the mesh's open borders). */
export function boundaryEdgeIds(mesh: CADMesh): string[] {
  const use = new Map<string, number>();
  mesh.faces.forEach((face) => {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const key = edgeKeyOf(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      use.set(key, (use.get(key) || 0) + 1);
    }
  });
  return mesh.edges.filter((e) => (use.get(edgeKeyOf(e.v1Id, e.v2Id)) || 0) === 1).map((e) => e.id);
}

function addFaceFromRing(mesh: CADMesh, ring: string[]): CADMesh {
  if (ring.length < 3) return mesh;
  const signature = [...ring].sort().join('|');
  const exists = mesh.faces.some(
    (f) => f.vertexIds.length === ring.length && [...f.vertexIds].sort().join('|') === signature,
  );
  if (exists) return mesh;
  const live = new Set(mesh.vertices.map((v) => v.id));
  if (!ring.every((id) => live.has(id))) return mesh;

  const face: Face = {
    id: generateId(),
    vertexIds: [...ring],
    uvs: ring.map((_, i) => {
      const angle = (i / ring.length) * Math.PI * 2;
      return { u: (Math.cos(angle) + 1) / 2, v: (Math.sin(angle) + 1) / 2 };
    }),
  };
  return finalizeEditableMesh({ ...mesh, faces: [...mesh.faces, face] }, { validate: false });
}

/**
 * Blender `F`.
 *
 * - Vertex mode: build one n-gon from the selected corners.
 * - Edge mode: fill every closed loop formed by the selected edges.
 * - Face mode: close the holes bounded by the selected faces (or every hole when
 *   nothing is selected), which is Blender's "fill holes" behaviour.
 */
export function fillTargets(mesh: CADMesh, targets: OperatorTargets, mode: ComponentMode): CADMesh {
  if (mode === 'vertex') {
    if (targets.vertexIds.length < 3) return mesh;
    return addFaceFromRing(mesh, targets.vertexIds);
  }

  if (mode === 'edge') {
    const rings = orderEdgeLoops(mesh, targets.edgeIds);
    let current = mesh;
    rings.forEach((ring) => {
      current = addFaceFromRing(current, ring);
    });
    // No closed loop: fall back to an n-gon from the corner set (Blender F on a
    // path of 3+ connected edges still creates a face when they are coplanar).
    if (rings.length === 0 && targets.vertexIds.length >= 3) {
      current = addFaceFromRing(current, targets.vertexIds);
    }
    return current;
  }

  let edges = boundaryEdgeIds(mesh);
  if (targets.faceIds.length > 0) {
    const selectedFaces = new Set(targets.faceIds);
    const allowed = new Set<string>();
    mesh.faces.forEach((face) => {
      if (!selectedFaces.has(face.id)) return;
      const n = face.vertexIds.length;
      for (let i = 0; i < n; i++) allowed.add(edgeKeyOf(face.vertexIds[i], face.vertexIds[(i + 1) % n]));
    });
    edges = edges.filter((id) => {
      const edge = mesh.edges.find((e) => e.id === id);
      return edge ? allowed.has(edgeKeyOf(edge.v1Id, edge.v2Id)) : false;
    });
  }

  let current = mesh;
  orderEdgeLoops(mesh, edges).forEach((ring) => {
    current = addFaceFromRing(current, ring);
  });
  return current;
}

// ————————————————————————————————————————————————————————————
// Mirror (Ctrl+M)
// ————————————————————————————————————————————————————————————

/**
 * Blender `Ctrl+M`: duplicate only the selected faces mirrored across the axis,
 * welding vertices that sit on the mirror plane so the shell stays connected.
 *
 * Faces whose mirror image already exists are skipped, which keeps the operation
 * idempotent instead of stacking coincident geometry.
 */
export function mirrorTargets(
  mesh: CADMesh,
  axis: MirrorAxis,
  targets: OperatorTargets,
  options: { mergeThreshold?: number } = {},
): CADMesh {
  const threshold = options.mergeThreshold ?? 0.001;
  const selected = new Set(targets.faceIds);
  if (selected.size === 0) return mesh;

  const vertices = mesh.vertices.map((v) => ({ ...v }));
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const idMap = new Map<string, string>();
  const involved = new Set<string>();
  mesh.faces.forEach((f) => {
    if (selected.has(f.id)) f.vertexIds.forEach((id) => involved.add(id));
  });

  involved.forEach((id) => {
    const v = byId.get(id);
    if (!v) return;
    const coord = axisCoord(v, axis);
    if (Math.abs(coord) <= threshold) {
      // Snap to the plane and reuse the original vertex (Blender's Clip + Merge).
      if (axis === 'x') v.x = 0;
      else if (axis === 'y') v.y = 0;
      else v.z = 0;
      idMap.set(id, id);
      return;
    }
    const mirrored = { ...v, id: generateId() };
    if (axis === 'x') mirrored.x = -v.x;
    else if (axis === 'y') mirrored.y = -v.y;
    else mirrored.z = -v.z;
    vertices.push(mirrored);
    byId.set(mirrored.id, mirrored);
    idMap.set(id, mirrored.id);
  });

  const faceSignature = (ids: string[]) => [...ids].sort().join('|');

  // Real mirrors always mint new vertex ids, so id-based signatures never block
  // a legitimate copy. They only skip faces that are entirely on the mirror
  // plane, whose mirror image would be the very same face.
  const signatures = new Set(mesh.faces.map((f) => faceSignature(f.vertexIds)));
  const mirroredFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    if (!selected.has(face.id)) return;
    const mapped = face.vertexIds.map((id) => idMap.get(id));
    if (mapped.some((id) => !id)) return;
    const ids = mapped as string[];
    if (new Set(ids).size < 3) return;
    const signature = faceSignature(ids);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    mirroredFaces.push({
      ...face,
      id: generateId(),
      vertexIds: [...ids].reverse(),
      uvs: [...face.uvs].reverse().map((uv) => ({ ...uv })),
    });
  });

  if (mirroredFaces.length === 0) return mesh;

  return finalizeEditableMesh(
    { ...mesh, vertices, faces: [...mesh.faces, ...mirroredFaces] },
    { validate: false },
  );
}
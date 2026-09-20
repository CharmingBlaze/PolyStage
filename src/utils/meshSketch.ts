/**
 * Headless Mesh Sketch SDK.
 *
 * This module deliberately has no React, DOM, or Three.js dependencies. UI layers
 * provide world/local coordinates and consume the returned immutable deltas.
 */
import type { CADMesh, Vertex } from '../types/cad';
import { generateId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';
import type { Vec3 } from './primitiveDraw';
import { vecAdd } from './primitiveDraw';
import {
  penAddPoint,
  penCommitActive,
  penConnectExisting,
  penDropActive,
  penMovePoint,
  penSessionToMesh,
  validatePenLoop,
  type PenPatch,
  type PenPoint,
  type PenSession,
} from './penTool';

export interface MeshSketchDelta {
  createdVertices: string[];
  createdEdges: string[];
  createdFaces: string[];
  removedElements: string[];
  selectionChanges: string[];
  warnings: string[];
  errors: string[];
}

export interface MeshSketchResult<T> extends MeshSketchDelta {
  value: T;
}

const result = <T>(value: T, patch: Partial<MeshSketchDelta> = {}): MeshSketchResult<T> => ({
  value,
  createdVertices: [],
  createdEdges: [],
  createdFaces: [],
  removedElements: [],
  selectionChanges: [],
  warnings: [],
  errors: [],
  ...patch,
});

export function createSketchVertex(session: PenSession, position: Vec3, meshVertexId?: string): MeshSketchResult<PenSession> {
  const next = penAddPoint(session, position, meshVertexId ? { meshVertexId } : {});
  const created = next.points.length > session.points.length ? next.points[next.points.length - 1]?.id : undefined;
  return result(next, { createdVertices: created ? [created] : [], selectionChanges: next.currentPointId ? [next.currentPointId] : [] });
}

export function moveSketchVertex(session: PenSession, pointId: string, position: Vec3): MeshSketchResult<PenSession> {
  if (!session.points.some((point) => point.id === pointId)) return result(session, { errors: ['Vertex not found.'] });
  return result(penMovePoint(session, pointId, position), { selectionChanges: [pointId] });
}

export function connectSketchVertices(session: PenSession, pointId: string): MeshSketchResult<PenSession> {
  const before = session.patches.length;
  const next = penConnectExisting(session, pointId);
  return result(next, {
    createdEdges: next === session ? [] : [`${session.currentPointId ?? 'start'}:${pointId}`],
    createdFaces: next.patches.length > before ? [next.patches[next.patches.length - 1].id] : [],
    warnings: next === session ? ['That connection already exists or would be invalid.'] : [],
  });
}

/** Split a logical mesh edge and insert the new vertex into every incident face loop. */
export function splitSketchEdge(mesh: CADMesh, edgeId: string, localPosition: Vec3): MeshSketchResult<CADMesh> {
  const edge = mesh.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return result(mesh, { errors: ['Edge not found.'] });
  const vertex: Vertex = { id: generateId(), x: localPosition.x, y: localPosition.y, z: localPosition.z };
  const faces = mesh.faces.map((face) => {
    const ids = [...face.vertexIds];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      if ((a === edge.v1Id && b === edge.v2Id) || (a === edge.v2Id && b === edge.v1Id)) {
        ids.splice(i + 1, 0, vertex.id);
        const uva = face.uvs[i] ?? { u: 0, v: 0 };
        const uvb = face.uvs[(i + 1) % face.uvs.length] ?? uva;
        return { ...face, vertexIds: ids, uvs: [...face.uvs.slice(0, i + 1), { u: (uva.u + uvb.u) / 2, v: (uva.v + uvb.v) / 2 }, ...face.uvs.slice(i + 1)] };
      }
    }
    return face;
  });
  return result(finalizeEditableMesh({ ...mesh, vertices: [...mesh.vertices, vertex], faces }, { validate: false }), {
    createdVertices: [vertex.id], removedElements: [edgeId], selectionChanges: [vertex.id],
  });
}

export function previewSketchFace(session: PenSession): MeshSketchResult<PenSession> {
  const validation = validatePenLoop(session);
  return result({ ...session, state: 'PreviewingFace', warning: validation.warnings[0] ?? null }, {
    warnings: validation.warnings,
    errors: validation.valid ? [] : validation.warnings,
  });
}

export function createSketchFace(session: PenSession): MeshSketchResult<PenSession> {
  const before = session.patches.length;
  const next = penCommitActive(session);
  return result(next, {
    createdFaces: next.patches.length > before ? [next.patches[next.patches.length - 1].id] : [],
    errors: next.patches.length === before && next.warning ? [next.warning] : [],
  });
}

/** Extrude the active closed profile, producing a cap and one quad per boundary edge. */
export function extrudeSketchProfile(session: PenSession, offset: Vec3): MeshSketchResult<PenSession> {
  const validation = validatePenLoop(session);
  if (!validation.valid) return result(session, { errors: validation.warnings });
  const source = [...session.activeIds];
  const pointMap = new Map<string, string>();
  const added: PenPoint[] = source.map((id) => {
    const sourcePoint = session.points.find((point) => point.id === id)!;
    const point = { id: generateId(), position: vecAdd(sourcePoint.position, offset) };
    pointMap.set(id, point.id);
    return point;
  });
  const topIds = source.map((id) => pointMap.get(id)!);
  const patches: PenPatch[] = source.map((id, index) => ({
    id: generateId(), kind: 'quad', closed: true,
    pointIds: [id, source[(index + 1) % source.length], topIds[(index + 1) % source.length], topIds[index]],
  }));
  const cap: PenPatch = { id: generateId(), kind: 'polygon', closed: true, pointIds: topIds };
  const next: PenSession = { ...session, points: [...session.points, ...added], patches: [...session.patches, ...patches, cap], activeIds: [], state: 'Confirming', warning: null };
  return result(next, { createdVertices: added.map((point) => point.id), createdFaces: [...patches.map((patch) => patch.id), cap.id] });
}

export function createQuadStrip(session: PenSession, positions: Vec3[]): MeshSketchResult<PenSession> {
  let next: PenSession = { ...session, settings: { ...session.settings, type: 'polygons', makeQuads: true, faceMode: 'quad' }, state: 'DrawingQuadStrip' };
  positions.forEach((position) => { next = penAddPoint(next, position); });
  return result(next, {
    createdVertices: next.points.slice(session.points.length).map((point) => point.id),
    createdFaces: next.patches.slice(session.patches.length).map((patch) => patch.id),
  });
}

export function validateSketchTopology(mesh: CADMesh): MeshSketchResult<CADMesh> {
  const errors: string[] = [];
  const vertexIds = new Set(mesh.vertices.map((vertex) => vertex.id));
  mesh.edges.forEach((edge) => {
    if (edge.v1Id === edge.v2Id) errors.push(`Edge ${edge.id} has zero length.`);
    if (!vertexIds.has(edge.v1Id) || !vertexIds.has(edge.v2Id)) errors.push(`Edge ${edge.id} references a missing vertex.`);
    if ((edge.faceIds?.length ?? 0) > 2) errors.push(`Edge ${edge.id} is non-manifold.`);
  });
  mesh.faces.forEach((face) => {
    if (new Set(face.vertexIds).size < 3) errors.push(`Face ${face.id} is degenerate.`);
  });
  return result(mesh, { errors });
}

export function commitSketchOperation(baseMesh: CADMesh, session: PenSession): MeshSketchResult<CADMesh> {
  const committed = session.activeIds.length ? penCommitActive(session) : session;
  if (committed.warning && committed.activeIds.length) return result(baseMesh, { errors: [committed.warning] });
  const output = penSessionToMesh(baseMesh, committed);
  return result(output.mesh, { createdVertices: output.vertexIds, createdFaces: output.faceIds });
}

export function cancelSketchOperation(session: PenSession): MeshSketchResult<PenSession> {
  return result({ ...penDropActive(session), state: 'Cancelled' });
}

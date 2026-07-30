import type { CADMesh, Face, Vertex, Edge, Vector3D } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { insetFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';
import { findEdgeLoop, applyLoopCut } from './meshCutTools';

/**
 * Subdivide selected faces (or all faces if targetFaceIds is empty) into 4 sub-quads.
 * Computes edge midpoints and face centroids for clean Blockbench / Blender style quad subdivision.
 */
export function subdivideFaces(mesh: CADMesh, targetFaceIds: string[] = []): CADMesh {
  const facesToSubdivide = targetFaceIds.length > 0
    ? mesh.faces.filter((f) => targetFaceIds.includes(f.id))
    : mesh.faces;

  if (facesToSubdivide.length === 0) return mesh;

  const targetSet = new Set(facesToSubdivide.map((f) => f.id));
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  // 1. Edge midpoints cache
  const edgeMidpointMap = new Map<string, string>(); // edgeKey -> newVertId
  const newVertices: Vertex[] = [...mesh.vertices];

  const getEdgeKey = (v1: string, v2: string) => (v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`);

  const getOrCreateEdgeMidpoint = (v1Id: string, v2Id: string): string => {
    const key = getEdgeKey(v1Id, v2Id);
    const cached = edgeMidpointMap.get(key);
    if (cached) return cached;

    const v1 = vertMap.get(v1Id);
    const v2 = vertMap.get(v2Id);
    if (!v1 || !v2) return v1Id;

    const newId = generateId();
    const midVert: Vertex = {
      id: newId,
      x: (v1.x + v2.x) / 2,
      y: (v1.y + v2.y) / 2,
      z: (v1.z + v2.z) / 2,
    };
    newVertices.push(midVert);
    vertMap.set(newId, midVert);
    edgeMidpointMap.set(key, newId);
    return newId;
  };

  const newFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    if (!targetSet.has(face.id) || face.vertexIds.length < 3) {
      newFaces.push(face);
      return;
    }

    const n = face.vertexIds.length;
    // Calculate centroid
    let cx = 0, cy = 0, cz = 0;
    const fVerts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    fVerts.forEach((v) => {
      cx += v.x;
      cy += v.y;
      cz += v.z;
    });
    cx /= fVerts.length;
    cy /= fVerts.length;
    cz /= fVerts.length;

    const centerVertId = generateId();
    const centerVert: Vertex = { id: centerVertId, x: cx, y: cy, z: cz };
    newVertices.push(centerVert);
    vertMap.set(centerVertId, centerVert);

    // Get midpoints for all boundary edges
    const midIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const v1Id = face.vertexIds[i];
      const v2Id = face.vertexIds[(i + 1) % n];
      midIds.push(getOrCreateEdgeMidpoint(v1Id, v2Id));
    }

    // Split face into n quad/tri sub-polygons
    for (let i = 0; i < n; i++) {
      const corner = face.vertexIds[i];
      const prevMid = midIds[(i + n - 1) % n];
      const nextMid = midIds[i];

      const u0 = face.uvs[i] || { u: 0, v: 0 };
      const uNext = face.uvs[(i + 1) % n] || { u: 1, v: 0 };
      const uPrev = face.uvs[(i + n - 1) % n] || { u: 0, v: 1 };
      const uCenter = { u: (u0.u + uNext.u + uPrev.u) / 3, v: (u0.v + uNext.v + uPrev.v) / 3 };

      newFaces.push({
        id: generateId(),
        vertexIds: [corner, nextMid, centerVertId, prevMid],
        uvs: [
          u0,
          { u: (u0.u + uNext.u) / 2, v: (u0.v + uNext.v) / 2 },
          uCenter,
          { u: (u0.u + uPrev.u) / 2, v: (u0.v + uPrev.v) / 2 },
        ],
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

/**
 * Merges selected vertices using specified mode ('center', 'first', 'last', 'distance').
 */
export function mergeSelectedVertices(
  mesh: CADMesh,
  selectedVertexIds: string[],
  mode: 'center' | 'first' | 'last' | 'distance' = 'center',
  distanceThreshold = 0.05
): CADMesh {
  if (selectedVertexIds.length < 2 && mode !== 'distance') return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const targetVerts = selectedVertexIds.map((id) => vertMap.get(id)!).filter(Boolean);

  if (targetVerts.length < 2 && mode !== 'distance') return mesh;

  const idRemap = new Map<string, string>();
  let newVertices = [...mesh.vertices];

  if (mode === 'center') {
    let cx = 0, cy = 0, cz = 0;
    targetVerts.forEach((v) => {
      cx += v.x; cy += v.y; cz += v.z;
    });
    cx /= targetVerts.length;
    cy /= targetVerts.length;
    cz /= targetVerts.length;

    const mergedVertId = targetVerts[0].id;
    // Update first vertex position to centroid
    newVertices = newVertices.map((v) =>
      v.id === mergedVertId ? { ...v, x: cx, y: cy, z: cz } : v
    );

    targetVerts.forEach((v) => idRemap.set(v.id, mergedVertId));
  } else if (mode === 'first') {
    const targetId = targetVerts[0].id;
    targetVerts.forEach((v) => idRemap.set(v.id, targetId));
  } else if (mode === 'last') {
    const targetId = targetVerts[targetVerts.length - 1].id;
    targetVerts.forEach((v) => idRemap.set(v.id, targetId));
  } else if (mode === 'distance') {
    for (let i = 0; i < newVertices.length; i++) {
      const v1 = newVertices[i];
      if (idRemap.has(v1.id)) continue;
      idRemap.set(v1.id, v1.id);
      for (let j = i + 1; j < newVertices.length; j++) {
        const v2 = newVertices[j];
        if (idRemap.has(v2.id)) continue;
        const dist = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
        if (dist <= distanceThreshold) {
          idRemap.set(v2.id, v1.id);
        }
      }
    }
  }

  // Remove vertices that were merged away
  const keepIds = new Set(Array.from(idRemap.values()));
  const finalVertices = newVertices.filter((v) => keepIds.has(v.id) || !idRemap.has(v.id));

  // Remap face vertex IDs and collapse degenerate faces
  const newFaces: Face[] = mesh.faces
    .map((f) => {
      const remappedVIds = f.vertexIds.map((id) => idRemap.get(id) || id);
      // Remove adjacent duplicate vertices
      const deduppedVIds: string[] = [];
      const deduppedUVs = [];
      for (let i = 0; i < remappedVIds.length; i++) {
        const current = remappedVIds[i];
        const next = remappedVIds[(i + 1) % remappedVIds.length];
        if (current !== next) {
          deduppedVIds.push(current);
          deduppedUVs.push(f.uvs[i] || { u: 0, v: 0 });
        }
      }
      if (deduppedVIds.length < 3) return null;
      return {
        ...f,
        vertexIds: deduppedVIds,
        uvs: deduppedUVs,
      };
    })
    .filter((f): f is Face => f !== null);

  return finalizeEditableMesh({
    ...mesh,
    vertices: finalVertices,
    faces: newFaces,
  });
}

/**
 * Connect selected 3+ vertices to form a new polygon face (Blender F / F2 key behavior).
 */
export function fillSelectedVerticesFace(mesh: CADMesh, selectedVertexIds: string[]): CADMesh {
  if (selectedVertexIds.length < 3) return mesh;

  // Check if a face with these exact vertex IDs already exists
  const targetSet = new Set(selectedVertexIds);
  const exists = mesh.faces.some((f) =>
    f.vertexIds.length === selectedVertexIds.length && f.vertexIds.every((vId) => targetSet.has(vId))
  );

  if (exists) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const fVerts = selectedVertexIds.map((id) => vertMap.get(id)!).filter(Boolean);

  if (fVerts.length < 3) return mesh;

  const defaultUVs = fVerts.map((_, i) => {
    const angle = (i / fVerts.length) * Math.PI * 2;
    return {
      u: (Math.cos(angle) + 1) / 2,
      v: (Math.sin(angle) + 1) / 2,
    };
  });

  const newFace: Face = {
    id: generateId(),
    vertexIds: [...selectedVertexIds],
    uvs: defaultUVs,
  };

  return finalizeEditableMesh({
    ...mesh,
    faces: [...mesh.faces, newFace],
  });
}

/**
 * Loop Cut: Inserts an edge loop across quad faces (Blender-style).
 * Prefer interactive modal via meshCutTools; this remains a one-shot helper.
 */
export function loopCutMesh(mesh: CADMesh, targetEdgeId?: string, factors: number[] = [0.5]): CADMesh {
  if (!targetEdgeId) return subdivideFaces(mesh);
  const loop = findEdgeLoop(mesh, targetEdgeId);
  if (loop.length === 0) return subdivideFaces(mesh);
  return applyLoopCut(mesh, loop, factors);
}

/**
 * Bevel selected edges. Amount (0–0.45) controls chamfer size like Blender's modal bevel.
 * Implementation: inset all faces that touch the selected edges by `amount`.
 */
export function bevelSelectedEdges(mesh: CADMesh, edgeIds: string[], amount = 0.1): CADMesh {
  if (edgeIds.length === 0) return mesh;

  const targetEdges = mesh.edges.filter((e) => edgeIds.includes(e.id));
  if (targetEdges.length === 0) return mesh;

  const t = Math.max(0.002, Math.min(0.45, amount));
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const selectedKeys = new Set(
    targetEdges.map((e) => edgeKey(e.v1Id, e.v2Id)),
  );

  const affectedFaceIds: string[] = [];
  mesh.faces.forEach((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % n];
      if (selectedKeys.has(edgeKey(a, b))) {
        affectedFaceIds.push(f.id);
        return;
      }
    }
  });

  if (affectedFaceIds.length === 0) return mesh;

  // Prefer true edge chamfer strips when a single edge is selected; else region inset.
  if (targetEdges.length === 1) {
    return chamferSingleEdge(mesh, targetEdges[0], t);
  }

  return insetFaces(mesh, affectedFaceIds, t);
}

function chamferSingleEdge(mesh: CADMesh, edge: Edge, t: number): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const v1 = vertMap.get(edge.v1Id);
  const v2 = vertMap.get(edge.v2Id);
  if (!v1 || !v2) return mesh;

  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const key = edgeKey(edge.v1Id, edge.v2Id);

  const adjacent = mesh.faces.filter((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      if (edgeKey(f.vertexIds[i], f.vertexIds[(i + 1) % n]) === key) return true;
    }
    return false;
  });
  if (adjacent.length === 0) return mesh;

  const newVertices: Vertex[] = [...mesh.vertices];
  const faceCuts: { faceId: string; n1: string; n2: string; order: [string, string] }[] = [];

  adjacent.forEach((face) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    face.vertexIds.forEach((id) => {
      const v = vertMap.get(id)!;
      cx += v.x;
      cy += v.y;
      cz += v.z;
    });
    cx /= face.vertexIds.length;
    cy /= face.vertexIds.length;
    cz /= face.vertexIds.length;

    // Points along edge, then pulled toward face center for visible bevel width
    const along1 = {
      x: v1.x + (v2.x - v1.x) * t,
      y: v1.y + (v2.y - v1.y) * t,
      z: v1.z + (v2.z - v1.z) * t,
    };
    const along2 = {
      x: v2.x + (v1.x - v2.x) * t,
      y: v2.y + (v1.y - v2.y) * t,
      z: v2.z + (v1.z - v2.z) * t,
    };
    const pull = Math.min(0.85, t * 2.2);
    const n1: Vertex = {
      id: generateId(),
      x: along1.x + (cx - along1.x) * pull,
      y: along1.y + (cy - along1.y) * pull,
      z: along1.z + (cz - along1.z) * pull,
    };
    const n2: Vertex = {
      id: generateId(),
      x: along2.x + (cx - along2.x) * pull,
      y: along2.y + (cy - along2.y) * pull,
      z: along2.z + (cz - along2.z) * pull,
    };
    newVertices.push(n1, n2);
    vertMap.set(n1.id, n1);
    vertMap.set(n2.id, n2);

    // Winding along face: which order is v1->v2?
    let order: [string, string] = [n1.id, n2.id];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      if (a === edge.v1Id && b === edge.v2Id) {
        order = [n1.id, n2.id];
        break;
      }
      if (a === edge.v2Id && b === edge.v1Id) {
        order = [n2.id, n1.id];
        break;
      }
    }
    faceCuts.push({ faceId: face.id, n1: n1.id, n2: n2.id, order });
  });

  const cutByFace = new Map(faceCuts.map((c) => [c.faceId, c]));
  const newFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    const cut = cutByFace.get(face.id);
    if (!cut) {
      newFaces.push(face);
      return;
    }
    const rebuilt: string[] = [];
    const rebuiltUvs: { u: number; v: number }[] = [];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const ua = face.uvs[i] || { u: 0, v: 0 };
      rebuilt.push(a);
      rebuiltUvs.push({ ...ua });
      if (edgeKey(a, b) === key) {
        rebuilt.push(cut.order[0], cut.order[1]);
        rebuiltUvs.push({ u: ua.u, v: ua.v }, { u: ua.u, v: ua.v });
      }
    }
    // Drop the original endpoints of the beveled edge from the face ring
    // (they've been replaced by cut verts); keep other corners.
    const filtered: string[] = [];
    const filteredUvs: { u: number; v: number }[] = [];
    for (let i = 0; i < rebuilt.length; i++) {
      const id = rebuilt[i];
      if (id === edge.v1Id || id === edge.v2Id) continue;
      filtered.push(id);
      filteredUvs.push(rebuiltUvs[i]);
    }
    if (filtered.length >= 3) {
      newFaces.push({
        ...face,
        id: generateId(),
        vertexIds: filtered,
        uvs: filteredUvs,
      });
    }
  });

  // Bevel strip between the two face cuts (or a single quad if only one face)
  if (faceCuts.length >= 2) {
    const a = faceCuts[0];
    const b = faceCuts[1];
    newFaces.push({
      id: generateId(),
      vertexIds: [a.order[0], a.order[1], b.order[1], b.order[0]],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  } else if (faceCuts.length === 1) {
    const a = faceCuts[0];
    newFaces.push({
      id: generateId(),
      vertexIds: [edge.v1Id, a.order[0], a.order[1], edge.v2Id],
      uvs: [
        { u: 0, v: 0 },
        { u: t, v: 0 },
        { u: 1 - t, v: 0 },
        { u: 1, v: 0 },
      ],
    });
  }

  return finalizeEditableMesh({
    ...mesh,
    vertices: newVertices,
    faces: newFaces,
  });
}

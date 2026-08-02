import type { CADMesh, Face, Vertex } from '../types/cad';
import { generateId } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';
import { findEdgeLoop, applyLoopCut } from './meshCutTools';
import { chamferEdges } from './bevelOps';

export type { BevelMover, ChamferEdgesResult } from './bevelOps';
export { chamferEdges } from './bevelOps';

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
 */
export function bevelSelectedEdges(mesh: CADMesh, edgeIds: string[], amount = 0.1, segments = 1): CADMesh {
  const t = Math.max(0.002, Math.min(0.45, amount));
  return chamferEdges(mesh, edgeIds, t, segments).mesh;
}

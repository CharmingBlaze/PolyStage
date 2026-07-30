export { generateId } from './topology/ids';
export { createEdgesFromFaces } from './topology/edges';
export { getMeshTopologyStats, countPolygons, countTriangles } from './topology/stats';
export { buildLogicalEdgeGeometry, buildTriangulationDebugGeometry } from './topology/edgeOverlay';
export { validateEditableTopology, finalizeEditableMesh } from './topology/validate';
export { createPrimitiveMesh } from './topology/primitives';

import * as THREE from 'three';
import type { CADMesh, Face, PrimitiveType, Vector3D } from '../types/cad';
import { generateId } from './topology/ids';
import { createPrimitiveMesh } from './topology/primitives';
import { triangulateFaces } from './topology/triangulate';
import { finalizeEditableMesh } from './topology/validate';

export function snapToGrid(val: number, step: number): number {
  if (step === 0) return val;
  return Math.round(val / step) * step;
}

export function planarProjectUVs(mesh: CADMesh, faceId: string): CADMesh {
  const targetFace = mesh.faces.find((f) => f.id === faceId);
  if (!targetFace) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  const newUVs = targetFace.vertexIds.map((vId) => {
    const v = vertMap.get(vId);
    if (!v) return { u: 0, v: 0 };
    return {
      u: Math.max(0, Math.min(1, (v.x + 1) / 2)),
      v: Math.max(0, Math.min(1, (v.y + 1) / 2)),
    };
  });

  return {
    ...mesh,
    faces: mesh.faces.map((f) => (f.id === faceId ? { ...f, uvs: newUVs } : f)),
  };
}

export function mirrorUVs(mesh: CADMesh, faceId: string, axis: 'u' | 'v'): CADMesh {
  const targetFace = mesh.faces.find((f) => f.id === faceId);
  if (!targetFace) return mesh;

  const newUVs = targetFace.uvs.map((uv) => ({
    u: axis === 'u' ? 1 - uv.u : uv.u,
    v: axis === 'v' ? 1 - uv.v : uv.v,
  }));

  return {
    ...mesh,
    faces: mesh.faces.map((f) => (f.id === faceId ? { ...f, uvs: newUVs } : f)),
  };
}

/** All primitives produce CADMesh polygon topology — never render triangles as faces. */
export function generatePrimitive(type: PrimitiveType, customSize?: Vector3D): CADMesh {
  return createPrimitiveMesh(type, customSize);
}

/**
 * Build Three.js BufferGeometry as a render cache from logical polygons.
 * Fan-triangulates n-gons; all triangles of a face share one polygon normal.
 */
export function buildThreeGeometry(mesh: CADMesh): THREE.BufferGeometry {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const buffers = triangulateFaces(mesh.faces, vertMap);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.userData.triangleToFaceId = buffers.triangleToFaceId;
  geometry.userData.triangleMappings = buffers.triangleMappings;
  geometry.userData.faceToTriangleIndices = buffers.faceToTriangleIndices;
  geometry.userData.polygonCount = mesh.faces.length;
  geometry.userData.triangleCount = buffers.triangleToFaceId.length;

  return geometry;
}

function faceNormal(faceVerts: { x: number; y: number; z: number }[]) {
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

export function extrudeFace(mesh: CADMesh, faceId: string, depth: number = 0.5): CADMesh {
  return extrudeFaces(mesh, [faceId], depth);
}

/** Extrude faces as a region — no internal walls between adjacent selected faces. */
export function extrudeFaces(mesh: CADMesh, faceIds: string[], depth: number = 0.5): CADMesh {
  const idSet = new Set(faceIds);
  const targets = mesh.faces.filter((f) => idSet.has(f.id));
  if (targets.length === 0) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const vertsToExtrude = new Set<string>();
  targets.forEach((f) => f.vertexIds.forEach((id) => vertsToExtrude.add(id)));

  let nx = 0;
  let ny = 0;
  let nz = 0;
  targets.forEach((f) => {
    const fv = f.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fv.length < 3) return;
    const n = faceNormal(fv);
    nx += n.x;
    ny += n.y;
    nz += n.z;
  });
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / nLen) * depth;
  ny = (ny / nLen) * depth;
  nz = (nz / nLen) * depth;

  const newVertMap = new Map<string, string>();
  const newVertices = [...mesh.vertices];

  vertsToExtrude.forEach((oldId) => {
    const oldV = vertMap.get(oldId);
    if (!oldV) return;
    const newId = generateId();
    newVertMap.set(oldId, newId);
    newVertices.push({
      id: newId,
      x: oldV.x + nx,
      y: oldV.y + ny,
      z: oldV.z + nz,
    });
  });

  const edgeUse = new Map<string, { a: string; b: string; count: number; faceId: string }>();
  targets.forEach((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % n];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
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

  return finalizeEditableMesh({
    ...mesh,
    vertices: newVertices,
    faces: mesh.faces.filter((f) => !idSet.has(f.id)).concat([...topFaces, ...sideFaces]),
  });
}

export function insetFace(mesh: CADMesh, faceId: string, factor: number = 0.25): CADMesh {
  return insetFaces(mesh, [faceId], factor);
}

/** Inset multiple faces from a shared base mesh (Blender-style modal amount). */
export function insetFaces(mesh: CADMesh, faceIds: string[], factor: number = 0.25): CADMesh {
  const idSet = new Set(faceIds);
  const targets = mesh.faces.filter((f) => idSet.has(f.id));
  if (targets.length === 0) return mesh;

  const t = Math.max(0, Math.min(0.95, factor));
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const newVertices = [...mesh.vertices];
  const addedFaces: Face[] = [];
  const removed = new Set<string>();

  targets.forEach((targetFace) => {
    const faceVerts = targetFace.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (faceVerts.length < 3) return;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    faceVerts.forEach((v) => {
      cx += v.x;
      cy += v.y;
      cz += v.z;
    });
    cx /= faceVerts.length;
    cy /= faceVerts.length;
    cz /= faceVerts.length;

    const newVertMap = new Map<string, string>();
    targetFace.vertexIds.forEach((oldId) => {
      const oldV = vertMap.get(oldId)!;
      const newId = generateId();
      newVertMap.set(oldId, newId);
      const nv = {
        id: newId,
        x: oldV.x + (cx - oldV.x) * t,
        y: oldV.y + (cy - oldV.y) * t,
        z: oldV.z + (cz - oldV.z) * t,
      };
      newVertices.push(nv);
      vertMap.set(newId, nv);
    });

    addedFaces.push({
      ...targetFace,
      id: generateId(),
      vertexIds: targetFace.vertexIds.map((oldId) => newVertMap.get(oldId)!),
      uvs: targetFace.uvs.map((uv) => ({ ...uv })),
    });

    const vCount = targetFace.vertexIds.length;
    for (let i = 0; i < vCount; i++) {
      const b1 = targetFace.vertexIds[i];
      const b2 = targetFace.vertexIds[(i + 1) % vCount];
      const t1 = newVertMap.get(b1)!;
      const t2 = newVertMap.get(b2)!;
      addedFaces.push({
        id: generateId(),
        vertexIds: [b1, b2, t2, t1],
        uvs: [
          { u: 0, v: 0 },
          { u: 1, v: 0 },
          { u: 1, v: 1 },
          { u: 0, v: 1 },
        ],
      });
    }
    removed.add(targetFace.id);
  });

  return finalizeEditableMesh({
    ...mesh,
    vertices: newVertices,
    faces: mesh.faces.filter((f) => !removed.has(f.id)).concat(addedFaces),
  });
}

export function knifeCutFace(mesh: CADMesh, faceId: string): CADMesh {
  const targetFace = mesh.faces.find((f) => f.id === faceId);
  if (!targetFace || targetFace.vertexIds.length < 4) return mesh;

  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const vIds = targetFace.vertexIds;
  const v0 = vertMap.get(vIds[0])!;
  const v2 = vertMap.get(vIds[2])!;

  const newCenterVert = {
    id: generateId(),
    x: (v0.x + v2.x) / 2,
    y: (v0.y + v2.y) / 2,
    z: (v0.z + v2.z) / 2,
  };

  const newFaces: Face[] = [];
  for (let i = 0; i < vIds.length; i++) {
    const a = vIds[i];
    const b = vIds[(i + 1) % vIds.length];
    newFaces.push({
      id: generateId(),
      vertexIds: [a, b, newCenterVert.id],
      uvs: [
        targetFace.uvs[i] || { u: 0, v: 0 },
        targetFace.uvs[(i + 1) % vIds.length] || { u: 1, v: 0 },
        { u: 0.5, v: 0.5 },
      ],
    });
  }

  return finalizeEditableMesh({
    ...mesh,
    vertices: [...mesh.vertices, newCenterVert],
    faces: mesh.faces.filter((f) => f.id !== faceId).concat(newFaces),
  });
}

export function subdivideFace(mesh: CADMesh, faceId: string): CADMesh {
  return knifeCutFace(mesh, faceId);
}

/** Explicit triangulate — convert logical polygons into triangle faces. */
export function triangulateMeshFaces(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const idSet = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;
  const newFaces: Face[] = [];

  mesh.faces.forEach((face) => {
    if (idSet && !idSet.has(face.id)) {
      newFaces.push(face);
      return;
    }
    if (face.vertexIds.length <= 3) {
      newFaces.push(face);
      return;
    }
    for (let i = 1; i < face.vertexIds.length - 1; i++) {
      newFaces.push({
        id: generateId(),
        vertexIds: [face.vertexIds[0], face.vertexIds[i], face.vertexIds[i + 1]],
        uvs: [
          face.uvs[0] || { u: 0, v: 0 },
          face.uvs[i] || { u: 1, v: 0 },
          face.uvs[i + 1] || { u: 0.5, v: 1 },
        ],
        materialId: face.materialId,
        color: face.color,
      });
    }
  });

  return finalizeEditableMesh({ ...mesh, faces: newFaces });
}

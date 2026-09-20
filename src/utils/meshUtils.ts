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
import { extrudeFacesOnce, insetFacesOnce } from './modalMeshOps';
import { attachMeshBvh } from './bvh';

export function snapToGrid(val: number, step: number): number {
  if (step === 0) return val;
  return Math.round(val / step) * step;
}

import { originToGeometry } from './meshOrigin';

/**
 * Move the mesh pivot to the local bounding-box center without changing world
 * appearance. Object-mode gizmos use `mesh.position`, so uncentered blockout
 * verts (silhouette space with position 0) leave the gizmo on the floor.
 */
export function recenterMeshOrigin(mesh: CADMesh): CADMesh {
  return originToGeometry(mesh);
}

function selectionCentroid(
  mesh: CADMesh,
  vertexIds: string[] | null,
): { cx: number; cy: number; cz: number; ids: Set<string> | null } {
  const ids = vertexIds && vertexIds.length ? new Set(vertexIds) : null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (const v of mesh.vertices) {
    if (ids && !ids.has(v.id)) continue;
    cx += v.x;
    cy += v.y;
    cz += v.z;
    n += 1;
  }
  if (!n) return { cx: 0, cy: 0, cz: 0, ids };
  return { cx: cx / n, cy: cy / n, cz: cz / n, ids };
}

/** Flip selected verts (or the whole mesh) across a local axis through the selection center. */
export function flipMesh(
  mesh: CADMesh,
  axis: 'x' | 'y' | 'z',
  vertexIds?: string[] | null,
): CADMesh {
  const { cx, cy, cz, ids } = selectionCentroid(mesh, vertexIds ?? null);
  const whole = !ids;
  const vertices = mesh.vertices.map((v) => {
    if (ids && !ids.has(v.id)) return v;
    const p = { x: v.x, y: v.y, z: v.z };
    p[axis] = (axis === 'x' ? cx : axis === 'y' ? cy : cz) * 2 - p[axis];
    const normal = v.normal
      ? { ...v.normal, [axis]: -(v.normal[axis] as number) }
      : v.normal;
    return { ...v, ...p, normal };
  });
  const faces = whole
    ? mesh.faces.map((f) => ({
        ...f,
        vertexIds: [...f.vertexIds].reverse(),
        uvs: [...f.uvs].reverse(),
      }))
    : mesh.faces;
  return finalizeEditableMesh({
    ...mesh,
    vertices,
    faces,
    revision: (mesh.revision || 0) + 1,
  });
}

/** Rotate selected verts (or the whole mesh) 90 degrees around a local axis. */
export function rotateMesh90(
  mesh: CADMesh,
  axis: 'x' | 'y' | 'z',
  clockwise = false,
  vertexIds?: string[] | null,
): CADMesh {
  const { cx, cy, cz, ids } = selectionCentroid(mesh, vertexIds ?? null);
  const s = clockwise ? -1 : 1;
  const vertices = mesh.vertices.map((v) => {
    if (ids && !ids.has(v.id)) return v;
    const x = v.x - cx;
    const y = v.y - cy;
    const z = v.z - cz;
    let nx = x;
    let ny = y;
    let nz = z;
    if (axis === 'y') {
      nx = s * z;
      nz = -s * x;
    } else if (axis === 'x') {
      ny = -s * z;
      nz = s * y;
    } else {
      nx = -s * y;
      ny = s * x;
    }
    return { ...v, x: nx + cx, y: ny + cy, z: nz + cz };
  });
  return finalizeEditableMesh({
    ...mesh,
    vertices,
    revision: (mesh.revision || 0) + 1,
  });
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

  // BVH for fast / stable paint + pick raycasts (indirect keeps triangle→face maps valid).
  return attachMeshBvh(geometry);
}

export function extrudeFace(mesh: CADMesh, faceId: string, depth: number = 0.5): CADMesh {
  return extrudeFaces(mesh, [faceId], depth);
}

/** Extrude faces as a region — no internal walls between adjacent selected faces. */
export function extrudeFaces(mesh: CADMesh, faceIds: string[], depth: number = 0.5): CADMesh {
  return extrudeFacesOnce(mesh, faceIds, depth);
}

export function insetFace(mesh: CADMesh, faceId: string, factor: number = 0.25): CADMesh {
  return insetFaces(mesh, [faceId], factor);
}

/** Inset faces (Blender region inset). */
export function insetFaces(mesh: CADMesh, faceIds: string[], factor: number = 0.25): CADMesh {
  return insetFacesOnce(mesh, faceIds, factor);
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

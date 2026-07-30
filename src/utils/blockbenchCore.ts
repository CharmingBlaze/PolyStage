import type { CADMesh, Vertex, Face, Vector3D } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';

export interface Keyframe {
  id: string;
  time: number;
  position: Vector3D;
  rotation: Vector3D;
  scale: Vector3D;
}

export interface AnimationClip {
  id: string;
  name: string;
  fps: number;
  duration: number;
  keyframes: Keyframe[];
}

export function sampleAnimationKeyframe(keyframes: Keyframe[], time: number): Vector3D {
  if (keyframes.length === 0) return { x: 0, y: 0, z: 0 };
  if (keyframes.length === 1) return keyframes[0].position;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].position;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].position;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (time >= k1.time && time <= k2.time) {
      const alpha = (time - k1.time) / (k2.time - k1.time);
      return {
        x: k1.position.x + (k2.position.x - k1.position.x) * alpha,
        y: k1.position.y + (k2.position.y - k1.position.y) * alpha,
        z: k1.position.z + (k2.position.z - k1.position.z) * alpha,
      };
    }
  }

  return sorted[0].position;
}

export function mergeVerticesByDistance(mesh: CADMesh, threshold: number = 0.05): CADMesh {
  const verts = mesh.vertices;
  const mergedMap = new Map<string, string>();
  const keepVerts: Vertex[] = [];

  for (let i = 0; i < verts.length; i++) {
    const v1 = verts[i];
    if (mergedMap.has(v1.id)) continue;

    keepVerts.push(v1);
    mergedMap.set(v1.id, v1.id);

    for (let j = i + 1; j < verts.length; j++) {
      const v2 = verts[j];
      if (mergedMap.has(v2.id)) continue;

      const dist = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
      if (dist <= threshold) {
        mergedMap.set(v2.id, v1.id);
      }
    }
  }

  const updatedFaces: Face[] = mesh.faces
    .map((f) => {
      const newVIds = f.vertexIds.map((id) => mergedMap.get(id) || id);
      const uniqueVIds = Array.from(new Set(newVIds));
      if (uniqueVIds.length < 3) return null;
      return {
        ...f,
        vertexIds: uniqueVIds,
      };
    })
    .filter((f): f is Face => f !== null);

  return {
    ...mesh,
    vertices: keepVerts,
    faces: updatedFaces,
    edges: createEdgesFromFaces(updatedFaces),
  };
}

export function subdivideSelectedEdge(mesh: CADMesh, edgeId: string): CADMesh {
  const targetEdge = mesh.edges.find((e) => e.id === edgeId);
  if (!targetEdge) return mesh;

  const v1 = mesh.vertices.find((v) => v.id === targetEdge.v1Id);
  const v2 = mesh.vertices.find((v) => v.id === targetEdge.v2Id);
  if (!v1 || !v2) return mesh;

  const midVert: Vertex = {
    id: generateId(),
    x: (v1.x + v2.x) / 2,
    y: (v1.y + v2.y) / 2,
    z: (v1.z + v2.z) / 2,
  };

  const updatedVerts = [...mesh.vertices, midVert];

  const updatedFaces = mesh.faces.map((f) => {
    const vIds = f.vertexIds;
    const idx1 = vIds.indexOf(v1.id);
    const idx2 = vIds.indexOf(v2.id);

    if (idx1 !== -1 && idx2 !== -1 && Math.abs(idx1 - idx2) === 1) {
      const insertIdx = Math.max(idx1, idx2);
      const newVIds = [...vIds];
      newVIds.splice(insertIdx, 0, midVert.id);
      return { ...f, vertexIds: newVIds };
    }
    return f;
  });

  return {
    ...mesh,
    vertices: updatedVerts,
    faces: updatedFaces,
    edges: createEdgesFromFaces(updatedFaces),
  };
}

export function flipFaceNormals(mesh: CADMesh, faceId: string): CADMesh {
  const updatedFaces = mesh.faces.map((f) => {
    if (f.id === faceId) {
      return {
        ...f,
        vertexIds: [...f.vertexIds].reverse(),
        uvs: [...f.uvs].reverse(),
      };
    }
    return f;
  });

  return { ...mesh, faces: updatedFaces };
}

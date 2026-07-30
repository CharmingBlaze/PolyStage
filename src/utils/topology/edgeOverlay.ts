import * as THREE from 'three';
import type { CADMesh, Vertex } from '../../types/cad';
import { createEdgesFromFaces } from './edges';

/** Build LineSegments from logical editable edges only (no render diagonals). */
export function buildLogicalEdgeGeometry(
  mesh: CADMesh,
  options?: { onlyEdgeIds?: Set<string> }
): THREE.BufferGeometry {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const edges = mesh.edges.length > 0 ? mesh.edges : createEdgesFromFaces(mesh.faces);
  const positions: number[] = [];

  edges.forEach((edge) => {
    if (options?.onlyEdgeIds && !options.onlyEdgeIds.has(edge.id)) return;
    const a = vertMap.get(edge.v1Id);
    const b = vertMap.get(edge.v2Id);
    if (!a || !b) return;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/** Optional debug overlay of fan diagonals (render-only). */
export function buildTriangulationDebugGeometry(
  mesh: CADMesh,
  vertMap?: Map<string, Vertex>
): THREE.BufferGeometry {
  const map = vertMap ?? new Map(mesh.vertices.map((v) => [v.id, v]));
  const positions: number[] = [];

  mesh.faces.forEach((face) => {
    const ids = face.vertexIds;
    if (ids.length < 4) return;
    const v0 = map.get(ids[0]);
    if (!v0) return;
    // Fan diagonals from corner 0 to corners 2..n-2
    for (let i = 2; i < ids.length - 1; i++) {
      const vi = map.get(ids[i]);
      if (!vi) continue;
      positions.push(v0.x, v0.y, v0.z, vi.x, vi.y, vi.z);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

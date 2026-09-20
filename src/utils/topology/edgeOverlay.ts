import * as THREE from 'three';
import type { CADMesh, Vertex } from '../../types/cad';
import { createEdgesFromFaces } from './edges';

/** Build LineSegments from logical editable edges only (no render diagonals). */
export function buildLogicalEdgeGeometry(
  mesh: CADMesh,
  options?: {
    onlyEdgeIds?: Set<string>;
    /**
     * Simplify longitudinal wire columns in a blockout ortho view. The mesh
     * keeps its full radial topology; only the projected wire display is
     * reduced to silhouette edges plus the center seam.
     */
    blockoutOrtho?: 'front' | 'side';
  }
): THREE.BufferGeometry {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const edges = mesh.edges.length > 0 ? mesh.edges : createEdgesFromFaces(mesh.faces);
  const positions: number[] = [];

  type RingProfile = { min: number; max: number; center: number; epsilon: number };
  const ringProfiles = new Map<string, RingProfile>();
  if (options?.blockoutOrtho) {
    const coordinate = options.blockoutOrtho === 'front'
      ? (vertex: Vertex) => vertex.x
      : (vertex: Vertex) => vertex.z;
    const ringValues = new Map<string, number[]>();
    mesh.vertices.forEach((vertex) => {
      const key = vertex.y.toFixed(6);
      const values = ringValues.get(key) ?? [];
      values.push(coordinate(vertex));
      ringValues.set(key, values);
    });
    ringValues.forEach((values, key) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      ringProfiles.set(key, {
        min,
        max,
        center: (min + max) / 2,
        epsilon: Math.max((max - min) * 1e-4, 1e-6),
      });
    });
  }

  const orthoColumn = (a: Vertex, b: Vertex) => {
    const view = options?.blockoutOrtho;
    if (!view) return true;
    if (view === 'front' && Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5) return false;
    if (view === 'side' && Math.abs(a.z - b.z) < 1e-5 && Math.abs(a.y - b.y) < 1e-5) return false;
    if (Math.abs(a.y - b.y) < 1e-6) return true;
    const coordinate = view === 'front'
      ? (vertex: Vertex) => vertex.x
      : (vertex: Vertex) => vertex.z;
    const classify = (vertex: Vertex): -1 | 0 | 1 | null => {
      const profile = ringProfiles.get(vertex.y.toFixed(6));
      if (!profile) return null;
      const value = coordinate(vertex);
      if (Math.abs(value - profile.min) <= profile.epsilon) return -1;
      if (Math.abs(value - profile.center) <= profile.epsilon) return 0;
      if (Math.abs(value - profile.max) <= profile.epsilon) return 1;
      return null;
    };
    const aClass = classify(a);
    return aClass !== null && aClass === classify(b);
  };

  edges.forEach((edge) => {
    if (options?.onlyEdgeIds && !options.onlyEdgeIds.has(edge.id)) return;
    const a = vertMap.get(edge.v1Id);
    const b = vertMap.get(edge.v2Id);
    if (!a || !b) return;
    if (!orthoColumn(a, b)) return;
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

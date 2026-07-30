import type { CADMesh, Vertex, Vector3D } from '../types/cad';

// Vertex Magnet Magnetism (Blockbench Vertex Snap)
export function snapVertexToNearest(
  targetVertex: Vertex,
  allVertices: Vertex[],
  maxDistance: number = 0.25
): Vector3D {
  let closestDist = Infinity;
  let closestPos: Vector3D = { x: targetVertex.x, y: targetVertex.y, z: targetVertex.z };

  allVertices.forEach((v) => {
    if (v.id === targetVertex.id) return;
    const dist = Math.hypot(v.x - targetVertex.x, v.y - targetVertex.y, v.z - targetVertex.z);
    if (dist < closestDist && dist <= maxDistance) {
      closestDist = dist;
      closestPos = { x: v.x, y: v.y, z: v.z };
    }
  });

  return closestPos;
}

// Magnet Snap Selected Vertices to Target Mesh Vertices
export function magnetSnapSelectedVertices(
  mesh: CADMesh,
  selectedIds: string[],
  snapRadius: number = 0.3
): CADMesh {
  const updatedVerts = mesh.vertices.map((v) => {
    if (selectedIds.includes(v.id)) {
      const snappedPos = snapVertexToNearest(v, mesh.vertices, snapRadius);
      return {
        ...v,
        ...snappedPos,
      };
    }
    return v;
  });

  return {
    ...mesh,
    vertices: updatedVerts,
  };
}

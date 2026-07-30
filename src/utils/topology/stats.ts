import type { CADMesh, Face } from '../../types/cad';

/** Number of render triangles a logical polygon fans into. */
export function faceTriangleCount(face: Face): number {
  const n = face.vertexIds.length;
  return n >= 3 ? n - 2 : 0;
}

export function countPolygons(mesh: CADMesh): number {
  return mesh.faces.filter((f) => f.vertexIds.length >= 3).length;
}

export function countTriangles(mesh: CADMesh): number {
  return mesh.faces.reduce((acc, f) => acc + faceTriangleCount(f), 0);
}

export function countLogicalEdges(mesh: CADMesh): number {
  return mesh.edges.length;
}

export interface MeshTopologyStats {
  vertices: number;
  edges: number;
  polygons: number;
  triangles: number;
  quads: number;
  ngons: number;
  tris: number;
}

export function getMeshTopologyStats(mesh: CADMesh): MeshTopologyStats {
  let quads = 0;
  let ngons = 0;
  let tris = 0;
  mesh.faces.forEach((f) => {
    const n = f.vertexIds.length;
    if (n === 3) tris++;
    else if (n === 4) quads++;
    else if (n > 4) ngons++;
  });
  return {
    vertices: mesh.vertices.length,
    edges: mesh.edges.length,
    polygons: countPolygons(mesh),
    triangles: countTriangles(mesh),
    quads,
    ngons,
    tris,
  };
}

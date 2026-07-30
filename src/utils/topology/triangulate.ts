import type { Face, UVCoord, Vertex } from '../../types/cad';

export interface RenderTriangleMapping {
  triangleIndex: number;
  faceId: string;
  faceCornerIndices: [number, number, number];
}

export interface TriangulateBuffers {
  positions: number[];
  uvs: number[];
  normals: number[];
  colors: number[];
  triangleToFaceId: string[];
  triangleMappings: RenderTriangleMapping[];
  faceToTriangleIndices: Map<string, number[]>;
}

function polygonNormal(verts: Vertex[]): { x: number; y: number; z: number } {
  // Newell's method — robust for quads / n-gons
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const cur = verts[i];
    const next = verts[(i + 1) % verts.length];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Fan-triangulate convex polygons for rendering.
 * All triangles from one face share the same polygon normal (no lighting seam on quads).
 */
export function triangulateFaces(
  faces: Face[],
  vertMap: Map<string, Vertex>,
  defaultColor: [number, number, number] = [0.45, 0.48, 0.52]
): TriangulateBuffers {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const triangleToFaceId: string[] = [];
  const triangleMappings: RenderTriangleMapping[] = [];
  const faceToTriangleIndices = new Map<string, number[]>();

  faces.forEach((face) => {
    const vIds = face.vertexIds;
    if (vIds.length < 3) return;

    const faceVerts = vIds.map((id) => vertMap.get(id)).filter(Boolean) as Vertex[];
    if (faceVerts.length < 3) return;

    const n = polygonNormal(faceVerts);
    const faceTris: number[] = [];

    for (let i = 1; i < vIds.length - 1; i++) {
      const cornerIndices: [number, number, number] = [0, i, i + 1];
      const triVerts = cornerIndices.map((ci) => vertMap.get(vIds[ci]));
      if (!triVerts[0] || !triVerts[1] || !triVerts[2]) continue;

      const triangleIndex = triangleToFaceId.length;

      for (let c = 0; c < 3; c++) {
        const vi = cornerIndices[c];
        const v = triVerts[c]!;
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);

        const uv: UVCoord = face.uvs[vi] || { u: 0, v: 0 };
        uvs.push(uv.u, uv.v);
        colors.push(defaultColor[0], defaultColor[1], defaultColor[2]);
      }

      triangleToFaceId.push(face.id);
      triangleMappings.push({
        triangleIndex,
        faceId: face.id,
        faceCornerIndices: cornerIndices,
      });
      faceTris.push(triangleIndex);
    }

    faceToTriangleIndices.set(face.id, faceTris);
  });

  return {
    positions,
    uvs,
    normals,
    colors,
    triangleToFaceId,
    triangleMappings,
    faceToTriangleIndices,
  };
}

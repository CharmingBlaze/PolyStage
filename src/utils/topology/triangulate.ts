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

function colorFromFace(
  color: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!color) return fallback;
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const n = Number.parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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
    const [cr, cg, cb] = colorFromFace(face.color, defaultColor);

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
        colors.push(cr, cg, cb);
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

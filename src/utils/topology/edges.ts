import type { Edge, Face } from '../../types/cad';
import { makeEdgeId } from './ids';

/**
 * Rebuild logical modelling edges from polygon face boundaries only.
 * Render diagonals are never included.
 */
export function createEdgesFromFaces(faces: Face[]): Edge[] {
  const edgeMap = new Map<string, Edge>();

  faces.forEach((face) => {
    const vIds = face.vertexIds;
    if (vIds.length < 2) return;
    for (let i = 0; i < vIds.length; i++) {
      const v1 = vIds[i];
      const v2 = vIds[(i + 1) % vIds.length];
      if (!v1 || !v2 || v1 === v2) continue;
      const id = makeEdgeId(v1, v2);
      if (!edgeMap.has(id)) {
        edgeMap.set(id, { id, v1Id: v1, v2Id: v2 });
      }
    }
  });

  return Array.from(edgeMap.values());
}

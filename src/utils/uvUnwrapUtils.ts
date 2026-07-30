import type { CADMesh, Face, UVCoord } from '../types/cad';

/**
 * Advanced UV Unwrapping & Projection Suite for PolyStage models.
 */

/** Box Unwrap: seamless 6-direction box projection mapping */
export function boxUnwrapMesh(mesh: CADMesh): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  const updatedFaces: Face[] = mesh.faces.map((face) => {
    const fVerts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fVerts.length < 3) return face;

    // Calculate face normal
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < fVerts.length; i++) {
      const cur = fVerts[i];
      const next = fVerts[(i + 1) % fVerts.length];
      nx += (cur.y - next.y) * (cur.z + next.z);
      ny += (cur.z - next.z) * (cur.x + next.x);
      nz += (cur.x - next.x) * (cur.y + next.y);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    const absX = Math.abs(nx / len);
    const absY = Math.abs(ny / len);
    const absZ = Math.abs(nz / len);

    // Determine dominant axis (X, Y, or Z)
    const newUVs: UVCoord[] = fVerts.map((v) => {
      let u = 0;
      let w = 0;
      if (absX >= absY && absX >= absZ) {
        u = (v.z + 1) / 2;
        w = (v.y + 1) / 2;
      } else if (absY >= absX && absY >= absZ) {
        u = (v.x + 1) / 2;
        w = (v.z + 1) / 2;
      } else {
        u = (v.x + 1) / 2;
        w = (v.y + 1) / 2;
      }
      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, w)),
      };
    });

    return { ...face, uvs: newUVs };
  });

  return { ...mesh, faces: updatedFaces };
}

/** Planar Projection along specified axis or face normal */
export function planarProjectMesh(mesh: CADMesh, faceIds?: string[], axis: 'x' | 'y' | 'z' | 'auto' = 'auto'): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const targetIdSet = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  const updatedFaces: Face[] = mesh.faces.map((face) => {
    if (targetIdSet && !targetIdSet.has(face.id)) return face;

    const fVerts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fVerts.length === 0) return face;

    const newUVs: UVCoord[] = fVerts.map((v) => {
      let u = 0;
      let w = 0;
      if (axis === 'x') {
        u = (v.z + 2) / 4;
        w = (v.y + 2) / 4;
      } else if (axis === 'y') {
        u = (v.x + 2) / 4;
        w = (v.z + 2) / 4;
      } else if (axis === 'z') {
        u = (v.x + 2) / 4;
        w = (v.y + 2) / 4;
      } else {
        u = (v.x + 2) / 4;
        w = (v.y + 2) / 4;
      }
      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, w)),
      };
    });

    return { ...face, uvs: newUVs };
  });

  return { ...mesh, faces: updatedFaces };
}

/** Cylindrical Projection around Y axis */
export function cylindricalUnwrapMesh(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const targetIdSet = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  const updatedFaces: Face[] = mesh.faces.map((face) => {
    if (targetIdSet && !targetIdSet.has(face.id)) return face;

    const fVerts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fVerts.length === 0) return face;

    const newUVs: UVCoord[] = fVerts.map((v) => {
      const angle = Math.atan2(v.z, v.x);
      const u = (angle + Math.PI) / (2 * Math.PI);
      const w = (v.y + 2) / 4;
      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, w)),
      };
    });

    return { ...face, uvs: newUVs };
  });

  return { ...mesh, faces: updatedFaces };
}

/** Spherical Projection */
export function sphericalUnwrapMesh(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const targetIdSet = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  const updatedFaces: Face[] = mesh.faces.map((face) => {
    if (targetIdSet && !targetIdSet.has(face.id)) return face;

    const fVerts = face.vertexIds.map((id) => vertMap.get(id)!).filter(Boolean);
    if (fVerts.length === 0) return face;

    const newUVs: UVCoord[] = fVerts.map((v) => {
      const r = Math.hypot(v.x, v.y, v.z) || 1;
      const theta = Math.atan2(v.z, v.x);
      const phi = Math.acos(Math.max(-1, Math.min(1, v.y / r)));

      const u = (theta + Math.PI) / (2 * Math.PI);
      const w = 1 - phi / Math.PI;

      return {
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, w)),
      };
    });

    return { ...face, uvs: newUVs };
  });

  return { ...mesh, faces: updatedFaces };
}

/** Smart Non-Overlapping Atlas Grid Unwrap: assigns clean grid cells for every polygon face */
export function smartAtlasGridUnwrapMesh(mesh: CADMesh): CADMesh {
  const count = mesh.faces.length;
  if (count === 0) return mesh;

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const margin = 0.005;

  const updatedFaces: Face[] = mesh.faces.map((f, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const minU = col * cellW + margin;
    const maxU = (col + 1) * cellW - margin;
    const minV = row * cellH + margin;
    const maxV = (row + 1) * cellH - margin;

    const quadCoords: UVCoord[] = [
      { u: minU, v: minV },
      { u: maxU, v: minV },
      { u: maxU, v: maxV },
      { u: minU, v: maxV },
    ];

    const newUVs = f.uvs.map((_, i) => quadCoords[i % quadCoords.length]);
    return { ...f, uvs: newUVs };
  });

  return { ...mesh, faces: updatedFaces };
}

/** Stretch / Fit face UVs to fill 0..1 bounding box */
export function fitFaceUVsToBounds(face: Face): Face {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  face.uvs.forEach((uv) => {
    if (uv.u < minU) minU = uv.u;
    if (uv.u > maxU) maxU = uv.u;
    if (uv.v < minV) minV = uv.v;
    if (uv.v > maxV) maxV = uv.v;
  });

  const rangeU = maxU - minU || 1;
  const rangeV = maxV - minV || 1;

  const newUVs = face.uvs.map((uv) => ({
    u: (uv.u - minU) / rangeU,
    v: (uv.v - minV) / rangeV,
  }));

  return { ...face, uvs: newUVs };
}

/** Rotate UV coordinates by arbitrary angle (in degrees) around face center */
export function rotateFaceUVs(face: Face, angleDeg: number): Face {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let cu = 0, cv = 0;
  face.uvs.forEach((uv) => {
    cu += uv.u;
    cv += uv.v;
  });
  cu /= face.uvs.length || 1;
  cv /= face.uvs.length || 1;

  const newUVs = face.uvs.map((uv) => {
    const du = uv.u - cu;
    const dv = uv.v - cv;
    return {
      u: Math.max(0, Math.min(1, cu + (du * cos - dv * sin))),
      v: Math.max(0, Math.min(1, cv + (du * sin + dv * cos))),
    };
  });

  return { ...face, uvs: newUVs };
}

/** Scale UV coordinates around center */
export function scaleFaceUVs(face: Face, scaleFactor: number): Face {
  let cu = 0, cv = 0;
  face.uvs.forEach((uv) => {
    cu += uv.u;
    cv += uv.v;
  });
  cu /= face.uvs.length || 1;
  cv /= face.uvs.length || 1;

  const newUVs = face.uvs.map((uv) => ({
    u: Math.max(0, Math.min(1, cu + (uv.u - cu) * scaleFactor)),
    v: Math.max(0, Math.min(1, cv + (uv.v - cv) * scaleFactor)),
  }));

  return { ...face, uvs: newUVs };
}

/** Pack and normalize all face UVs into 0..1 bounding box cleanly */
export function stitchAndPackUVs(mesh: CADMesh): CADMesh {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

  mesh.faces.forEach((f) => {
    f.uvs.forEach((uv) => {
      if (uv.u < minU) minU = uv.u;
      if (uv.u > maxU) maxU = uv.u;
      if (uv.v < minV) minV = uv.v;
      if (uv.v > maxV) maxV = uv.v;
    });
  });

  const rangeU = maxU - minU || 1;
  const rangeV = maxV - minV || 1;

  const packedFaces: Face[] = mesh.faces.map((f) => ({
    ...f,
    uvs: f.uvs.map((uv) => ({
      u: (uv.u - minU) / rangeU,
      v: (uv.v - minV) / rangeV,
    })),
  }));

  return { ...mesh, faces: packedFaces };
}

/** Reset all UVs to standard 0..1 quad grid */
export function resetMeshUVs(mesh: CADMesh): CADMesh {
  const resetFaces: Face[] = mesh.faces.map((f) => {
    const defaultQuadUVs: UVCoord[] = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ];
    const newUVs = f.uvs.map((_, idx) => defaultQuadUVs[idx % defaultQuadUVs.length]);
    return { ...f, uvs: newUVs };
  });

  return { ...mesh, faces: resetFaces };
}

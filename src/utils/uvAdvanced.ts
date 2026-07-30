import type { CADMesh, Face, UVCoord, Vertex, Vector3D } from '../types/cad';

export type UVAxis = 'u' | 'v';
export type PlanarAxis = 'x' | 'y' | 'z' | 'auto';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function snapUV(value: number, divisions: number): number {
  if (divisions <= 0) return value;
  return Math.round(value * divisions) / divisions;
}

export function snapUVCoord(uv: UVCoord, divisions: number): UVCoord {
  return {
    u: snapUV(uv.u, divisions),
    v: snapUV(uv.v, divisions),
  };
}

export function getFaceUVBounds(uvs: UVCoord[]): { minU: number; maxU: number; minV: number; maxV: number; cu: number; cv: number } {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  uvs.forEach((uv) => {
    minU = Math.min(minU, uv.u);
    maxU = Math.max(maxU, uv.u);
    minV = Math.min(minV, uv.v);
    maxV = Math.max(maxV, uv.v);
  });
  if (!Number.isFinite(minU)) {
    return { minU: 0, maxU: 1, minV: 0, maxV: 1, cu: 0.5, cv: 0.5 };
  }
  return {
    minU,
    maxU,
    minV,
    maxV,
    cu: (minU + maxU) / 2,
    cv: (minV + maxV) / 2,
  };
}

export function faceCentroid(face: Face, vertMap: Map<string, Vertex>): Vector3D {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  face.vertexIds.forEach((id) => {
    const v = vertMap.get(id);
    if (!v) return;
    x += v.x;
    y += v.y;
    z += v.z;
    n++;
  });
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / n, y: y / n, z: z / n };
}

export function faceNormal(face: Face, vertMap: Map<string, Vertex>): Vector3D {
  if (face.normal) return face.normal;
  if (face.vertexIds.length < 3) return { x: 0, y: 1, z: 0 };
  const a = vertMap.get(face.vertexIds[0]);
  const b = vertMap.get(face.vertexIds[1]);
  const c = vertMap.get(face.vertexIds[2]);
  if (!a || !b || !c) return { x: 0, y: 1, z: 0 };
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function updateFacesUVs(
  mesh: CADMesh,
  faceIds: string[],
  updater: (face: Face, uvs: UVCoord[]) => UVCoord[]
): CADMesh {
  const idSet = new Set(faceIds);
  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (!idSet.has(face.id)) return face;
      return { ...face, uvs: updater(face, face.uvs.map((uv) => ({ ...uv }))) };
    }),
  };
}

export function translateUVs(mesh: CADMesh, faceIds: string[], du: number, dv: number, snapDivisions = 0): CADMesh {
  return updateFacesUVs(mesh, faceIds, (_f, uvs) =>
    uvs.map((uv) => {
      const next = { u: uv.u + du, v: uv.v + dv };
      return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
    })
  );
}

export function scaleUVs(
  mesh: CADMesh,
  faceIds: string[],
  factor: number,
  pivot?: UVCoord,
  snapDivisions = 0
): CADMesh {
  return scaleUVsXY(mesh, faceIds, factor, factor, pivot, snapDivisions);
}

export function scaleUVsXY(
  mesh: CADMesh,
  faceIds: string[],
  factorU: number,
  factorV: number,
  pivot?: UVCoord,
  snapDivisions = 0
): CADMesh {
  return updateFacesUVs(mesh, faceIds, (_f, uvs) => {
    const bounds = getFaceUVBounds(uvs);
    const cu = pivot?.u ?? bounds.cu;
    const cv = pivot?.v ?? bounds.cv;
    return uvs.map((uv) => {
      const next = {
        u: cu + (uv.u - cu) * factorU,
        v: cv + (uv.v - cv) * factorV,
      };
      return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
    });
  });
}

/** Combined bounds across multiple faces */
export function getFacesUVBounds(
  mesh: CADMesh,
  faceIds: string[]
): { minU: number; maxU: number; minV: number; maxV: number; cu: number; cv: number } {
  const idSet = new Set(faceIds);
  const all: UVCoord[] = [];
  mesh.faces.forEach((f) => {
    if (idSet.has(f.id)) all.push(...f.uvs);
  });
  return getFaceUVBounds(all);
}

export function moveUVVertices(
  mesh: CADMesh,
  points: Array<{ faceId: string; index: number }>,
  u: number,
  v: number,
  snapDivisions = 0,
  mode: 'absolute' | 'delta' = 'absolute',
  deltas?: Map<string, UVCoord>
): CADMesh {
  const key = (faceId: string, index: number) => `${faceId}:${index}`;
  const pointSet = new Set(points.map((p) => key(p.faceId, p.index)));

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      const uvs = face.uvs.map((uv, i) => {
        if (!pointSet.has(key(face.id, i))) return uv;
        if (mode === 'delta' && deltas) {
          const d = deltas.get(key(face.id, i));
          if (!d) return uv;
          const next = { u: d.u + u, v: d.v + v };
          return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
        }
        const next = { u, v };
        return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
      });
      return { ...face, uvs };
    }),
  };
}

export function cylindricalUnwrapFaces(mesh: CADMesh, faceIds?: string[], axis: 'y' | 'x' | 'z' = 'y'): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const target = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  mesh.vertices.forEach((v) => {
    cx += v.x;
    cy += v.y;
    cz += v.z;
  });
  const n = Math.max(1, mesh.vertices.length);
  cx /= n;
  cy /= n;
  cz /= n;

  let minH = Infinity;
  let maxH = -Infinity;
  mesh.vertices.forEach((v) => {
    const h = axis === 'y' ? v.y : axis === 'x' ? v.x : v.z;
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
  });
  const hSpan = Math.max(1e-6, maxH - minH);

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (target && !target.has(face.id)) return face;
      const uvs = face.vertexIds.map((id) => {
        const v = vertMap.get(id);
        if (!v) return { u: 0, v: 0 };
        let dx = v.x - cx;
        let dy = v.y - cy;
        let dz = v.z - cz;
        let angle = 0;
        let height = 0;
        if (axis === 'y') {
          angle = Math.atan2(dx, dz);
          height = v.y;
        } else if (axis === 'x') {
          angle = Math.atan2(dz, dy);
          height = v.x;
        } else {
          angle = Math.atan2(dx, dy);
          height = v.z;
        }
        return {
          u: clamp01((angle + Math.PI) / (Math.PI * 2)),
          v: clamp01((height - minH) / hSpan),
        };
      });
      return { ...face, uvs };
    }),
  };
}

export function sphericalUnwrapFaces(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const target = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  mesh.vertices.forEach((v) => {
    cx += v.x;
    cy += v.y;
    cz += v.z;
  });
  const n = Math.max(1, mesh.vertices.length);
  cx /= n;
  cy /= n;
  cz /= n;

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (target && !target.has(face.id)) return face;
      const uvs = face.vertexIds.map((id) => {
        const v = vertMap.get(id);
        if (!v) return { u: 0, v: 0 };
        const dx = v.x - cx;
        const dy = v.y - cy;
        const dz = v.z - cz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;
        const u = clamp01((Math.atan2(nx, nz) + Math.PI) / (Math.PI * 2));
        const vv = clamp01(0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI);
        return { u, v: vv };
      });
      return { ...face, uvs };
    }),
  };
}

/** Per-face planar project then pack — good default "smart" unwrap */
export function smartUnwrapFaces(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const ids = faceIds && faceIds.length > 0 ? faceIds : mesh.faces.map((f) => f.id);
  const projected = planarProjectFaces(mesh, ids, 'auto');
  return packUVIslandsGrid(projected, ids, 0.03);
}

export function rotateUVs(mesh: CADMesh, faceIds: string[], degrees: number, pivot?: UVCoord, snapDivisions = 0): CADMesh {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return updateFacesUVs(mesh, faceIds, (_f, uvs) => {
    const bounds = getFaceUVBounds(uvs);
    const cu = pivot?.u ?? bounds.cu;
    const cv = pivot?.v ?? bounds.cv;
    return uvs.map((uv) => {
      const x = uv.u - cu;
      const y = uv.v - cv;
      const next = {
        u: cu + x * cos - y * sin,
        v: cv + x * sin + y * cos,
      };
      return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
    });
  });
}

export function mirrorFaceUVs(mesh: CADMesh, faceIds: string[], axis: UVAxis): CADMesh {
  return updateFacesUVs(mesh, faceIds, (_f, uvs) => {
    const bounds = getFaceUVBounds(uvs);
    return uvs.map((uv) => ({
      u: axis === 'u' ? bounds.cu * 2 - uv.u : uv.u,
      v: axis === 'v' ? bounds.cv * 2 - uv.v : uv.v,
    }));
  });
}

export function snapFacesToGrid(mesh: CADMesh, faceIds: string[], divisions: number): CADMesh {
  return updateFacesUVs(mesh, faceIds, (_f, uvs) => uvs.map((uv) => snapUVCoord(uv, divisions)));
}

export function fitUVsToUnitSquare(mesh: CADMesh, faceIds: string[], padding = 0.02): CADMesh {
  return updateFacesUVs(mesh, faceIds, (_f, uvs) => {
    const b = getFaceUVBounds(uvs);
    const w = Math.max(1e-6, b.maxU - b.minU);
    const h = Math.max(1e-6, b.maxV - b.minV);
    const usable = 1 - padding * 2;
    const scale = Math.min(usable / w, usable / h);
    return uvs.map((uv) => ({
      u: padding + (uv.u - b.minU) * scale,
      v: padding + (uv.v - b.minV) * scale,
    }));
  });
}

export function planarProjectFaces(mesh: CADMesh, faceIds: string[], axis: PlanarAxis = 'auto'): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const idSet = new Set(faceIds);

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (!idSet.has(face.id)) return face;
      const n = faceNormal(face, vertMap);
      let use: 'x' | 'y' | 'z' = 'y';
      if (axis === 'auto') {
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);
        if (ax >= ay && ax >= az) use = 'x';
        else if (az >= ay && az >= ax) use = 'z';
        else use = 'y';
      } else {
        use = axis;
      }

      const coords = face.vertexIds.map((id) => {
        const v = vertMap.get(id);
        if (!v) return { u: 0, v: 0 };
        if (use === 'x') return { u: v.z, v: v.y };
        if (use === 'z') return { u: v.x, v: v.y };
        return { u: v.x, v: v.z };
      });

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      coords.forEach((c) => {
        minU = Math.min(minU, c.u);
        maxU = Math.max(maxU, c.u);
        minV = Math.min(minV, c.v);
        maxV = Math.max(maxV, c.v);
      });
      const wu = Math.max(1e-6, maxU - minU);
      const wv = Math.max(1e-6, maxV - minV);

      return {
        ...face,
        uvs: coords.map((c) => ({
          u: clamp01((c.u - minU) / wu),
          v: clamp01((c.v - minV) / wv),
        })),
      };
    }),
  };
}

/** Blockbench-style cube projection based on dominant face normal */
export function boxUnwrapFaces(mesh: CADMesh, faceIds?: string[]): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const target = faceIds && faceIds.length > 0 ? new Set(faceIds) : null;

  // World AABB for consistent projection scale
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  mesh.vertices.forEach((v) => {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  });
  const sx = Math.max(1e-6, maxX - minX);
  const sy = Math.max(1e-6, maxY - minY);
  const sz = Math.max(1e-6, maxZ - minZ);

  // Classic cube net slots (normalized)
  const slots: Record<string, { ou: number; ov: number; wu: number; wv: number }> = {
    front: { ou: 0.25, ov: 0.375, wu: 0.25, wv: 0.375 },
    back: { ou: 0.75, ov: 0.375, wu: 0.25, wv: 0.375 },
    top: { ou: 0.25, ov: 0.75, wu: 0.25, wv: 0.25 },
    bottom: { ou: 0.25, ov: 0.125, wu: 0.25, wv: 0.25 },
    left: { ou: 0.0, ov: 0.375, wu: 0.25, wv: 0.375 },
    right: { ou: 0.5, ov: 0.375, wu: 0.25, wv: 0.375 },
  };

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (target && !target.has(face.id)) return face;
      const n = faceNormal(face, vertMap);
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);

      let side: keyof typeof slots = 'front';
      let mapUV = (v: Vertex): UVCoord => ({ u: (v.x - minX) / sx, v: (v.y - minY) / sy });

      if (ay >= ax && ay >= az) {
        side = n.y >= 0 ? 'top' : 'bottom';
        mapUV = (v) => ({ u: (v.x - minX) / sx, v: (v.z - minZ) / sz });
      } else if (ax >= ay && ax >= az) {
        side = n.x >= 0 ? 'right' : 'left';
        mapUV = (v) => ({ u: (v.z - minZ) / sz, v: (v.y - minY) / sy });
      } else {
        side = n.z >= 0 ? 'front' : 'back';
        mapUV = (v) => ({ u: (v.x - minX) / sx, v: (v.y - minY) / sy });
      }

      const slot = slots[side];
      const uvs = face.vertexIds.map((id) => {
        const v = vertMap.get(id);
        if (!v) return { u: slot.ou, v: slot.ov };
        const local = mapUV(v);
        return {
          u: slot.ou + clamp01(local.u) * slot.wu,
          v: slot.ov + clamp01(local.v) * slot.wv,
        };
      });

      return { ...face, uvs };
    }),
  };
}

/** Pack selected (or all) face islands into a non-overlapping atlas grid */
export function packUVIslandsGrid(mesh: CADMesh, faceIds?: string[], padding = 0.02): CADMesh {
  const targets =
    faceIds && faceIds.length > 0
      ? mesh.faces.filter((f) => faceIds.includes(f.id))
      : mesh.faces;
  const faceCount = targets.length;
  if (faceCount === 0) return mesh;

  const cols = Math.ceil(Math.sqrt(faceCount));
  const rows = Math.ceil(faceCount / cols);
  const cellU = 1 / cols;
  const cellV = 1 / rows;
  const padU = cellU * padding;
  const padV = cellV * padding;

  const slotById = new Map<string, number>();
  targets.forEach((f, i) => slotById.set(f.id, i));

  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      const index = slotById.get(face.id);
      if (index === undefined) return face;

      const col = index % cols;
      const row = Math.floor(index / cols);
      const minU = col * cellU + padU;
      const maxU = (col + 1) * cellU - padU;
      const maxV = 1 - row * cellV - padV;
      const minV = 1 - (row + 1) * cellV + padV;

      const b = getFaceUVBounds(face.uvs);
      const w = Math.max(1e-6, b.maxU - b.minU);
      const h = Math.max(1e-6, b.maxV - b.minV);
      const destW = Math.max(1e-6, maxU - minU);
      const destH = Math.max(1e-6, maxV - minV);
      const scale = Math.min(destW / w, destH / h);

      return {
        ...face,
        uvs: face.uvs.map((uv) => ({
          u: minU + (uv.u - b.minU) * scale,
          v: minV + (uv.v - b.minV) * scale,
        })),
      };
    }),
  };
}

export function moveUVVertex(
  mesh: CADMesh,
  faceId: string,
  uvIndex: number,
  u: number,
  v: number,
  snapDivisions = 0
): CADMesh {
  return {
    ...mesh,
    faces: mesh.faces.map((face) => {
      if (face.id !== faceId) return face;
      const uvs = face.uvs.map((uv, i) => {
        if (i !== uvIndex) return uv;
        const next = { u, v };
        return snapDivisions > 0 ? snapUVCoord(next, snapDivisions) : next;
      });
      return { ...face, uvs };
    }),
  };
}

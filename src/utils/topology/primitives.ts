import type { CADMesh, Face, PrimitiveType, UVCoord, Vector3D, Vertex } from '../../types/cad';
import { generateId } from './ids';
import { finalizeEditableMesh } from './validate';
import { packUVIslandsGrid } from '../uvAdvanced';

function v(x: number, y: number, z: number, id?: string): Vertex {
  return { id: id ?? generateId(), x, y, z };
}

function uvRect(): UVCoord[] {
  return [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: 1 },
    { u: 0, v: 1 },
  ];
}

function face(vertexIds: string[], uvs?: UVCoord[]): Face {
  const u =
    uvs && uvs.length === vertexIds.length
      ? uvs
      : vertexIds.map((_, i) => {
          if (vertexIds.length === 3) {
            return [
              { u: 0, v: 0 },
              { u: 1, v: 0 },
              { u: 0.5, v: 1 },
            ][i];
          }
          if (vertexIds.length === 4) return uvRect()[i];
          const t = i / vertexIds.length;
          return { u: 0.5 + 0.5 * Math.cos(t * Math.PI * 2), v: 0.5 + 0.5 * Math.sin(t * Math.PI * 2) };
        });
  return { id: generateId(), vertexIds, uvs: u };
}

function meshFrom(
  name: string,
  vertices: Vertex[],
  faces: Face[],
  position?: Vector3D
): CADMesh {
  const mesh = finalizeEditableMesh({
    id: generateId(),
    name,
    position: position ?? { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    vertices,
    faces,
    visible: true,
    locked: false,
    revision: 0,
  });
  // New primitives start with a readable, non-overlapping face-corner atlas.
  // Artists can immediately find every logical polygon before choosing a
  // seam-based or projection unwrap.
  return packUVIslandsGrid(mesh, undefined, 0.035);
}

/** Unit cube centered on origin, then lifted by position.y. */
export function createBoxMesh(sx = 1, sy = 1, sz = 1): CADMesh {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;

  //        4 ---- 5
  //       /|     /|
  //      0 ---- 1 |
  //      | 7 ---| 6
  //      |/     |/
  //      3 ---- 2
  const verts = [
    v(-hx, hy, hz), // 0 front-top-left
    v(hx, hy, hz), // 1 front-top-right
    v(hx, -hy, hz), // 2 front-bottom-right
    v(-hx, -hy, hz), // 3 front-bottom-left
    v(-hx, hy, -hz), // 4 back-top-left
    v(hx, hy, -hz), // 5 back-top-right
    v(hx, -hy, -hz), // 6 back-bottom-right
    v(-hx, -hy, -hz), // 7 back-bottom-left
  ];
  const ids = verts.map((vert) => vert.id);

  // CCW when viewed from outside
  const faces: Face[] = [
    face([ids[0], ids[1], ids[2], ids[3]]), // +Z front
    face([ids[5], ids[4], ids[7], ids[6]]), // -Z back
    face([ids[4], ids[0], ids[3], ids[7]]), // -X left
    face([ids[1], ids[5], ids[6], ids[2]]), // +X right
    face([ids[4], ids[5], ids[1], ids[0]]), // +Y top
    face([ids[3], ids[2], ids[6], ids[7]]), // -Y bottom
  ];

  return meshFrom('Cube Primitive', verts, faces, { x: 0, y: hy, z: 0 });
}

export function createPlaneMesh(sx = 1, sz = 1): CADMesh {
  const hx = sx / 2;
  const hz = sz / 2;
  const verts = [v(-hx, 0, -hz), v(hx, 0, -hz), v(hx, 0, hz), v(-hx, 0, hz)];
  const ids = verts.map((vert) => vert.id);
  // Normal +Y
  const faces = [face([ids[0], ids[1], ids[2], ids[3]], uvRect())];
  return meshFrom('Plane Primitive', verts, faces, { x: 0, y: 0, z: 0 });
}

export function createCylinderMesh(sx = 1, sy = 1, segments = 8): CADMesh {
  const n = Math.max(3, Math.floor(segments));
  const r = 0.5 * sx;
  const hy = sy / 2;
  const bottom: Vertex[] = [];
  const top: Vertex[] = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    bottom.push(v(x, -hy, z));
    top.push(v(x, hy, z));
  }

  const faces: Face[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const u0 = i / n;
    const u1 = (i + 1) / n;
    faces.push(
      face([bottom[i].id, bottom[j].id, top[j].id, top[i].id], [
        { u: u0, v: 0 },
        { u: u1, v: 0 },
        { u: u1, v: 1 },
        { u: u0, v: 1 },
      ])
    );
  }

  // Caps as n-gons (CCW from outside: top looking down from +Y → reverse circle for outward +Y)
  const topIds = top.map((t) => t.id);
  const bottomIds = [...bottom].reverse().map((b) => b.id);
  faces.push(
    face(
      topIds,
      topIds.map((_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { u: 0.5 + 0.5 * Math.cos(a), v: 0.5 + 0.5 * Math.sin(a) };
      })
    )
  );
  faces.push(
    face(
      bottomIds,
      bottomIds.map((_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { u: 0.5 + 0.5 * Math.cos(a), v: 0.5 + 0.5 * Math.sin(a) };
      })
    )
  );

  return meshFrom('Cylinder Primitive', [...bottom, ...top], faces, { x: 0, y: hy, z: 0 });
}

export function createConeMesh(sx = 1, sy = 1, segments = 8): CADMesh {
  const n = Math.max(3, Math.floor(segments));
  const r = 0.5 * sx;
  const hy = sy / 2;
  const apex = v(0, hy, 0);
  const base: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    base.push(v(Math.cos(a) * r, -hy, Math.sin(a) * r));
  }

  const faces: Face[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(face([base[i].id, base[j].id, apex.id]));
  }
  // Base cap n-gon, outward -Y
  faces.push(face([...base].reverse().map((b) => b.id)));

  return meshFrom('Cone Primitive', [apex, ...base], faces, { x: 0, y: hy, z: 0 });
}

export function createPyramidMesh(sx = 1, sy = 1, sz = 1): CADMesh {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const apex = v(0, hy, 0);
  const b0 = v(-hx, -hy, hz);
  const b1 = v(hx, -hy, hz);
  const b2 = v(hx, -hy, -hz);
  const b3 = v(-hx, -hy, -hz);
  const faces = [
    face([b0.id, b1.id, apex.id]),
    face([b1.id, b2.id, apex.id]),
    face([b2.id, b3.id, apex.id]),
    face([b3.id, b0.id, apex.id]),
    face([b0.id, b3.id, b2.id, b1.id]), // base quad
  ];
  return meshFrom('Pyramid Primitive', [apex, b0, b1, b2, b3], faces, { x: 0, y: hy, z: 0 });
}

export function createRampMesh(sx = 1, sy = 1, sz = 1): CADMesh {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  // Wedge: high at -Z, low at +Z
  const verts = [
    v(-hx, hy, -hz), // 0 top back L
    v(hx, hy, -hz), // 1 top back R
    v(hx, -hy, -hz), // 2 bottom back R
    v(-hx, -hy, -hz), // 3 bottom back L
    v(hx, -hy, hz), // 4 bottom front R
    v(-hx, -hy, hz), // 5 bottom front L
  ];
  const id = verts.map((vert) => vert.id);
  const faces = [
    face([id[0], id[1], id[2], id[3]]), // back wall
    face([id[1], id[0], id[5], id[4]]), // ramp slope (quad)
    face([id[3], id[2], id[4], id[5]]), // bottom
    face([id[0], id[3], id[5]]), // left triangle
    face([id[1], id[4], id[2]]), // right triangle
  ];
  return meshFrom('Ramp Primitive', verts, faces, { x: 0, y: hy, z: 0 });
}

export function createUVSphereMesh(sx = 1, widthSegments = 8, heightSegments = 6): CADMesh {
  const radius = 0.5 * sx;
  const w = Math.max(3, Math.floor(widthSegments));
  const h = Math.max(2, Math.floor(heightSegments));

  const north = v(0, radius, 0);
  const south = v(0, -radius, 0);
  const rings: Vertex[][] = [];

  for (let iy = 1; iy < h; iy++) {
    const phi = (iy / h) * Math.PI;
    const row: Vertex[] = [];
    for (let ix = 0; ix < w; ix++) {
      const theta = (ix / w) * Math.PI * 2;
      const x = -radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(theta) * Math.sin(phi);
      row.push(v(x, y, z));
    }
    rings.push(row);
  }

  const faces: Face[] = [];
  // North pole triangles
  for (let ix = 0; ix < w; ix++) {
    const ix2 = (ix + 1) % w;
    const a = rings[0][ix];
    const b = rings[0][ix2];
    faces.push(
      face([north.id, b.id, a.id], [
        { u: (ix + 0.5) / w, v: 0 },
        { u: (ix + 1) / w, v: 1 / h },
        { u: ix / w, v: 1 / h },
      ])
    );
  }

  // Quad belts
  for (let iy = 0; iy < rings.length - 1; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const ix2 = (ix + 1) % w;
      const a = rings[iy][ix];
      const b = rings[iy][ix2];
      const c = rings[iy + 1][ix2];
      const d = rings[iy + 1][ix];
      faces.push(
        face([a.id, b.id, c.id, d.id], [
          { u: ix / w, v: (iy + 1) / h },
          { u: (ix + 1) / w, v: (iy + 1) / h },
          { u: (ix + 1) / w, v: (iy + 2) / h },
          { u: ix / w, v: (iy + 2) / h },
        ])
      );
    }
  }

  // South pole triangles
  const last = rings[rings.length - 1];
  for (let ix = 0; ix < w; ix++) {
    const ix2 = (ix + 1) % w;
    faces.push(
      face([last[ix].id, last[ix2].id, south.id], [
        { u: ix / w, v: (h - 1) / h },
        { u: (ix + 1) / w, v: (h - 1) / h },
        { u: (ix + 0.5) / w, v: 1 },
      ])
    );
  }

  const verts = [north, south, ...rings.flat()];
  return meshFrom('Sphere Primitive', verts, faces, { x: 0, y: radius, z: 0 });
}

export function createTorusMesh(
  sx = 1,
  tubularSegments = 8,
  radialSegments = 6,
  tubeRatio = 0.375
): CADMesh {
  const R = 0.4 * sx;
  const r = 0.15 * sx * (tubeRatio / 0.375);
  const tub = Math.max(3, Math.floor(tubularSegments));
  const rad = Math.max(3, Math.floor(radialSegments));
  const grid: Vertex[][] = [];

  for (let i = 0; i < tub; i++) {
    const row: Vertex[] = [];
    const u = (i / tub) * Math.PI * 2;
    for (let j = 0; j < rad; j++) {
      const vAng = (j / rad) * Math.PI * 2;
      const x = (R + r * Math.cos(vAng)) * Math.cos(u);
      const y = r * Math.sin(vAng);
      const z = (R + r * Math.cos(vAng)) * Math.sin(u);
      row.push(v(x, y, z));
    }
    grid.push(row);
  }

  const faces: Face[] = [];
  for (let i = 0; i < tub; i++) {
    const i2 = (i + 1) % tub;
    for (let j = 0; j < rad; j++) {
      const j2 = (j + 1) % rad;
      const a = grid[i][j];
      const b = grid[i2][j];
      const c = grid[i2][j2];
      const d = grid[i][j2];
      faces.push(
        face([a.id, b.id, c.id, d.id], [
          { u: i / tub, v: j / rad },
          { u: (i + 1) / tub, v: j / rad },
          { u: (i + 1) / tub, v: (j + 1) / rad },
          { u: i / tub, v: (j + 1) / rad },
        ])
      );
    }
  }

  const verts = grid.flat();
  return meshFrom('Torus Primitive', verts, faces, { x: 0, y: r, z: 0 });
}

export function createTorusKnotMesh(sx = 1, tubularSegments = 64, radialSegments = 8): CADMesh {
  // Simplified closed tube along a (2,3) torus knot with stable frames
  const tub = Math.max(16, Math.floor(tubularSegments));
  const rad = Math.max(3, Math.floor(radialSegments));
  const scale = 0.35 * sx;
  const tube = 0.08 * sx;

  const centers: Vector3D[] = [];
  const tangents: Vector3D[] = [];
  for (let i = 0; i < tub; i++) {
    const t = (i / tub) * Math.PI * 2;
    const p = knotPoint(t, scale);
    const p2 = knotPoint(t + 0.001, scale);
    centers.push(p);
    tangents.push({
      x: p2.x - p.x,
      y: p2.y - p.y,
      z: p2.z - p.z,
    });
  }

  const grid: Vertex[][] = [];
  let normal = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < tub; i++) {
    const T = tangents[i];
    const tLen = Math.hypot(T.x, T.y, T.z) || 1;
    const tx = T.x / tLen;
    const ty = T.y / tLen;
    const tz = T.z / tLen;
    // Parallel transport
    let cx = ty * normal.z - tz * normal.y;
    let cy = tz * normal.x - tx * normal.z;
    let cz = tx * normal.y - ty * normal.x;
    let cLen = Math.hypot(cx, cy, cz);
    if (cLen < 1e-6) {
      cx = ty * 1 - tz * 0;
      cy = tz * 0 - tx * 1;
      cz = tx * 0 - ty * 0;
      cLen = Math.hypot(cx, cy, cz) || 1;
    }
    cx /= cLen;
    cy /= cLen;
    cz /= cLen;
    const nx = cy * tz - cz * ty;
    const ny = cz * tx - cx * tz;
    const nz = cx * ty - cy * tx;
    normal = { x: nx, y: ny, z: nz };

    const row: Vertex[] = [];
    const c = centers[i];
    for (let j = 0; j < rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const ox = (Math.cos(a) * cx + Math.sin(a) * nx) * tube;
      const oy = (Math.cos(a) * cy + Math.sin(a) * ny) * tube;
      const oz = (Math.cos(a) * cz + Math.sin(a) * nz) * tube;
      row.push(v(c.x + ox, c.y + oy, c.z + oz));
    }
    grid.push(row);
  }

  const faces: Face[] = [];
  for (let i = 0; i < tub; i++) {
    const i2 = (i + 1) % tub;
    for (let j = 0; j < rad; j++) {
      const j2 = (j + 1) % rad;
      faces.push(
        face([grid[i][j].id, grid[i2][j].id, grid[i2][j2].id, grid[i][j2].id])
      );
    }
  }

  return meshFrom('Torus Knot Primitive', grid.flat(), faces, { x: 0, y: scale, z: 0 });
}

function knotPoint(t: number, scale: number): Vector3D {
  const p = 2;
  const q = 3;
  const r = 0.5 * scale * (2 + Math.cos(q * t));
  return {
    x: r * Math.cos(p * t),
    y: r * Math.sin(p * t),
    z: 0.5 * scale * Math.sin(q * t),
  };
}

export function createTetrahedronMesh(sx = 1): CADMesh {
  const s = 0.5 * sx;
  const verts = [
    v(s, s, s),
    v(s, -s, -s),
    v(-s, s, -s),
    v(-s, -s, s),
  ];
  const id = verts.map((vert) => vert.id);
  const faces = [
    face([id[0], id[1], id[2]]),
    face([id[0], id[2], id[3]]),
    face([id[0], id[3], id[1]]),
    face([id[1], id[3], id[2]]),
  ];
  return meshFrom('Tetrahedron Primitive', verts, faces, { x: 0, y: s, z: 0 });
}

export function createOctahedronMesh(sx = 1): CADMesh {
  const s = 0.5 * sx;
  const verts = [v(s, 0, 0), v(-s, 0, 0), v(0, s, 0), v(0, -s, 0), v(0, 0, s), v(0, 0, -s)];
  const id = verts.map((vert) => vert.id);
  const faces = [
    face([id[0], id[2], id[4]]),
    face([id[2], id[1], id[4]]),
    face([id[1], id[3], id[4]]),
    face([id[3], id[0], id[4]]),
    face([id[2], id[0], id[5]]),
    face([id[1], id[2], id[5]]),
    face([id[3], id[1], id[5]]),
    face([id[0], id[3], id[5]]),
  ];
  return meshFrom('Octahedron Primitive', verts, faces, { x: 0, y: s, z: 0 });
}

export function createIcosahedronMesh(sx = 1): CADMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vector3D[] = [
    { x: -1, y: t, z: 0 },
    { x: 1, y: t, z: 0 },
    { x: -1, y: -t, z: 0 },
    { x: 1, y: -t, z: 0 },
    { x: 0, y: -1, z: t },
    { x: 0, y: 1, z: t },
    { x: 0, y: -1, z: -t },
    { x: 0, y: 1, z: -t },
    { x: t, y: 0, z: -1 },
    { x: t, y: 0, z: 1 },
    { x: -t, y: 0, z: -1 },
    { x: -t, y: 0, z: 1 },
  ];
  const scale = (0.5 * sx) / Math.hypot(1, t);
  const verts = raw.map((p) => v(p.x * scale, p.y * scale, p.z * scale));
  const id = verts.map((vert) => vert.id);
  const facesIdx = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const faces = facesIdx.map((tri) => face([id[tri[0]], id[tri[1]], id[tri[2]]]));
  return meshFrom('Icosahedron Primitive', verts, faces, { x: 0, y: 0.5 * sx, z: 0 });
}

/** Regular dodecahedron with logical pentagon faces. */
export function createDodecahedronMesh(sx = 1): CADMesh {
  const phi = (1 + Math.sqrt(5)) / 2;
  const inv = 1 / phi;
  // Standard 20 vertices:
  const standard: Vector3D[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) standard.push({ x, y, z });
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      standard.push({ x: 0, y: a * inv, z: b * phi });
      standard.push({ x: a * inv, y: b * phi, z: 0 });
      standard.push({ x: a * phi, y: 0, z: b * inv });
    }
  }

  const scale = (0.5 * sx) / Math.hypot(1, 1, 1);
  const verts = standard.map((p) => v(p.x * scale, p.y * scale, p.z * scale));

  // Build pentagon faces by finding coplanar 5-cycles via neighbor distance
  const faces = buildDodecahedronPentagons(verts);
  return meshFrom('Dodecahedron Primitive', verts, faces, { x: 0, y: 0.5 * sx, z: 0 });
}

function buildDodecahedronPentagons(verts: Vertex[]): Face[] {
  // Edge length of unit dodecahedron between adjacent verts ≈ 2/phi
  const positions = verts.map((vert) => ({ id: vert.id, x: vert.x, y: vert.y, z: vert.z }));
  let minD = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const d = Math.hypot(
        positions[i].x - positions[j].x,
        positions[i].y - positions[j].y,
        positions[i].z - positions[j].z
      );
      if (d > 1e-8 && d < minD) minD = d;
    }
  }
  const adj = new Map<string, string[]>();
  positions.forEach((p) => adj.set(p.id, []));
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const d = Math.hypot(
        positions[i].x - positions[j].x,
        positions[i].y - positions[j].y,
        positions[i].z - positions[j].z
      );
      if (Math.abs(d - minD) < minD * 0.15) {
        adj.get(positions[i].id)!.push(positions[j].id);
        adj.get(positions[j].id)!.push(positions[i].id);
      }
    }
  }

  const posMap = new Map(positions.map((p) => [p.id, p]));
  const faceKeys = new Set<string>();
  const faces: Face[] = [];

  // Walk pentagon cycles
  for (const start of positions) {
    const neighbors = adj.get(start.id) || [];
    for (const n0 of neighbors) {
      // DFS depth 5 back to start
      const path = [start.id, n0];
      const walk = (cur: string, prev: string): void => {
        if (path.length === 5) {
          if ((adj.get(cur) || []).includes(start.id)) {
            const cycle = [...path];
            const key = [...cycle].sort().join('|');
            if (!faceKeys.has(key)) {
              faceKeys.add(key);
              // Order CCW by average normal
              const ordered = orderPolygonOutward(cycle, posMap);
              faces.push(face(ordered));
            }
          }
          return;
        }
        for (const nxt of adj.get(cur) || []) {
          if (nxt === prev || path.includes(nxt)) continue;
          path.push(nxt);
          walk(nxt, cur);
          path.pop();
        }
      };
      walk(n0, start.id);
    }
  }

  // Expect 12 faces; if fewer, fall back to triangles from convex hull isn't ideal —
  // filter only length-5
  return faces.filter((f) => f.vertexIds.length === 5).slice(0, 12);
}

function orderPolygonOutward(
  ids: string[],
  posMap: Map<string, { x: number; y: number; z: number }>
): string[] {
  const pts = ids.map((id) => posMap.get(id)!);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  pts.forEach((p) => {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  });
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  // Newell normal
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  if (nx * cx + ny * cy + nz * cz < 0) return [...ids].reverse();
  return ids;
}

export function createDiscMesh(sx = 1, segments = 16): CADMesh {
  const n = Math.max(3, Math.floor(segments));
  const r = 0.5 * sx;
  const rim: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    rim.push(v(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const faces = [face(rim.map((vert) => vert.id))];
  return meshFrom('Disc Primitive', rim, faces, { x: 0, y: 0, z: 0 });
}

export function createRingSurfaceMesh(sx = 1, segments = 16, tubeRatio = 0.5): CADMesh {
  const n = Math.max(3, Math.floor(segments));
  const outer = 0.5 * sx;
  const inner = outer * Math.max(0.1, Math.min(0.9, tubeRatio));
  const outV: Vertex[] = [];
  const inV: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    outV.push(v(Math.cos(a) * outer, 0, Math.sin(a) * outer));
    inV.push(v(Math.cos(a) * inner, 0, Math.sin(a) * inner));
  }
  const faces: Face[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(face([outV[i].id, outV[j].id, inV[j].id, inV[i].id]));
  }
  return meshFrom('Ring Primitive', [...outV, ...inV], faces, { x: 0, y: 0, z: 0 });
}

export function createTubeMesh(sx = 1, sy = 1, segments = 8, thickness = 0.2): CADMesh {
  const n = Math.max(3, Math.floor(segments));
  const outerR = 0.5 * sx;
  const innerR = Math.max(0.05, outerR * (1 - thickness));
  const hy = sy / 2;
  const ob: Vertex[] = [];
  const ot: Vertex[] = [];
  const ib: Vertex[] = [];
  const it: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ob.push(v(c * outerR, -hy, s * outerR));
    ot.push(v(c * outerR, hy, s * outerR));
    ib.push(v(c * innerR, -hy, s * innerR));
    it.push(v(c * innerR, hy, s * innerR));
  }
  const faces: Face[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // outer wall
    faces.push(face([ob[i].id, ob[j].id, ot[j].id, ot[i].id]));
    // inner wall (reversed winding — normals into hollow)
    faces.push(face([ib[j].id, ib[i].id, it[i].id, it[j].id]));
    // top rim
    faces.push(face([ot[i].id, ot[j].id, it[j].id, it[i].id]));
    // bottom rim
    faces.push(face([ob[j].id, ob[i].id, ib[i].id, ib[j].id]));
  }
  return meshFrom('Tube Primitive', [...ob, ...ot, ...ib, ...it], faces, { x: 0, y: hy, z: 0 });
}

/** Compound “chest” from a box (editable). */
export function createChestMesh(sx = 1, sy = 1, sz = 1): CADMesh {
  const m = createBoxMesh(sx, sy * 0.75, sz);
  return { ...m, name: 'Chest Primitive', position: { x: 0, y: (sy * 0.75) / 2, z: 0 } };
}

export function createPrimitiveMesh(type: PrimitiveType, customSize?: Vector3D): CADMesh {
  const sx = customSize?.x || 1;
  const sy = customSize?.y || 1;
  const sz = customSize?.z || 1;

  switch (type) {
    case 'cube':
    case 'chest':
      return type === 'chest' ? createChestMesh(sx, sy, sz) : createBoxMesh(sx, sy, sz);
    case 'plane':
      return createPlaneMesh(sx, sz);
    case 'cylinder':
      return createCylinderMesh(sx, sy, 8);
    case 'cone':
      return createConeMesh(sx, sy, 8);
    case 'pyramid':
      return createPyramidMesh(sx, sy, sz);
    case 'ramp':
      return createRampMesh(sx, sy, sz);
    case 'sphere':
      return createUVSphereMesh(sx, 8, 6);
    case 'torus':
      return createTorusMesh(sx, 8, 6);
    case 'torusKnot':
      return createTorusKnotMesh(sx, 48, 6);
    case 'tetrahedron':
      return createTetrahedronMesh(sx);
    case 'octahedron':
      return createOctahedronMesh(sx);
    case 'icosahedron':
      return createIcosahedronMesh(sx);
    case 'dodecahedron':
      return createDodecahedronMesh(sx);
    case 'circle':
      return createDiscMesh(sx, 16);
    case 'ring':
      return createRingSurfaceMesh(sx, 16);
    case 'tube':
      return createTubeMesh(sx, sy, 8);
    case 'lathe':
      return createCylinderMesh(sx * 0.6, sy, 12);
    case 'tree':
    case 'car':
    default:
      return createBoxMesh(sx, sy, sz);
  }
}

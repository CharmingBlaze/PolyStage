import type { CADMesh, Edge, Face, UVCoord, Vertex } from '../types/cad';
import { generateId, createEdgesFromFaces } from './meshUtils';
import { finalizeEditableMesh } from './topology/validate';
import { subdivideFaces } from './advancedMeshTools';

/**
 * One or more Catmull-Clark subdivision iterations (Blender Subdivision Surface).
 */
export function catmullClarkSubdivide(mesh: CADMesh, levels = 1): CADMesh {
  let current = mesh;
  for (let i = 0; i < Math.max(0, levels); i++) {
    current = catmullClarkOnce(current);
  }
  return current;
}

function catmullClarkOnce(mesh: CADMesh): CADMesh {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const faces = mesh.faces.filter((f) => f.vertexIds.length >= 3);
  if (faces.length === 0) return mesh;

  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const edgeFaces = new Map<string, string[]>();
  const edgeEnds = new Map<string, [string, string]>();
  faces.forEach((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = f.vertexIds[i];
      const b = f.vertexIds[(i + 1) % n];
      const key = edgeKey(a, b);
      edgeEnds.set(key, [a, b]);
      const list = edgeFaces.get(key) || [];
      list.push(f.id);
      edgeFaces.set(key, list);
    }
  });

  const facePoints = new Map<string, Vertex>();
  faces.forEach((f) => {
    let x = 0;
    let y = 0;
    let z = 0;
    f.vertexIds.forEach((id) => {
      const v = vertMap.get(id)!;
      x += v.x;
      y += v.y;
      z += v.z;
    });
    const n = f.vertexIds.length;
    facePoints.set(f.id, { id: generateId(), x: x / n, y: y / n, z: z / n });
  });

  const edgePoints = new Map<string, Vertex>();
  edgeEnds.forEach(([a, b], key) => {
    const va = vertMap.get(a)!;
    const vb = vertMap.get(b)!;
    const adj = edgeFaces.get(key) || [];
    let x: number;
    let y: number;
    let z: number;
    if (adj.length === 2) {
      const f1 = facePoints.get(adj[0])!;
      const f2 = facePoints.get(adj[1])!;
      x = (va.x + vb.x + f1.x + f2.x) / 4;
      y = (va.y + vb.y + f1.y + f2.y) / 4;
      z = (va.z + vb.z + f1.z + f2.z) / 4;
    } else {
      x = (va.x + vb.x) / 2;
      y = (va.y + vb.y) / 2;
      z = (va.z + vb.z) / 2;
    }
    edgePoints.set(key, { id: generateId(), x, y, z });
  });

  const vertEdges = new Map<string, string[]>();
  const vertFaces = new Map<string, string[]>();
  edgeEnds.forEach(([a, b], key) => {
    (vertEdges.get(a) || (vertEdges.set(a, []), vertEdges.get(a)!)).push(key);
    (vertEdges.get(b) || (vertEdges.set(b, []), vertEdges.get(b)!)).push(key);
  });
  faces.forEach((f) => {
    f.vertexIds.forEach((vid) => {
      (vertFaces.get(vid) || (vertFaces.set(vid, []), vertFaces.get(vid)!)).push(f.id);
    });
  });

  const newOrigVerts = new Map<string, Vertex>();
  mesh.vertices.forEach((v) => {
    const nFaces = vertFaces.get(v.id) || [];
    const nEdges = vertEdges.get(v.id) || [];
    const n = nFaces.length;
    if (n < 3 || nEdges.length !== n) {
      if (nEdges.length === 0) {
        newOrigVerts.set(v.id, { ...v, id: generateId() });
        return;
      }
      let x = 0;
      let y = 0;
      let z = 0;
      nEdges.forEach((ek) => {
        const [a, b] = edgeEnds.get(ek)!;
        const other = a === v.id ? vertMap.get(b)! : vertMap.get(a)!;
        x += other.x;
        y += other.y;
        z += other.z;
      });
      const m = nEdges.length;
      newOrigVerts.set(v.id, {
        id: generateId(),
        x: (v.x + x / m) / 2,
        y: (v.y + y / m) / 2,
        z: (v.z + z / m) / 2,
      });
      return;
    }

    let fx = 0;
    let fy = 0;
    let fz = 0;
    nFaces.forEach((fid) => {
      const fp = facePoints.get(fid)!;
      fx += fp.x;
      fy += fp.y;
      fz += fp.z;
    });
    fx /= n;
    fy /= n;
    fz /= n;

    let rx = 0;
    let ry = 0;
    let rz = 0;
    nEdges.forEach((ek) => {
      const [a, b] = edgeEnds.get(ek)!;
      const va = vertMap.get(a)!;
      const vb = vertMap.get(b)!;
      rx += (va.x + vb.x) / 2;
      ry += (va.y + vb.y) / 2;
      rz += (va.z + vb.z) / 2;
    });
    rx /= n;
    ry /= n;
    rz /= n;

    newOrigVerts.set(v.id, {
      id: generateId(),
      x: (fx + 2 * rx + (n - 3) * v.x) / n,
      y: (fy + 2 * ry + (n - 3) * v.y) / n,
      z: (fz + 2 * rz + (n - 3) * v.z) / n,
    });
  });

  const allVerts: Vertex[] = [
    ...facePoints.values(),
    ...edgePoints.values(),
    ...newOrigVerts.values(),
  ];

  const newFaces: Face[] = [];
  faces.forEach((f) => {
    const fp = facePoints.get(f.id)!;
    const n = f.vertexIds.length;
    const uCenter: UVCoord = {
      u: f.uvs.reduce((s, uv) => s + (uv?.u || 0), 0) / Math.max(1, f.uvs.length),
      v: f.uvs.reduce((s, uv) => s + (uv?.v || 0), 0) / Math.max(1, f.uvs.length),
    };
    for (let i = 0; i < n; i++) {
      const curr = f.vertexIds[i];
      const next = f.vertexIds[(i + 1) % n];
      const prev = f.vertexIds[(i + n - 1) % n];
      const eNext = edgePoints.get(edgeKey(curr, next))!;
      const ePrev = edgePoints.get(edgeKey(prev, curr))!;
      const corner = newOrigVerts.get(curr)!;
      const u0 = f.uvs[i] || { u: 0, v: 0 };
      const uNext = f.uvs[(i + 1) % n] || u0;
      const uPrev = f.uvs[(i + n - 1) % n] || u0;
      newFaces.push({
        id: generateId(),
        vertexIds: [corner.id, eNext.id, fp.id, ePrev.id],
        uvs: [
          u0,
          { u: (u0.u + uNext.u) / 2, v: (u0.v + uNext.v) / 2 },
          uCenter,
          { u: (u0.u + uPrev.u) / 2, v: (u0.v + uPrev.v) / 2 },
        ],
        color: f.color,
        materialId: f.materialId,
      });
    }
  });

  return finalizeEditableMesh({
    ...mesh,
    vertices: allVerts,
    faces: newFaces,
    edges: createEdgesFromFaces(newFaces) as Edge[],
    revision: (mesh.revision || 0) + 1,
    modifiers: mesh.modifiers,
  });
}

export function applySimpleSubdivideLevels(mesh: CADMesh, levels: number): CADMesh {
  let current = mesh;
  for (let i = 0; i < levels; i++) current = subdivideFaces(current);
  return current;
}

/**
 * Edge bevel / chamfer with mover metadata for Blender-style modal preview.
 */
import type { CADMesh, Face, Vertex, Edge } from '../types/cad';
import { generateId, makeEdgeId } from './topology/ids';
import { finalizeEditableMesh } from './topology/validate';

export interface BevelMover {
  id: string;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ChamferEdgesResult {
  mesh: CADMesh;
  movers: BevelMover[];
  stripFaceIds: string[];
}

/**
 * Build bevel topology once. Vertices start at amount=0 (on the original edge);
 * movers encode the offset for amount=1 so modal preview only moves verts.
 * `segments` > 1 inserts intermediate strip rings (Blender scroll-wheel).
 */
export function chamferEdges(
  mesh: CADMesh,
  edgeIds: string[],
  amount = 0.1,
  segments = 1,
): ChamferEdgesResult {
  const empty: ChamferEdgesResult = { mesh, movers: [], stripFaceIds: [] };
  if (edgeIds.length === 0) return empty;

  // Resolve by id first, then by stable makeEdgeId(v1,v2) so selection survives rebuilds.
  const byId = new Map(mesh.edges.map((e) => [e.id, e]));
  const byKey = new Map(mesh.edges.map((e) => [makeEdgeId(e.v1Id, e.v2Id), e]));
  const targetEdges: Edge[] = [];
  const seen = new Set<string>();
  for (const id of edgeIds) {
    const direct = byId.get(id);
    const edged = direct || byKey.get(id) || mesh.edges.find((e) => makeEdgeId(e.v1Id, e.v2Id) === id);
    if (!edged) continue;
    const key = makeEdgeId(edged.v1Id, edged.v2Id);
    if (seen.has(key)) continue;
    seen.add(key);
    targetEdges.push(edged);
  }
  if (targetEdges.length === 0) return empty;

  const segs = Math.max(1, Math.min(8, Math.round(segments)));
  // Bevel one edge at a time from the original mesh for a single selection;
  // for multi-edge, sequential on evolving mesh (best-effort).
  if (targetEdges.length === 1) {
    return chamferSingleEdgeSession(mesh, targetEdges[0], amount, segs);
  }

  let current = mesh;
  const allMovers: BevelMover[] = [];
  const allStrips: string[] = [];

  for (const edge of targetEdges) {
    const still = current.edges.find(
      (e) => makeEdgeId(e.v1Id, e.v2Id) === makeEdgeId(edge.v1Id, edge.v2Id),
    );
    if (!still) continue;
    const piece = chamferSingleEdgeSession(current, still, amount, segs);
    current = piece.mesh;
    allMovers.push(...piece.movers);
    allStrips.push(...piece.stripFaceIds);
  }

  return { mesh: current, movers: allMovers, stripFaceIds: allStrips };
}

function chamferSingleEdgeSession(
  mesh: CADMesh,
  edge: Edge,
  amount: number,
  segments: number,
): ChamferEdgesResult {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const v1 = vertMap.get(edge.v1Id);
  const v2 = vertMap.get(edge.v2Id);
  if (!v1 || !v2) return { mesh, movers: [], stripFaceIds: [] };

  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const key = edgeKey(edge.v1Id, edge.v2Id);
  const t = Math.max(0, Math.min(1, amount));
  const segs = Math.max(1, Math.min(8, segments));

  const adjacent = mesh.faces.filter((f) => {
    const n = f.vertexIds.length;
    for (let i = 0; i < n; i++) {
      if (edgeKey(f.vertexIds[i], f.vertexIds[(i + 1) % n]) === key) return true;
    }
    return false;
  });
  if (adjacent.length === 0) return { mesh, movers: [], stripFaceIds: [] };

  const movers: BevelMover[] = [];
  const newVertices: Vertex[] = [...mesh.vertices];

  const makeOffsetVert = (
    alongBase: { x: number; y: number; z: number },
    toward: { x: number; y: number; z: number },
  ): string => {
    const ox = alongBase.x;
    const oy = alongBase.y;
    const oz = alongBase.z;
    const dx = toward.x - alongBase.x;
    const dy = toward.y - alongBase.y;
    const dz = toward.z - alongBase.z;
    const id = generateId();
    newVertices.push({
      id,
      x: ox + dx * t,
      y: oy + dy * t,
      z: oz + dz * t,
    });
    movers.push({ id, ox, oy, oz, dx, dy, dz });
    return id;
  };

  const faceCuts: { faceId: string; rings: string[][]; orderOuter: [string, string] }[] = [];

  adjacent.forEach((face) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    face.vertexIds.forEach((id) => {
      const v = vertMap.get(id)!;
      cx += v.x;
      cy += v.y;
      cz += v.z;
    });
    cx /= face.vertexIds.length;
    cy /= face.vertexIds.length;
    cz /= face.vertexIds.length;
    const center = { x: cx, y: cy, z: cz };

    const pull = 0.55;
    const rings: string[][] = [];
    for (let s = 1; s <= segs; s++) {
      const alongFrac = (s / segs) * 0.5;
      const pullS = pull * (s / segs);
      const along1 = {
        x: v1.x + (v2.x - v1.x) * alongFrac,
        y: v1.y + (v2.y - v1.y) * alongFrac,
        z: v1.z + (v2.z - v1.z) * alongFrac,
      };
      const along2 = {
        x: v2.x + (v1.x - v2.x) * alongFrac,
        y: v2.y + (v1.y - v2.y) * alongFrac,
        z: v2.z + (v1.z - v2.z) * alongFrac,
      };
      const base1 = { x: v1.x, y: v1.y, z: v1.z };
      const base2 = { x: v2.x, y: v2.y, z: v2.z };
      const target1 = {
        x: along1.x + (center.x - along1.x) * pullS,
        y: along1.y + (center.y - along1.y) * pullS,
        z: along1.z + (center.z - along1.z) * pullS,
      };
      const target2 = {
        x: along2.x + (center.x - along2.x) * pullS,
        y: along2.y + (center.y - along2.y) * pullS,
        z: along2.z + (center.z - along2.z) * pullS,
      };
      rings.push([makeOffsetVert(base1, target1), makeOffsetVert(base2, target2)]);
    }

    let orderOuter: [string, string] = [rings[rings.length - 1][0], rings[rings.length - 1][1]];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      if (a === edge.v1Id && b === edge.v2Id) {
        orderOuter = [rings[rings.length - 1][0], rings[rings.length - 1][1]];
        break;
      }
      if (a === edge.v2Id && b === edge.v1Id) {
        orderOuter = [rings[rings.length - 1][1], rings[rings.length - 1][0]];
        rings.forEach((r) => r.reverse());
        break;
      }
    }
    faceCuts.push({ faceId: face.id, rings, orderOuter });
  });

  const cutByFace = new Map(faceCuts.map((c) => [c.faceId, c]));
  const newFaces: Face[] = [];
  const stripFaceIds: string[] = [];

  mesh.faces.forEach((face) => {
    const cut = cutByFace.get(face.id);
    if (!cut) {
      newFaces.push(face);
      return;
    }
    const outer = cut.orderOuter;
    const rebuilt: string[] = [];
    const rebuiltUvs: { u: number; v: number }[] = [];
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const a = face.vertexIds[i];
      const b = face.vertexIds[(i + 1) % n];
      const ua = face.uvs[i] || { u: 0, v: 0 };
      rebuilt.push(a);
      rebuiltUvs.push({ ...ua });
      if (edgeKey(a, b) === key) {
        rebuilt.push(outer[0], outer[1]);
        rebuiltUvs.push({ u: ua.u, v: ua.v }, { u: ua.u, v: ua.v });
      }
    }
    const filtered: string[] = [];
    const filteredUvs: { u: number; v: number }[] = [];
    for (let i = 0; i < rebuilt.length; i++) {
      const id = rebuilt[i];
      if (id === edge.v1Id || id === edge.v2Id) continue;
      filtered.push(id);
      filteredUvs.push(rebuiltUvs[i]);
    }
    if (filtered.length >= 3) {
      newFaces.push({
        ...face,
        id: generateId(),
        vertexIds: filtered,
        uvs: filteredUvs,
      });
    }
  });

  if (faceCuts.length >= 2) {
    const a = faceCuts[0];
    const b = faceCuts[1];
    for (let s = 0; s < segs; s++) {
      const aRing = a.rings[s];
      const bRing = b.rings[s];
      const id = generateId();
      stripFaceIds.push(id);
      newFaces.push({
        id,
        vertexIds: [aRing[0], aRing[1], bRing[1], bRing[0]],
        uvs: [
          { u: 0, v: 0 },
          { u: 1, v: 0 },
          { u: 1, v: 1 },
          { u: 0, v: 1 },
        ],
      });
    }
    for (let s = 0; s < segs - 1; s++) {
      for (const cut of [a, b]) {
        const r0 = cut.rings[s];
        const r1 = cut.rings[s + 1];
        const id = generateId();
        stripFaceIds.push(id);
        newFaces.push({
          id,
          vertexIds: [r0[0], r0[1], r1[1], r1[0]],
          uvs: [
            { u: 0, v: 0 },
            { u: 1, v: 0 },
            { u: 1, v: 1 },
            { u: 0, v: 1 },
          ],
        });
      }
    }
  } else if (faceCuts.length === 1) {
    const a = faceCuts[0];
    const outer = a.rings[a.rings.length - 1];
    const id = generateId();
    stripFaceIds.push(id);
    newFaces.push({
      id,
      vertexIds: [edge.v1Id, outer[0], outer[1], edge.v2Id],
      uvs: [
        { u: 0, v: 0 },
        { u: 0.5, v: 0 },
        { u: 0.5, v: 1 },
        { u: 1, v: 0 },
      ],
    });
  }

  const built = finalizeEditableMesh(
    {
      ...mesh,
      vertices: newVertices,
      faces: newFaces,
    },
    { validate: false },
  );

  return { mesh: built, movers, stripFaceIds };
}

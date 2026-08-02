import type { CADMesh, Edge, Face } from '../types/cad';
import { edgeKey } from './topology/ids';

/**
 * Pure sub-object selection algebra for the modelling workspace.
 *
 * Everything here is a plain function over `CADMesh` + ID arrays so the viewport can
 * stay a thin renderer and the behaviour can be unit tested without a WebGL context.
 * IDs are returned de-duplicated and in mesh order, which keeps React keys and
 * gizmo pivots stable across repeated operations.
 */

/** The three sub-object domains. `object` is handled by mesh-level selection. */
export type ComponentMode = 'vertex' | 'edge' | 'face';

export interface ComponentSelection {
  vertexIds: string[];
  edgeIds: string[];
  faceIds: string[];
}

/**
 * Shared "nothing selected" value. Safe to assign straight into React state because
 * nothing in the app mutates selection arrays in place, and the stable identity
 * spares the viewport a re-render.
 */
export const EMPTY_SELECTION: ComponentSelection = Object.freeze({
  vertexIds: [],
  edgeIds: [],
  faceIds: [],
}) as ComponentSelection;

// ————————————————————————————————————————————————————————————
// Topology index
// ————————————————————————————————————————————————————————————

export interface MeshTopologyIndex {
  edgeById: Map<string, Edge>;
  faceById: Map<string, Face>;
  /** Undirected vertex-pair key -> edge, so face boundaries can find their edge IDs. */
  edgeByKey: Map<string, Edge>;
  /** Vertex ID -> edges touching it. */
  edgesByVertex: Map<string, Edge[]>;
  /** Vertex ID -> faces using it. */
  facesByVertex: Map<string, Face[]>;
  /** Edge key -> faces sharing that boundary. */
  facesByEdgeKey: Map<string, Face[]>;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Iterate a face's boundary as consecutive vertex pairs (closing the loop). */
function forEachFaceEdge(face: Face, visit: (a: string, b: string) => void) {
  const ids = face.vertexIds;
  if (ids.length < 2) return;
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const b = ids[(i + 1) % ids.length];
    if (a && b && a !== b) visit(a, b);
  }
}

export function buildTopologyIndex(mesh: CADMesh): MeshTopologyIndex {
  const edgeById = new Map<string, Edge>();
  const edgeByKey = new Map<string, Edge>();
  const edgesByVertex = new Map<string, Edge[]>();

  mesh.edges.forEach((edge) => {
    edgeById.set(edge.id, edge);
    edgeByKey.set(edgeKey(edge.v1Id, edge.v2Id), edge);
    pushTo(edgesByVertex, edge.v1Id, edge);
    pushTo(edgesByVertex, edge.v2Id, edge);
  });

  const faceById = new Map<string, Face>();
  const facesByVertex = new Map<string, Face[]>();
  const facesByEdgeKey = new Map<string, Face[]>();

  mesh.faces.forEach((face) => {
    faceById.set(face.id, face);
    new Set(face.vertexIds).forEach((vId) => pushTo(facesByVertex, vId, face));
    forEachFaceEdge(face, (a, b) => pushTo(facesByEdgeKey, edgeKey(a, b), face));
  });

  return { edgeById, faceById, edgeByKey, edgesByVertex, facesByVertex, facesByEdgeKey };
}

/** Preserve mesh ordering while removing duplicates. */
function orderedBy<T extends { id: string }>(items: T[], ids: Iterable<string>): string[] {
  const wanted = ids instanceof Set ? ids : new Set(ids);
  if (wanted.size === 0) return [];
  const out: string[] = [];
  items.forEach((item) => {
    if (wanted.has(item.id)) out.push(item.id);
  });
  return out;
}

// ————————————————————————————————————————————————————————————
// Mode conversion
// ————————————————————————————————————————————————————————————

/** Vertices touched by the given edges. */
export function verticesOfEdges(mesh: CADMesh, edgeIds: string[]): string[] {
  const { edgeById } = buildTopologyIndex(mesh);
  const out = new Set<string>();
  edgeIds.forEach((id) => {
    const edge = edgeById.get(id);
    if (!edge) return;
    out.add(edge.v1Id);
    out.add(edge.v2Id);
  });
  return orderedBy(mesh.vertices, out);
}

/** Corner vertices of the given faces. */
export function verticesOfFaces(mesh: CADMesh, faceIds: string[]): string[] {
  const { faceById } = buildTopologyIndex(mesh);
  const out = new Set<string>();
  faceIds.forEach((id) => faceById.get(id)?.vertexIds.forEach((v) => out.add(v)));
  return orderedBy(mesh.vertices, out);
}

/** Edges whose *both* endpoints are in the vertex set (Blender's contract rule). */
export function edgesFullyInVertices(mesh: CADMesh, vertexIds: string[]): string[] {
  const set = new Set(vertexIds);
  const out = new Set<string>();
  mesh.edges.forEach((edge) => {
    if (set.has(edge.v1Id) && set.has(edge.v2Id)) out.add(edge.id);
  });
  return orderedBy(mesh.edges, out);
}

/** Faces whose every corner is in the vertex set. */
export function facesFullyInVertices(mesh: CADMesh, vertexIds: string[]): string[] {
  const set = new Set(vertexIds);
  const out = new Set<string>();
  mesh.faces.forEach((face) => {
    if (face.vertexIds.length > 0 && face.vertexIds.every((v) => set.has(v))) out.add(face.id);
  });
  return orderedBy(mesh.faces, out);
}

/** Boundary edges of the given faces. */
export function edgesOfFaces(mesh: CADMesh, faceIds: string[]): string[] {
  const index = buildTopologyIndex(mesh);
  const out = new Set<string>();
  faceIds.forEach((id) => {
    const face = index.faceById.get(id);
    if (!face) return;
    forEachFaceEdge(face, (a, b) => {
      const edge = index.edgeByKey.get(edgeKey(a, b));
      if (edge) out.add(edge.id);
    });
  });
  return orderedBy(mesh.edges, out);
}

/**
 * Carry a selection across a sub-object mode change so the user does not lose
 * their work every time they press 1/2/3/4.
 *
 * Widening (face -> vertex) takes everything the selection touches; narrowing
 * (vertex -> face) only takes components whose every corner is selected, which
 * matches Blender and avoids surprising over-selection.
 */
export function convertSelection(
  mesh: CADMesh,
  from: ComponentMode,
  to: ComponentMode,
  selection: ComponentSelection,
): ComponentSelection {
  if (from === to) return selection;

  // Normalise the source selection down to a vertex set, then rebuild upward.
  const vertexIds =
    from === 'vertex'
      ? selection.vertexIds
      : from === 'edge'
        ? verticesOfEdges(mesh, selection.edgeIds)
        : verticesOfFaces(mesh, selection.faceIds);

  if (vertexIds.length === 0) return { vertexIds: [], edgeIds: [], faceIds: [] };

  if (to === 'vertex') {
    return { vertexIds: orderedBy(mesh.vertices, vertexIds), edgeIds: [], faceIds: [] };
  }
  if (to === 'edge') {
    // Face -> edge keeps the face boundaries exactly; otherwise use the contract rule.
    const edgeIds =
      from === 'face'
        ? edgesOfFaces(mesh, selection.faceIds)
        : edgesFullyInVertices(mesh, vertexIds);
    return { vertexIds: [], edgeIds, faceIds: [] };
  }
  return { vertexIds: [], edgeIds: [], faceIds: facesFullyInVertices(mesh, vertexIds) };
}

// ————————————————————————————————————————————————————————————
// Set operations
// ————————————————————————————————————————————————————————————

function allIdsFor(mesh: CADMesh, mode: ComponentMode): string[] {
  if (mode === 'vertex') return mesh.vertices.map((v) => v.id);
  if (mode === 'edge') return mesh.edges.map((e) => e.id);
  return mesh.faces.map((f) => f.id);
}

export function selectedIdsFor(selection: ComponentSelection, mode: ComponentMode): string[] {
  if (mode === 'vertex') return selection.vertexIds;
  if (mode === 'edge') return selection.edgeIds;
  return selection.faceIds;
}

export function withSelectedIds(mode: ComponentMode, ids: string[]): ComponentSelection {
  return {
    vertexIds: mode === 'vertex' ? ids : [],
    edgeIds: mode === 'edge' ? ids : [],
    faceIds: mode === 'face' ? ids : [],
  };
}

/** Everything not currently selected, in mesh order. */
export function invertSelection(mesh: CADMesh, mode: ComponentMode, ids: string[]): string[] {
  const current = new Set(ids);
  return allIdsFor(mesh, mode).filter((id) => !current.has(id));
}

/** How the user's modifier keys combine a new hit with the existing selection. */
export type SelectionIntent = 'replace' | 'add' | 'remove' | 'toggle';

/**
 * Single place that decides what a click means, so every mode behaves identically:
 * plain click replaces, Shift adds, Ctrl/Alt removes.
 */
export function intentFromModifiers(mods: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): SelectionIntent {
  if (mods.ctrlKey || mods.metaKey || mods.altKey) return 'remove';
  if (mods.shiftKey) return 'add';
  return 'replace';
}

/** Apply an intent to the current selection. Order follows `all` when provided. */
export function applySelectionIntent(
  current: string[],
  incoming: string[],
  intent: SelectionIntent,
  order?: string[],
): string[] {
  if (intent === 'replace') return [...new Set(incoming)];

  const next = new Set(current);
  if (intent === 'add') {
    incoming.forEach((id) => next.add(id));
  } else if (intent === 'remove') {
    incoming.forEach((id) => next.delete(id));
  } else {
    incoming.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
  }

  if (!order) return [...next];
  return order.filter((id) => next.has(id));
}

// ————————————————————————————————————————————————————————————
// Grow / shrink
// ————————————————————————————————————————————————————————————

/** Vertices sharing an edge with `vertexIds`. */
function neighbourVertices(index: MeshTopologyIndex, vertexIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const vId of vertexIds) {
    (index.edgesByVertex.get(vId) || []).forEach((edge) => {
      out.add(edge.v1Id === vId ? edge.v2Id : edge.v1Id);
    });
  }
  return out;
}

/** Expand the selection by one topological ring (Blender Ctrl+NumPad+). */
export function growSelection(mesh: CADMesh, mode: ComponentMode, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const index = buildTopologyIndex(mesh);

  if (mode === 'vertex') {
    const grown = new Set(ids);
    neighbourVertices(index, ids).forEach((v) => grown.add(v));
    return orderedBy(mesh.vertices, grown);
  }

  if (mode === 'edge') {
    const verts = new Set(verticesOfEdges(mesh, ids));
    const grown = new Set(ids);
    verts.forEach((vId) => (index.edgesByVertex.get(vId) || []).forEach((e) => grown.add(e.id)));
    return orderedBy(mesh.edges, grown);
  }

  const verts = new Set(verticesOfFaces(mesh, ids));
  const grown = new Set(ids);
  verts.forEach((vId) => (index.facesByVertex.get(vId) || []).forEach((f) => grown.add(f.id)));
  return orderedBy(mesh.faces, grown);
}

/**
 * Contract the selection by one ring: drop components that touch the unselected
 * region, which is the inverse of `growSelection` (Blender Ctrl+NumPad-).
 */
export function shrinkSelection(mesh: CADMesh, mode: ComponentMode, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const index = buildTopologyIndex(mesh);
  const selected = new Set(ids);

  if (mode === 'vertex') {
    const kept = ids.filter((vId) =>
      (index.edgesByVertex.get(vId) || []).every((edge) =>
        selected.has(edge.v1Id === vId ? edge.v2Id : edge.v1Id),
      ),
    );
    return orderedBy(mesh.vertices, kept);
  }

  if (mode === 'edge') {
    // An edge survives if every edge sharing either endpoint is also selected.
    const kept = ids.filter((id) => {
      const edge = index.edgeById.get(id);
      if (!edge) return false;
      return [edge.v1Id, edge.v2Id].every((vId) =>
        (index.edgesByVertex.get(vId) || []).every((e) => selected.has(e.id)),
      );
    });
    return orderedBy(mesh.edges, kept);
  }

  const kept = ids.filter((id) => {
    const face = index.faceById.get(id);
    if (!face) return false;
    return face.vertexIds.every((vId) =>
      (index.facesByVertex.get(vId) || []).every((f) => selected.has(f.id)),
    );
  });
  return orderedBy(mesh.faces, kept);
}

// ————————————————————————————————————————————————————————————
// Linked / connected
// ————————————————————————————————————————————————————————————

/**
 * Flood-fill the connected component(s) containing the seed selection
 * (Blender's Select Linked, `L` / Ctrl+L).
 */
export function selectLinked(mesh: CADMesh, mode: ComponentMode, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const index = buildTopologyIndex(mesh);

  const seedVerts =
    mode === 'vertex' ? ids : mode === 'edge' ? verticesOfEdges(mesh, ids) : verticesOfFaces(mesh, ids);

  // Breadth-first over edge connectivity to collect the whole island.
  const island = new Set<string>(seedVerts);
  const queue = [...seedVerts];
  while (queue.length) {
    const vId = queue.pop()!;
    (index.edgesByVertex.get(vId) || []).forEach((edge) => {
      const other = edge.v1Id === vId ? edge.v2Id : edge.v1Id;
      if (!island.has(other)) {
        island.add(other);
        queue.push(other);
      }
    });
  }

  if (mode === 'vertex') return orderedBy(mesh.vertices, island);
  if (mode === 'edge') return edgesFullyInVertices(mesh, [...island]);
  return facesFullyInVertices(mesh, [...island]);
}

// ————————————————————————————————————————————————————————————
// Edge loop / ring
// ————————————————————————————————————————————————————————————

/** Edges of a face that are opposite `edge`, valid only for quads. */
function oppositeEdgeInQuad(
  index: MeshTopologyIndex,
  face: Face,
  edge: Edge,
): Edge | null {
  if (face.vertexIds.length !== 4) return null;
  const ids = face.vertexIds;
  const target = edgeKey(edge.v1Id, edge.v2Id);
  for (let i = 0; i < 4; i++) {
    const key = edgeKey(ids[i], ids[(i + 1) % 4]);
    if (key !== target) continue;
    // The opposite boundary of a quad is two steps around.
    const oppKey = edgeKey(ids[(i + 2) % 4], ids[(i + 3) % 4]);
    return index.edgeByKey.get(oppKey) || null;
  }
  return null;
}

/**
 * Edge ring: walk across quads through opposite edges (Blender Ctrl+Alt+click).
 * Stops at triangles, n-gons and open boundaries.
 */
export function selectEdgeRing(mesh: CADMesh, startEdgeId: string): string[] {
  const index = buildTopologyIndex(mesh);
  const start = index.edgeById.get(startEdgeId);
  if (!start) return [];

  const ring = new Set<string>([start.id]);

  // Walk both ways: each step crosses one quad to its opposite edge.
  const walk = (fromEdge: Edge, throughFace: Face | undefined) => {
    let edge: Edge | null = fromEdge;
    let face = throughFace;
    while (edge && face) {
      const next: Edge | null = oppositeEdgeInQuad(index, face, edge);
      if (!next || ring.has(next.id)) return;
      ring.add(next.id);
      const faces = index.facesByEdgeKey.get(edgeKey(next.v1Id, next.v2Id)) || [];
      const onward = faces.find((f) => f.id !== face!.id);
      edge = next;
      face = onward;
    }
  };

  const startFaces = index.facesByEdgeKey.get(edgeKey(start.v1Id, start.v2Id)) || [];
  startFaces.forEach((face) => walk(start, face));

  return orderedBy(mesh.edges, ring);
}

/**
 * Edge loop: follow the chain of edges through 4-valence vertices
 * (Blender Alt+click). Falls back to the single edge on irregular topology.
 */
export function selectEdgeLoop(mesh: CADMesh, startEdgeId: string): string[] {
  const index = buildTopologyIndex(mesh);
  const start = index.edgeById.get(startEdgeId);
  if (!start) return [];

  const loop = new Set<string>([start.id]);

  /**
   * At a 4-valence vertex the loop continues along the one edge that shares no
   * face with the incoming edge — i.e. it goes "straight on" rather than turning.
   */
  const continueThrough = (edge: Edge, vertexId: string): Edge | null => {
    const spokes = index.edgesByVertex.get(vertexId) || [];
    if (spokes.length !== 4) return null;
    const incomingFaces = new Set(
      (index.facesByEdgeKey.get(edgeKey(edge.v1Id, edge.v2Id)) || []).map((f) => f.id),
    );
    const candidates = spokes.filter((candidate) => {
      if (candidate.id === edge.id) return false;
      const faces = index.facesByEdgeKey.get(edgeKey(candidate.v1Id, candidate.v2Id)) || [];
      return faces.every((f) => !incomingFaces.has(f.id));
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  const walk = (startVertexId: string) => {
    let edge = start;
    let vertexId = startVertexId;
    for (let guard = 0; guard < mesh.edges.length + 1; guard++) {
      const next = continueThrough(edge, vertexId);
      if (!next || loop.has(next.id)) return;
      loop.add(next.id);
      vertexId = next.v1Id === vertexId ? next.v2Id : next.v1Id;
      edge = next;
    }
  };

  walk(start.v1Id);
  walk(start.v2Id);

  return orderedBy(mesh.edges, loop);
}

// ————————————————————————————————————————————————————————————
// Readout
// ————————————————————————————————————————————————————————————

export interface SelectionCounts {
  selected: number;
  total: number;
}

/** Counts for the status readout, so the user can always see what is selected. */
export function selectionCounts(
  mesh: CADMesh | undefined,
  mode: ComponentMode,
  ids: string[],
): SelectionCounts {
  if (!mesh) return { selected: 0, total: 0 };
  const total =
    mode === 'vertex' ? mesh.vertices.length : mode === 'edge' ? mesh.edges.length : mesh.faces.length;
  // Guard against stale IDs left over from a topology edit.
  const valid = new Set(allIdsFor(mesh, mode));
  return { selected: ids.filter((id) => valid.has(id)).length, total };
}

/** Drop IDs that no longer exist, e.g. after an extrude rebuilt the topology. */
export function pruneSelection(mesh: CADMesh | undefined, selection: ComponentSelection): ComponentSelection {
  if (!mesh) return { vertexIds: [], edgeIds: [], faceIds: [] };
  const verts = new Set(mesh.vertices.map((v) => v.id));
  const edges = new Set(mesh.edges.map((e) => e.id));
  const faces = new Set(mesh.faces.map((f) => f.id));
  return {
    vertexIds: selection.vertexIds.filter((id) => verts.has(id)),
    edgeIds: selection.edgeIds.filter((id) => edges.has(id)),
    faceIds: selection.faceIds.filter((id) => faces.has(id)),
  };
}

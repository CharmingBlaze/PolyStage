import type { CADMesh, Edge, Face, Vertex } from '../../types/cad';
import { createEdgesFromFaces } from './edges';
import { makeEdgeId } from './ids';

export interface TopologyValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  faceId?: string;
  edgeId?: string;
  vertexId?: string;
}

export function validateEditableTopology(mesh: CADMesh): TopologyValidationIssue[] {
  const issues: TopologyValidationIssue[] = [];
  const vertIds = new Set(mesh.vertices.map((v) => v.id));

  mesh.faces.forEach((face) => {
    if (face.vertexIds.length < 3) {
      issues.push({
        severity: 'error',
        code: 'face_too_few_corners',
        message: `Face ${face.id} has fewer than 3 corners`,
        faceId: face.id,
      });
    }
    const seen = new Set<string>();
    face.vertexIds.forEach((id) => {
      if (!vertIds.has(id)) {
        issues.push({
          severity: 'error',
          code: 'face_bad_vertex',
          message: `Face ${face.id} references missing vertex ${id}`,
          faceId: face.id,
          vertexId: id,
        });
      }
      if (seen.has(id)) {
        issues.push({
          severity: 'error',
          code: 'face_duplicate_corner',
          message: `Face ${face.id} has duplicate corner ${id}`,
          faceId: face.id,
          vertexId: id,
        });
      }
      seen.add(id);
    });
    if (face.uvs.length !== face.vertexIds.length) {
      issues.push({
        severity: 'warning',
        code: 'uv_corner_mismatch',
        message: `Face ${face.id} UV count (${face.uvs.length}) != corner count (${face.vertexIds.length})`,
        faceId: face.id,
      });
    }
  });

  const expected = createEdgesFromFaces(mesh.faces);
  const expectedIds = new Set(expected.map((e) => e.id));
  mesh.edges.forEach((e) => {
    if (!vertIds.has(e.v1Id) || !vertIds.has(e.v2Id)) {
      issues.push({
        severity: 'error',
        code: 'edge_bad_vertex',
        message: `Edge ${e.id} references missing vertices`,
        edgeId: e.id,
      });
    }
  });

  // Zero-length edges
  const vMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  mesh.edges.forEach((e) => {
    const a = vMap.get(e.v1Id);
    const b = vMap.get(e.v2Id);
    if (!a || !b) return;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-8) {
      issues.push({
        severity: 'error',
        code: 'zero_length_edge',
        message: `Edge ${e.id} has zero length`,
        edgeId: e.id,
      });
    }
  });

  // Missing boundary edges from faces
  expected.forEach((e) => {
    if (!mesh.edges.some((me) => me.id === e.id || makeEdgeId(me.v1Id, me.v2Id) === e.id)) {
      if (!expectedIds.has(e.id)) return;
      const has = mesh.edges.some((me) => makeEdgeId(me.v1Id, me.v2Id) === e.id);
      if (!has) {
        issues.push({
          severity: 'warning',
          code: 'missing_edge',
          message: `Expected boundary edge ${e.id} missing from mesh.edges`,
          edgeId: e.id,
        });
      }
    }
  });

  return issues;
}

/** Ensure edges match face boundaries and bump revision. */
export function finalizeEditableMesh(
  mesh: Omit<CADMesh, 'edges'> & { edges?: Edge[] },
  options?: { validate?: boolean }
): CADMesh {
  const faces = mesh.faces;
  const edges = createEdgesFromFaces(faces);
  const next: CADMesh = {
    ...mesh,
    edges,
    revision: (mesh.revision ?? 0) + 1,
  };

  if (options?.validate !== false) {
    try {
      const isDev = typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
      if (isDev) {
        const issues = validateEditableTopology(next).filter((i) => i.severity === 'error');
        if (issues.length > 0) {
          console.warn('[topology]', mesh.name || mesh.id, issues);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return next;
}

export function ensureFaceUVs(face: Face): Face {
  if (face.uvs.length === face.vertexIds.length) return face;
  const uvs = face.vertexIds.map((_, i) => face.uvs[i] || { u: 0, v: 0 });
  return { ...face, uvs };
}

export function assertFiniteVertices(vertices: Vertex[]): void {
  for (const v of vertices) {
    if (![v.x, v.y, v.z].every(Number.isFinite)) {
      throw new Error(`Non-finite vertex ${v.id}`);
    }
  }
}

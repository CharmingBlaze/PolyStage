import type { CADMesh } from '../types/cad';
import { createEdgesFromFaces } from './meshUtils';

export interface ValidationIssue {
  id: string;
  type: 'error' | 'warning';
  title: string;
  description: string;
  fixable: boolean;
}

export function validateMeshIntegrity(mesh: CADMesh): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const invalidFaces = mesh.faces.filter((f) => f.vertexIds.length < 3);
  if (invalidFaces.length > 0) {
    issues.push({
      id: 'issue_degenerate_faces',
      type: 'error',
      title: `${invalidFaces.length} Degenerate Face(s)`,
      description: 'Found faces with fewer than 3 valid vertices.',
      fixable: true,
    });
  }

  const referencedVertIds = new Set<string>();
  mesh.faces.forEach((f) => f.vertexIds.forEach((id) => referencedVertIds.add(id)));
  const orphanVerts = mesh.vertices.filter((v) => !referencedVertIds.has(v.id));

  if (orphanVerts.length > 0) {
    issues.push({
      id: 'issue_orphan_vertices',
      type: 'warning',
      title: `${orphanVerts.length} Unused Floating Vertices`,
      description: 'Found floating vertices not connected to any face polygon.',
      fixable: true,
    });
  }

  let duplicateCount = 0;
  for (let i = 0; i < mesh.vertices.length; i++) {
    for (let j = i + 1; j < mesh.vertices.length; j++) {
      const v1 = mesh.vertices[i];
      const v2 = mesh.vertices[j];
      const dist = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
      if (dist < 0.001) duplicateCount++;
    }
  }

  if (duplicateCount > 0) {
    issues.push({
      id: 'issue_duplicate_vertices',
      type: 'warning',
      title: `${duplicateCount} Overlapping Duplicate Vertices`,
      description: 'Found vertices occupying identical space.',
      fixable: true,
    });
  }

  return issues;
}

export function autoFixMeshIntegrity(mesh: CADMesh): CADMesh {
  const referencedVertIds = new Set<string>();
  mesh.faces.forEach((f) => f.vertexIds.forEach((id) => referencedVertIds.add(id)));
  const cleanedVerts = mesh.vertices.filter((v) => referencedVertIds.has(v.id));

  const cleanedFaces = mesh.faces.filter((f) => f.vertexIds.length >= 3);

  return {
    ...mesh,
    vertices: cleanedVerts.length > 0 ? cleanedVerts : mesh.vertices,
    faces: cleanedFaces.length > 0 ? cleanedFaces : mesh.faces,
    edges: createEdgesFromFaces(cleanedFaces),
  };
}

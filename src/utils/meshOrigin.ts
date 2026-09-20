/**
 * Blockbench-style origin (pivot) workflow.
 *
 * `mesh.position` is the rotation/scale origin. Moving origin offsets local
 * verts so the mesh stays put in world space.
 */
import * as THREE from 'three';
import type { CADMesh, Vector3D, Vertex } from '../types/cad';
import { finalizeEditableMesh } from './topology/validate';

export function meshWorldMatrix(mesh: Pick<CADMesh, 'position' | 'rotation' | 'scale'>): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, 'XYZ'),
    ),
    new THREE.Vector3(mesh.scale.x, mesh.scale.y, mesh.scale.z),
  );
}

export function localPointToWorld(
  mesh: Pick<CADMesh, 'position' | 'rotation' | 'scale'>,
  local: Vector3D,
): Vector3D {
  const w = new THREE.Vector3(local.x, local.y, local.z).applyMatrix4(meshWorldMatrix(mesh));
  return { x: w.x, y: w.y, z: w.z };
}

export function worldPointToLocal(
  mesh: Pick<CADMesh, 'position' | 'rotation' | 'scale'>,
  world: Vector3D,
): Vector3D {
  const l = new THREE.Vector3(world.x, world.y, world.z).applyMatrix4(meshWorldMatrix(mesh).invert());
  return { x: l.x, y: l.y, z: l.z };
}

function localBBox(verts: Vertex[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Move origin to a local-space point. World geometry does not move. */
export function setMeshOriginLocal(mesh: CADMesh, local: Vector3D): CADMesh {
  if (!mesh.vertices.length) return mesh;
  const dx = local.x;
  const dy = local.y;
  const dz = local.z;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12 && Math.abs(dz) < 1e-12) return mesh;
  const world = localPointToWorld(mesh, local);
  const vertices = mesh.vertices.map((v) => ({
    ...v,
    x: v.x - dx,
    y: v.y - dy,
    z: v.z - dz,
  }));
  return finalizeEditableMesh({
    ...mesh,
    vertices,
    position: world,
    revision: (mesh.revision || 0) + 1,
  });
}

/** Move origin to a world-space point. World geometry does not move. */
export function setMeshOriginWorld(mesh: CADMesh, world: Vector3D): CADMesh {
  return setMeshOriginLocal(mesh, worldPointToLocal(mesh, world));
}

/** Origin at the local bounding-box center (Blockbench Center Pivot). */
export function originToGeometry(mesh: CADMesh): CADMesh {
  if (!mesh.vertices.length) return mesh;
  const b = localBBox(mesh.vertices);
  return setMeshOriginLocal(mesh, {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    z: (b.minZ + b.maxZ) / 2,
  });
}

/** Origin at the centroid of selected verts (or whole mesh if empty). */
export function originToSelection(mesh: CADMesh, vertexIds?: string[] | null): CADMesh {
  const ids = vertexIds && vertexIds.length ? new Set(vertexIds) : null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const v of mesh.vertices) {
    if (ids && !ids.has(v.id)) continue;
    sx += v.x;
    sy += v.y;
    sz += v.z;
    n++;
  }
  if (!n) return mesh;
  return setMeshOriginLocal(mesh, { x: sx / n, y: sy / n, z: sz / n });
}

/** Origin at world (0, 0, 0). */
export function originToWorldZero(mesh: CADMesh): CADMesh {
  return setMeshOriginWorld(mesh, { x: 0, y: 0, z: 0 });
}

/** Origin at the bottom-center of the local bbox (Blockbench entity pivot). */
export function originToBottom(mesh: CADMesh): CADMesh {
  if (!mesh.vertices.length) return mesh;
  const b = localBBox(mesh.vertices);
  return setMeshOriginLocal(mesh, {
    x: (b.minX + b.maxX) / 2,
    y: b.minY,
    z: (b.minZ + b.maxZ) / 2,
  });
}

/** RGB cross + gold cube at the mesh origin, always on top of geometry. */
export function createOriginMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'originMarker';
  const axis = (to: [number, number, number], color: number) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(...to),
    ]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    line.renderOrder = 42;
    group.add(line);
  };
  axis([0.32, 0, 0], 0xe0556a);
  axis([0, 0.32, 0], 0x34a87a);
  axis([0, 0, 0.32], 0x4a90d9);
  const hub = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xe6b422, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  hub.renderOrder = 43;
  group.add(hub);
  return group;
}

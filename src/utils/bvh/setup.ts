import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

let patched = false;

/** Patch Three.js prototypes once for accelerated mesh raycasts. */
export function ensureBvhPatched(): void {
  if (patched) return;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  patched = true;
}

/**
 * Build or rebuild a MeshBVH on render geometry.
 * Uses indirect mode so triangle indices stay stable for triangleToFaceId mapping.
 */
export function attachMeshBvh(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureBvhPatched();
  if (geometry.boundsTree) {
    geometry.disposeBoundsTree();
  }
  // indirect: true keeps original triangle order → face picking / UV maps stay valid
  geometry.computeBoundsTree({ indirect: true });
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry;
}

/** Dispose BVH + geometry attributes safely. */
export function disposeMeshGeometry(geometry: THREE.BufferGeometry | null | undefined): void {
  if (!geometry) return;
  if (geometry.boundsTree) {
    geometry.disposeBoundsTree();
  }
  geometry.dispose();
}

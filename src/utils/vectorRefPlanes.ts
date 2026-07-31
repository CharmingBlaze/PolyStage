import * as THREE from 'three';
import type { VectorRefImage } from '../store/useVectorStore';

export type VectorRefPlaneId = 'front' | 'side';

const REF_DEPTH = 0.02;

/** World size of the longer edge of a reference plane. */
export function refPlaneSize(ref: VectorRefImage): { width: number; height: number } {
  const long = Math.max(0.25, ref.scale);
  const aspect = Math.max(0.05, ref.aspect || 1);
  return aspect >= 1
    ? { width: long, height: long / aspect }
    : { width: long * aspect, height: long };
}

/**
 * Places a Front (Z≈0) or Side (X≈0) reference sheet in world space.
 * PlaneGeometry UVs are identical on both faces via DoubleSide materials.
 */
export function applyVectorRefTransform(
  mesh: THREE.Mesh,
  plane: VectorRefPlaneId,
  ref: VectorRefImage
) {
  const { width, height } = refPlaneSize(ref);
  mesh.scale.set(width, height, 1);
  mesh.rotation.set(0, 0, 0);
  if (plane === 'front') {
    // Facing ±Z — same texture/UVs on both sides.
    mesh.position.set(ref.offsetU, ref.offsetV, -REF_DEPTH);
  } else {
    // Facing ±X; offsetU slides along world Z (side-ortho horizontal).
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(-REF_DEPTH, ref.offsetV, ref.offsetU);
  }
  mesh.visible = true;
  mesh.renderOrder = -2;

  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = ref.opacity;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
}

export function createVectorRefMesh(plane: VectorRefPlaneId): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  mesh.name = `vectorRef-${plane}`;
  mesh.userData.vectorRefPlane = plane;
  mesh.visible = false;
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;
  return mesh;
}

/** Highlight rim when the plane is being moved/scaled. */
export function setVectorRefActive(mesh: THREE.Mesh, active: boolean) {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.color.set(active ? 0xffb366 : 0xffffff);
}

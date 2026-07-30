import * as THREE from 'three';
import { ensureBvhPatched } from './setup';

export type BvhPaintHit = {
  meshId: string;
  faceId: string | null;
  triangleIndex: number | null;
  uv: THREE.Vector2;
  point: THREE.Vector3;
  distance: number;
};

export type BvhFaceHit = {
  meshId: string;
  faceId: string;
  triangleIndex: number;
  point: THREE.Vector3;
  distance: number;
  uv?: THREE.Vector2;
};

export type BvhMeshHit = {
  meshId: string;
  mesh: THREE.Mesh;
  point: THREE.Vector3;
  distance: number;
  faceId: string | null;
  triangleIndex: number | null;
};

function ndcFromEvent(
  clientX: number,
  clientY: number,
  rect: DOMRect
): THREE.Vector2 {
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
}

/** Shared raycaster configured for BVH first-hit picking / painting. */
export function createBvhRaycaster(firstHitOnly = true): THREE.Raycaster {
  ensureBvhPatched();
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = firstHitOnly;
  return raycaster;
}

export function setRayFromPointer(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  rect: DOMRect
): void {
  raycaster.setFromCamera(ndcFromEvent(clientX, clientY, rect), camera);
}

function isPickableMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true && !!obj.userData?.meshId;
}

function collectSceneMeshes(root: THREE.Object3D | null | undefined): THREE.Mesh[] {
  if (!root) return [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (isPickableMesh(obj)) meshes.push(obj);
  });
  return meshes;
}

function resolveFaceId(mesh: THREE.Mesh, triangleIndex: number | null | undefined): string | null {
  if (triangleIndex == null) return null;
  const map = mesh.geometry.userData.triangleToFaceId as string[] | undefined;
  return map?.[triangleIndex] ?? null;
}

/**
 * Broad-phase: skip meshes whose world AABB misses the ray (cheap before BVH).
 */
export function broadphaseMeshes(
  raycaster: THREE.Raycaster,
  meshes: THREE.Mesh[]
): THREE.Mesh[] {
  const ray = raycaster.ray;
  const hitPoint = new THREE.Vector3();
  return meshes.filter((mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return true;
    const worldBox = box.clone().applyMatrix4(mesh.matrixWorld);
    return ray.intersectBox(worldBox, hitPoint) !== null;
  });
}

export function pickMeshes(
  raycaster: THREE.Raycaster,
  rootOrMeshes: THREE.Object3D | THREE.Mesh[],
  options?: { firstHitOnly?: boolean; filterMeshIds?: Set<string> }
): THREE.Intersection[] {
  ensureBvhPatched();
  const prev = raycaster.firstHitOnly;
  if (options?.firstHitOnly != null) raycaster.firstHitOnly = options.firstHitOnly;

  const meshes = Array.isArray(rootOrMeshes)
    ? rootOrMeshes
    : collectSceneMeshes(rootOrMeshes);

  const filtered = options?.filterMeshIds
    ? meshes.filter((m) => options.filterMeshIds!.has(m.userData.meshId))
    : meshes;

  const candidates = broadphaseMeshes(raycaster, filtered);
  const hits = raycaster.intersectObjects(candidates, false);

  raycaster.firstHitOnly = prev;
  return hits;
}

export function pickClosestMesh(
  raycaster: THREE.Raycaster,
  rootOrMeshes: THREE.Object3D | THREE.Mesh[]
): BvhMeshHit | null {
  const hits = pickMeshes(raycaster, rootOrMeshes, { firstHitOnly: true });
  const hit = hits[0];
  if (!hit || !(hit.object as THREE.Mesh).isMesh) return null;
  const mesh = hit.object as THREE.Mesh;
  const meshId = mesh.userData.meshId as string | undefined;
  if (!meshId) return null;
  return {
    meshId,
    mesh,
    point: hit.point.clone(),
    distance: hit.distance,
    faceId: resolveFaceId(mesh, hit.faceIndex),
    triangleIndex: hit.faceIndex ?? null,
  };
}

export function pickLogicalFace(
  raycaster: THREE.Raycaster,
  mesh: THREE.Mesh
): BvhFaceHit | null {
  ensureBvhPatched();
  const prev = raycaster.firstHitOnly;
  raycaster.firstHitOnly = true;
  const hits = raycaster.intersectObject(mesh, false);
  raycaster.firstHitOnly = prev;

  const hit = hits[0];
  if (!hit || hit.faceIndex == null) return null;
  const faceId = resolveFaceId(mesh, hit.faceIndex);
  if (!faceId) return null;

  return {
    meshId: mesh.userData.meshId as string,
    faceId,
    triangleIndex: hit.faceIndex,
    point: hit.point.clone(),
    distance: hit.distance,
    uv: hit.uv?.clone(),
  };
}

/** Fast UV paint sample for 3D texture painting (first hit only). */
export function pickPaintUv(
  raycaster: THREE.Raycaster,
  mesh: THREE.Mesh
): BvhPaintHit | null {
  ensureBvhPatched();
  const prev = raycaster.firstHitOnly;
  raycaster.firstHitOnly = true;
  const hits = raycaster.intersectObject(mesh, false);
  raycaster.firstHitOnly = prev;

  const hit = hits[0];
  if (!hit?.uv) return null;

  return {
    meshId: mesh.userData.meshId as string,
    faceId: resolveFaceId(mesh, hit.faceIndex),
    triangleIndex: hit.faceIndex ?? null,
    uv: hit.uv.clone(),
    point: hit.point.clone(),
    distance: hit.distance,
  };
}

/**
 * Stroke painting helper: sample UV along a screen-space drag and fill gaps
 * so sparse pointer events still cover the brush path.
 */
export function samplePaintStrokeUvs(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  mesh: THREE.Mesh,
  rect: DOMRect,
  fromClient: { x: number; y: number },
  toClient: { x: number; y: number },
  maxSteps = 32
): BvhPaintHit[] {
  const dx = toClient.x - fromClient.x;
  const dy = toClient.y - fromClient.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.min(maxSteps, Math.ceil(dist / 3)));
  const hits: BvhPaintHit[] = [];
  const seen = new Set<string>();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = fromClient.x + dx * t;
    const y = fromClient.y + dy * t;
    setRayFromPointer(raycaster, camera, x, y, rect);
    const hit = pickPaintUv(raycaster, mesh);
    if (!hit) continue;
    const key = `${hit.uv.x.toFixed(4)}:${hit.uv.y.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }

  return hits;
}

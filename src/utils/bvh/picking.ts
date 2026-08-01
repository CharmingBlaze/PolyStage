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
  mesh: THREE.Mesh,
  options?: { minFacing?: number }
): BvhPaintHit | null {
  ensureBvhPatched();
  const prev = raycaster.firstHitOnly;
  raycaster.firstHitOnly = true;
  const hits = raycaster.intersectObject(mesh, false);
  raycaster.firstHitOnly = prev;

  const hit = hits[0];
  if (!hit?.uv) return null;

  // Reject grazing / silhouette scrapes — they produce unstable UVs and stray edge dots.
  const minFacing = options?.minFacing;
  if (minFacing != null && minFacing > 0 && hit.face) {
    const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
    const facing = -raycaster.ray.direction.dot(normal);
    if (facing < minFacing) return null;
  }

  return {
    meshId: mesh.userData.meshId as string,
    faceId: resolveFaceId(mesh, hit.faceIndex),
    triangleIndex: hit.faceIndex ?? null,
    uv: hit.uv.clone(),
    point: hit.point.clone(),
    distance: hit.distance,
  };
}

export type SamplePaintStrokeOptions = {
  maxSteps?: number;
  /** Texture resolution — dedupes to true texels when known. */
  textureSize?: number;
  /** Skip segment start (already stamped by the previous sample). */
  skipStart?: boolean;
  /**
   * Keep the stroke on one logical face. Hits on other faces are ignored so
   * silhouette / edge grazing cannot paint a second parallel stroke.
   */
  lockFaceId?: string | null;
  /**
   * Reject samples that jump too far in UV from the previous accepted hit
   * (guards island seams within a face lock miss).
   */
  maxUvJump?: number;
  /** UV of the last stamped sample — seeds the jump guard across pointer events. */
  seedUv?: { u: number; v: number } | null;
  /**
   * Minimum −dot(ray, normal). Grazing silhouette hits below this are dropped
   * (stops random dots along the top/side edges of a face).
   */
  minFacing?: number;
};

/**
 * Stroke painting helper: sample UV along a screen-space drag.
 * Callers should stamp only these hits (no UV-space Bresenham) for pixel-accurate 3D paint.
 */
export function samplePaintStrokeUvs(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  mesh: THREE.Mesh,
  rect: DOMRect,
  fromClient: { x: number; y: number },
  toClient: { x: number; y: number },
  options: SamplePaintStrokeOptions = {},
): BvhPaintHit[] {
  const {
    maxSteps = 64,
    textureSize,
    skipStart = false,
    lockFaceId = undefined,
    seedUv = null,
    // Mild grazing reject — high values break continuous paint on angled faces.
    minFacing = 0.08,
  } = options;

  const tex = textureSize && textureSize > 0 ? textureSize : 0;
  // Reject seam teleports, but stay loose enough for fast hold-to-drag strokes
  // (sparse pointer events can move tens of texels between samples).
  const maxUvJump =
    options.maxUvJump ??
    (tex > 0 ? Math.max(0.22, 48 / tex) : 0.28);

  const dx = toClient.x - fromClient.x;
  const dy = toClient.y - fromClient.y;
  const dist = Math.hypot(dx, dy);
  // ~1px screen steps; a still click is a single sample at `to`.
  const steps = dist < 0.5 ? 0 : Math.max(1, Math.min(maxSteps, Math.ceil(dist)));
  const hits: BvhPaintHit[] = [];
  const seen = new Set<string>();
  const startI = skipStart && steps > 0 ? 1 : 0;
  let lastUv: THREE.Vector2 | null = seedUv
    ? new THREE.Vector2(seedUv.u, seedUv.v)
    : null;

  for (let i = startI; i <= steps; i++) {
    const t = steps === 0 ? 1 : i / steps;
    const x = fromClient.x + dx * t;
    const y = fromClient.y + dy * t;
    setRayFromPointer(raycaster, camera, x, y, rect);
    const hit = pickPaintUv(raycaster, mesh, { minFacing });
    if (!hit) continue;

    if (lockFaceId != null && hit.faceId !== lockFaceId) continue;

    if (lastUv && maxUvJump > 0) {
      const jump = Math.hypot(hit.uv.x - lastUv.x, hit.uv.y - lastUv.y);
      if (jump > maxUvJump) continue;
    }

    const key = tex
      ? `${Math.floor(hit.uv.x * tex)}:${Math.floor(hit.uv.y * tex)}`
      : `${hit.uv.x.toFixed(4)}:${hit.uv.y.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lastUv = hit.uv;
    hits.push(hit);
  }

  return hits;
}

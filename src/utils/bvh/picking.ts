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

/**
 * Fast UV paint sample for 3D texture painting.
 *
 * When `minFacing` is set we must inspect more than the BVH first hit:
 * DoubleSide meshes often return a back-face as hits[0] (facing < 0) while a
 * valid front face is hits[1]. The old firstHitOnly + facing reject path
 * dropped every move sample after begin — hold-drag collapsed to one stamp.
 */
export function pickPaintUv(
  raycaster: THREE.Raycaster,
  mesh: THREE.Mesh,
  options?: { minFacing?: number }
): BvhPaintHit | null {
  ensureBvhPatched();
  const minFacing = options?.minFacing;
  const prev = raycaster.firstHitOnly;
  const filterFacing = minFacing != null && minFacing > 0;
  // Collect enough hits to find a front-facing UV when filtering.
  raycaster.firstHitOnly = !filterFacing;
  const hits = raycaster.intersectObject(mesh, false);
  raycaster.firstHitOnly = prev;

  for (const hit of hits) {
    if (!hit?.uv) continue;
    if (filterFacing && hit.face) {
      const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      const facing = -raycaster.ray.direction.dot(normal);
      if (facing < minFacing!) continue;
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

  return null;
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
  /**
   * Minimum texel distance between accepted samples (brush spacing).
   * 0 = stamp every distinct texel hit.
   */
  minTexelSpacing?: number;
};

/**
 * Stroke painting helper: sample UV along a screen-space drag, then densify in UV
 * between consecutive hits on the same island. Large UV jumps are treated as seams —
 * the gap is not filled, and painting continues as a new segment on the far side.
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
    maxSteps = 128,
    textureSize,
    skipStart = false,
    lockFaceId = undefined,
    seedUv = null,
    // Mild grazing reject — high values break continuous paint on angled faces.
    minFacing = 0.06,
    minTexelSpacing = 0,
  } = options;

  const tex = textureSize && textureSize > 0 ? textureSize : 0;
  // Seam teleport threshold in UV units. Keep room for fast pointer gaps (~32–48px).
  const maxUvJump =
    options.maxUvJump === 0
      ? 0
      : (options.maxUvJump ?? (tex > 0 ? Math.max(0.18, 32 / tex) : 0.25));

  const dx = toClient.x - fromClient.x;
  const dy = toClient.y - fromClient.y;
  const dist = Math.hypot(dx, dy);
  // Half-pixel screen steps keep UV coverage dense on slow and fast drags.
  const steps =
    dist < 0.25 ? 0 : Math.max(1, Math.min(maxSteps, Math.ceil(dist * 2)));
  const hits: BvhPaintHit[] = [];
  const seen = new Set<string>();
  const startI = skipStart && steps > 0 ? 1 : 0;
  let lastUv: THREE.Vector2 | null = seedUv
    ? new THREE.Vector2(seedUv.u, seedUv.v)
    : null;
  let lastStampUv: THREE.Vector2 | null = lastUv;
  let lastFaceId: string | null = null;

  const pushHit = (hit: BvhPaintHit, markStamp: boolean) => {
    const key = tex
      ? `${Math.floor(hit.uv.x * tex)}:${Math.floor(hit.uv.y * tex)}`
      : `${hit.uv.x.toFixed(4)}:${hit.uv.y.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    hits.push(hit);
    lastUv = hit.uv;
    lastFaceId = hit.faceId;
    if (markStamp) lastStampUv = hit.uv;
    return true;
  };

  for (let i = startI; i <= steps; i++) {
    const t = steps === 0 ? 1 : i / steps;
    const x = fromClient.x + dx * t;
    const y = fromClient.y + dy * t;
    setRayFromPointer(raycaster, camera, x, y, rect);
    const hit = pickPaintUv(raycaster, mesh, { minFacing });
    if (!hit) continue;

    if (lockFaceId != null && hit.faceId !== lockFaceId) continue;

    let seamBreak = false;
    if (lastUv && maxUvJump > 0) {
      const jump = Math.hypot(hit.uv.x - lastUv.x, hit.uv.y - lastUv.y);
      if (jump > maxUvJump) {
        // UV teleport = island/seam edge. Do not UV-lerp the gap; start a fresh
        // segment so painting continues on the new island without seam bleed.
        seamBreak = true;
        lastStampUv = null;
      }
    }

    // maxUvJump === 0: GitHub main semantics — screen-space ray hits only,
    // no UV gap fill (avoids painting texels the ray never hit across seams).
    // Fill UV gaps between accepted samples so drag strokes read as continuous lines.
    if (maxUvJump > 0 && !seamBreak && tex > 0 && lastStampUv) {
      const fromU = lastStampUv.x;
      const fromV = lastStampUv.y;
      const du = (hit.uv.x - fromU) * tex;
      const dv = (hit.uv.y - fromV) * tex;
      const texelDist = Math.hypot(du, dv);
      // Spacing only skips intermediate samples — always keep the segment endpoint
      // (i === steps) so short pointer moves still advance the stroke.
      const isSegmentEnd = i === steps;
      if (minTexelSpacing > 0 && texelDist < minTexelSpacing && !isSegmentEnd) continue;

      if (texelDist > 1.05) {
        const gapSteps = Math.min(128, Math.ceil(texelDist));
        for (let g = 1; g < gapSteps; g++) {
          const gt = g / gapSteps;
          const gu = fromU + (hit.uv.x - fromU) * gt;
          const gv = fromV + (hit.uv.y - fromV) * gt;
          pushHit(
            {
              meshId: hit.meshId,
              faceId: hit.faceId ?? lastFaceId,
              triangleIndex: hit.triangleIndex,
              uv: new THREE.Vector2(gu, gv),
              point: hit.point,
              distance: hit.distance,
            },
            true,
          );
        }
      }
    }

    pushHit(hit, true);
  }

  return hits;
}

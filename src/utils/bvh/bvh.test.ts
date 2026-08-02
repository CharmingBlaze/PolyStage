import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generatePrimitive, buildThreeGeometry } from '../meshUtils';
import {
  attachMeshBvh,
  createBvhRaycaster,
  pickLogicalFace,
  pickPaintUv,
  samplePaintStrokeUvs,
} from './index';

function makeCubeMesh() {
  const cad = generatePrimitive('cube');
  const geo = attachMeshBvh(buildThreeGeometry(cad));
  const threeMesh = new THREE.Mesh(geo);
  threeMesh.userData.meshId = cad.id;
  threeMesh.position.set(cad.position.x, cad.position.y, cad.position.z);
  threeMesh.updateMatrixWorld(true);
  return { cad, threeMesh };
}

describe('BVH picking', () => {
  it('attaches an indirect bounds tree without breaking face maps', () => {
    const mesh = generatePrimitive('cube');
    const geo = attachMeshBvh(buildThreeGeometry(mesh));
    expect(geo.boundsTree).toBeTruthy();
    expect((geo.userData.triangleToFaceId as string[]).length).toBe(12);
    expect(geo.boundsTree?.indirect).toBe(true);
  });

  it('picks a logical face and UV via BVH raycast', () => {
    const { cad, threeMesh } = makeCubeMesh();

    const raycaster = createBvhRaycaster(true);
    // Shoot from +Z toward cube front face (centered around y=0.5)
    raycaster.set(new THREE.Vector3(0, 0.5, 3), new THREE.Vector3(0, 0, -1));

    const faceHit = pickLogicalFace(raycaster, threeMesh);
    expect(faceHit).toBeTruthy();
    expect(faceHit!.faceId).toBeTruthy();
    expect(cad.faces.some((f) => f.id === faceHit!.faceId)).toBe(true);

    const paintHit = pickPaintUv(raycaster, threeMesh);
    expect(paintHit?.uv).toBeTruthy();
    expect(Number.isFinite(paintHit!.uv.x)).toBe(true);
    expect(Number.isFinite(paintHit!.uv.y)).toBe(true);
  });

  it('returns a front-facing UV with minFacing on DoubleSide meshes', () => {
    const { threeMesh } = makeCubeMesh();
    threeMesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const raycaster = createBvhRaycaster(true);
    raycaster.set(new THREE.Vector3(0, 0.5, 3), new THREE.Vector3(0, 0, -1));
    // Must not collapse to null when BVH first-hit is a back face — scan hits.
    const hit = pickPaintUv(raycaster, threeMesh, { minFacing: 0.001 });
    expect(hit?.uv).toBeTruthy();
    expect(hit!.faceId).toBeTruthy();
    // Accepted hit must face the camera (fixes begin-only hold-drag).
    if (hit && raycaster.ray) {
      const n = new THREE.Vector3();
      // Re-validate via a second unfiltered cast: nearest front face distance.
      raycaster.firstHitOnly = false;
      const hits = raycaster.intersectObject(threeMesh, false);
      const front = hits.find((h) => {
        if (!h.face) return false;
        const nn = h.face.normal.clone().transformDirection(threeMesh.matrixWorld).normalize();
        return -raycaster.ray.direction.dot(nn) >= 0.001;
      });
      expect(front).toBeTruthy();
      expect(hit.distance).toBeCloseTo(front!.distance, 5);
      n.copy(front!.face!.normal);
    }
  });

  it('rejects hits below minFacing (grazing silhouette filter)', () => {
    const { threeMesh } = makeCubeMesh();
    const raycaster = createBvhRaycaster(true);
    // Hit the +Z face with a steep grazing ray (almost parallel to the surface).
    raycaster.set(
      new THREE.Vector3(0, 0.5, 0.6),
      new THREE.Vector3(0, 0, -1),
    );
    // Face normal is +Z; rotate ray so −dot(ray, n) is tiny.
    raycaster.ray.direction.set(0, 0.999, -0.04).normalize();
    raycaster.ray.origin.set(0, -0.2, 1.5);

    const facing = -raycaster.ray.direction.dot(new THREE.Vector3(0, 0, 1));
    expect(facing).toBeLessThan(0.08);

    const hit = pickPaintUv(raycaster, threeMesh, { minFacing: 0.08 });
    // Either miss the mesh entirely or reject as too grazing.
    expect(hit).toBeNull();
  });

  it('starts a fresh segment on seam jump without UV-lerping the teleport', () => {
    const { threeMesh } = makeCubeMesh();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0.5, 3);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);

    const raycaster = createBvhRaycaster(true);
    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    // Center of the front face in NDC ≈ screen mid.
    const mid = { x: 100, y: 100 };
    const hits = samplePaintStrokeUvs(raycaster, camera, threeMesh, rect, mid, mid, {
      textureSize: 64,
      seedUv: { u: 0.9, v: 0.9 },
      maxUvJump: 0.05,
      minFacing: 0.2,
    });

    // Accept the local hit so painting can continue on the new island, but do not
    // invent intermediate texels between the far seed and the hit (no seam bleed).
    expect(hits.length).toBe(1);
    const jump = Math.hypot(hits[0].uv.x - 0.9, hits[0].uv.y - 0.9);
    expect(jump).toBeGreaterThan(0.05);
  });

  it('densifies a screen drag into multiple UV samples for continuous strokes', () => {
    const { threeMesh } = makeCubeMesh();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0.5, 3);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);

    const raycaster = createBvhRaycaster(true);
    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const hits = samplePaintStrokeUvs(
      raycaster,
      camera,
      threeMesh,
      rect,
      { x: 70, y: 100 },
      { x: 130, y: 100 },
      {
        textureSize: 64,
        minTexelSpacing: 0.5,
        minFacing: 0.05,
        maxUvJump: 0.5,
      },
    );

    expect(hits.length).toBeGreaterThan(3);
  });

  it('still stamps a click when there is no previous stroke UV to jump from', () => {
    const { threeMesh } = makeCubeMesh();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0.5, 3);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);

    const raycaster = createBvhRaycaster(true);
    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const mid = { x: 100, y: 100 };
    // Same tight jump threshold as the seam test, but no seed — the guard must not
    // reject the very first sample of a fresh stroke.
    const hits = samplePaintStrokeUvs(raycaster, camera, threeMesh, rect, mid, mid, {
      textureSize: 64,
      maxUvJump: 0.05,
      minFacing: 0.2,
    });

    expect(hits.length).toBeGreaterThan(0);
  });
});

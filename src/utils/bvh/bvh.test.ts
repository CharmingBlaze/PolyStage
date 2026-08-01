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

  it('drops UV-jump samples that would stamp a stray seam dot', () => {
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

    // A single center sample with a far seed UV must be rejected as a seam jump.
    expect(hits).toHaveLength(0);
  });
});

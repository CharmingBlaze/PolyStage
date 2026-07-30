import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generatePrimitive, buildThreeGeometry } from '../meshUtils';
import { attachMeshBvh, createBvhRaycaster, pickLogicalFace, pickPaintUv } from './index';

describe('BVH picking', () => {
  it('attaches an indirect bounds tree without breaking face maps', () => {
    const mesh = generatePrimitive('cube');
    const geo = attachMeshBvh(buildThreeGeometry(mesh));
    expect(geo.boundsTree).toBeTruthy();
    expect((geo.userData.triangleToFaceId as string[]).length).toBe(12);
    expect(geo.boundsTree?.indirect).toBe(true);
  });

  it('picks a logical face and UV via BVH raycast', () => {
    const cad = generatePrimitive('cube');
    const geo = attachMeshBvh(buildThreeGeometry(cad));
    const threeMesh = new THREE.Mesh(geo);
    threeMesh.userData.meshId = cad.id;
    threeMesh.position.set(cad.position.x, cad.position.y, cad.position.z);
    threeMesh.updateMatrixWorld(true);

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
});

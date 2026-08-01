import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { panCameraInScreenSpace } from './viewportNav';

describe('LightWave screen-space Move navigation', () => {
  it('pans a perspective camera without changing distance or view direction', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const target = new THREE.Vector3(1, 2, -1);
    camera.position.set(7, 6, 10);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const originalOffset = camera.position.clone().sub(target);
    const originalDistance = originalOffset.length();
    const originalTarget = target.clone();

    panCameraInScreenSpace(camera, target, 80, -35, 720);

    const nextOffset = camera.position.clone().sub(target);
    expect(camera.position.distanceTo(target)).toBeCloseTo(originalDistance, 10);
    expect(nextOffset.distanceTo(originalOffset)).toBeLessThan(1e-10);
    expect(target.distanceTo(originalTarget)).toBeGreaterThan(0.01);
  });

  it('uses Shift for a quarter-speed fine pan', () => {
    const makeCamera = () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      const target = new THREE.Vector3();
      camera.position.set(4, 3, 8);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      return { camera, target };
    };
    const normal = makeCamera();
    const fine = makeCamera();

    panCameraInScreenSpace(normal.camera, normal.target, 100, 40, 600, false);
    panCameraInScreenSpace(fine.camera, fine.target, 100, 40, 600, true);

    expect(fine.target.length()).toBeCloseTo(normal.target.length() * 0.25, 10);
  });

  it('pans orthographic cameras without changing zoom', () => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const target = new THREE.Vector3();
    camera.position.set(5, 5, 5);
    camera.lookAt(target);
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    panCameraInScreenSpace(camera, target, -60, 25, 500);

    expect(camera.zoom).toBe(2);
    expect(camera.position.distanceTo(target)).toBeCloseTo(Math.sqrt(75), 10);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  calculateScreenStableScale,
  createVertexSprite,
  updateVertexSpriteState,
  getTargetScreenPixels,
  pickClosestVertex,
} from './vertexSprite';
import type { CADMesh } from '../types/cad';

describe('vertexSprite', () => {
  it('calculates screen-stable scale for perspective camera', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.position.set(0, 0, 10);
    const worldPos = new THREE.Vector3(0, 0, 0); // distance = 10
    const viewportHeight = 800;
    const targetPx = 10;

    const scale = calculateScreenStableScale(camera, worldPos, viewportHeight, targetPx);
    // At distance 10, visible height = 2 * 10 * tan(30deg) = 20 * 0.57735 = 11.547
    // scale = (10 / 800) * 11.547 = 0.1443
    expect(scale).toBeGreaterThan(0.14);
    expect(scale).toBeLessThan(0.15);

    // Doubling distance should double world-space scale so screen pixels stay constant
    const farPos = new THREE.Vector3(0, 0, -10); // distance = 20
    const scaleFar = calculateScreenStableScale(camera, farPos, viewportHeight, targetPx);
    expect(scaleFar).toBeCloseTo(scale * 2, 2);
  });

  it('calculates screen-stable scale for orthographic camera', () => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    camera.zoom = 1;
    const worldPos = new THREE.Vector3(0, 0, 0);
    const viewportHeight = 500;
    const targetPx = 10;

    const scale = calculateScreenStableScale(camera, worldPos, viewportHeight, targetPx);
    // orthoSpan = 10 / 1 = 10
    // scale = (10 / 500) * 10 = 0.2
    expect(scale).toBeCloseTo(0.2, 3);
  });

  it('creates and updates vertex sprite handles', () => {
    const pos = new THREE.Vector3(1, 2, 3);
    const sprite = createVertexSprite('v1', 'mesh_1', pos, 'idle');

    expect(sprite).toBeInstanceOf(THREE.Sprite);
    expect(sprite.userData.vertexId).toBe('v1');
    expect(sprite.userData.state).toBe('idle');
    expect(sprite.userData.targetPx).toBe(getTargetScreenPixels('idle'));

    updateVertexSpriteState(sprite, 'selected');
    expect(sprite.userData.state).toBe('selected');
    expect(sprite.userData.targetPx).toBe(getTargetScreenPixels('selected'));

    updateVertexSpriteState(sprite, 'hovered');
    expect(sprite.userData.state).toBe('hovered');
    expect(sprite.userData.targetPx).toBe(getTargetScreenPixels('hovered'));
  });

  it('picks closest vertex in screen space', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const mockContainer = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 800,
        right: 800,
        bottom: 800,
      }),
    } as unknown as HTMLElement;

    const testMesh: CADMesh = {
      id: 'm1',
      name: 'Test',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      vertices: [
        { id: 'v_center', x: 0, y: 0, z: 0 },
        { id: 'v_offset', x: 2, y: 2, z: 0 },
      ],
      faces: [],
      edges: [],
    };

    // Center projects to (400, 400)
    const pickedCenter = pickClosestVertex(402, 398, testMesh, camera, mockContainer, 16);
    expect(pickedCenter).toBe('v_center');

    // Clicking far away from any vertex returns null
    const pickedNone = pickClosestVertex(100, 100, testMesh, camera, mockContainer, 16);
    expect(pickedNone).toBeNull();
  });
});

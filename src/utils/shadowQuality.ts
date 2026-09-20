import * as THREE from 'three';

/**
 * Three.js Shadow System for PolyStage 3D Modeler.
 *
 * Implements Percentage-Closer Soft Shadows (PCFSoftShadowMap), standard PCF,
 * high-performance BasicShadowMap, and Variance Shadow Maps (VSMShadowMap),
 * alongside dynamic frustum auto-fitting and shadow camera helpers.
 */

export type ShadowMapAlgorithm = 'pcf-soft' | 'pcf' | 'basic' | 'vsm' | 'off';
export type ShadowQualityLevel = 'draft' | 'standard' | 'high';

export interface ShadowQualityPreset {
  mapSize: number;
  bias: number;
  normalBias: number;
  radius: number;
}

/**
 * Presets optimized for real-time 3D viewport modeling.
 * Standard preset uses the recommended 2048 map size with -0.0001 bias and 0.02 normalBias
 * to completely eliminate shadow acne while maintaining sharp contact edges.
 */
export const SHADOW_QUALITY: Record<ShadowQualityLevel, ShadowQualityPreset> = {
  draft: {
    mapSize: 1024,
    bias: -0.0002,
    normalBias: 0.03,
    radius: 1.5,
  },
  standard: {
    mapSize: 2048,
    bias: -0.0001,
    normalBias: 0.02,
    radius: 2.0,
  },
  high: {
    mapSize: 4096,
    bias: -0.00005,
    normalBias: 0.01,
    radius: 2.5,
  },
};

/**
 * Map user-facing algorithm identifier to Three.js shadow map type constant.
 */
export function resolveShadowMapType(algorithm: ShadowMapAlgorithm = 'pcf-soft'): THREE.ShadowMapType | null {
  switch (algorithm) {
    case 'pcf-soft':
      return THREE.PCFSoftShadowMap;
    case 'pcf':
      return THREE.PCFShadowMap;
    case 'basic':
      return THREE.BasicShadowMap;
    case 'vsm':
      return THREE.VSMShadowMap;
    case 'off':
      return null;
    default:
      return THREE.PCFSoftShadowMap;
  }
}

/**
 * Friendly label for shadow map algorithms.
 */
export function getShadowMapLabel(algorithm: ShadowMapAlgorithm): string {
  switch (algorithm) {
    case 'pcf-soft':
      return 'PCF Soft (Recommended)';
    case 'pcf':
      return 'PCF Standard';
    case 'basic':
      return 'Basic (High Perf)';
    case 'vsm':
      return 'VSM (Variance)';
    case 'off':
      return 'Disabled';
  }
}

export interface ShadowConfigOptions {
  preset?: ShadowQualityPreset;
  span?: number;
  bias?: number;
  normalBias?: number;
  near?: number;
  far?: number;
}

/**
 * Configure directional light shadow parameters (resolution, frustum, and acne bias).
 */
export function configureShadow(
  light: THREE.DirectionalLight | THREE.SpotLight,
  q: ShadowQualityPreset = SHADOW_QUALITY.standard,
  span = 10,
  overrides?: Partial<ShadowConfigOptions>,
): void {
  light.castShadow = true;

  // If mapSize changes, dispose existing map so Three.js recreates the render target cleanly
  const targetMapSize = q.mapSize;
  if (light.shadow.map && (light.shadow.mapSize.x !== targetMapSize || light.shadow.mapSize.y !== targetMapSize)) {
    light.shadow.map.dispose();
    light.shadow.map = null;
  }

  light.shadow.mapSize.set(targetMapSize, targetMapSize);
  light.shadow.bias = overrides?.bias ?? q.bias;
  light.shadow.normalBias = overrides?.normalBias ?? q.normalBias;
  light.shadow.radius = q.radius;

  if (light instanceof THREE.DirectionalLight) {
    const cam = light.shadow.camera;
    const effectiveSpan = overrides?.span ?? span;
    cam.near = overrides?.near ?? 0.5;
    cam.far = overrides?.far ?? 50;
    cam.left = -effectiveSpan;
    cam.right = effectiveSpan;
    cam.top = effectiveSpan;
    cam.bottom = -effectiveSpan;
    cam.updateProjectionMatrix();
  } else if (light instanceof THREE.SpotLight) {
    light.shadow.camera.near = overrides?.near ?? 0.5;
    light.shadow.camera.far = overrides?.far ?? Math.max(4, light.distance || 50);
    light.shadow.camera.updateProjectionMatrix();
  }

  light.shadow.needsUpdate = true;
}

export interface AutoFitShadowOptions {
  padding?: number;
  minSpan?: number;
  maxSpan?: number;
}

/**
 * Dynamically adjust shadow camera orthographic frustum bounds to wrap the scene/model bounding box.
 * This prevents shadows from being cut off when zooming out or scaling objects, while keeping
 * the shadow frustum as tight as possible around the geometry to maximize shadow texel density.
 */
export function fitShadowCameraToScene(
  light: THREE.DirectionalLight,
  targetObject: THREE.Object3D,
  options: AutoFitShadowOptions = {},
): { span: number; center: THREE.Vector3 } {
  const { padding = 1.35, minSpan = 4, maxSpan = 120 } = options;

  const box = new THREE.Box3();
  let hasValidMeshes = false;

  targetObject.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.visible) {
      // Exclude shadow floors, helpers, grids, gizmos
      if (
        child.name.includes('shadowFloor') ||
        child.name.includes('grid') ||
        child.name.includes('helper') ||
        child.name.includes('ghost') ||
        child.name.includes('gizmo')
      ) {
        return;
      }
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }
        box.expandByObject(mesh);
        hasValidMeshes = true;
      }
    }
  });

  const center = new THREE.Vector3(0, 0, 0);
  let span = 10;

  if (hasValidMeshes && !box.isEmpty()) {
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    center.copy(sphere.center);
    span = Math.max(minSpan, Math.min(maxSpan, sphere.radius * padding));
  }

  const cam = light.shadow.camera;
  cam.left = -span;
  cam.right = span;
  cam.top = span;
  cam.bottom = -span;
  cam.updateProjectionMatrix();
  light.shadow.needsUpdate = true;

  return { span, center };
}

/**
 * Create a Three.js CameraHelper for the shadow camera.
 * Draws a wireframe frustum box showing exactly where shadows are calculated.
 */
export function createShadowCameraHelper(light: THREE.DirectionalLight): THREE.CameraHelper {
  const helper = new THREE.CameraHelper(light.shadow.camera);
  helper.name = 'shadow-camera-helper';
  helper.visible = true;
  return helper;
}

/**
 * Recompile materials in a scene graph when the shadow map algorithm changes.
 * In Three.js, changing renderer.shadowMap.type requires material recompilation
 * because different shader chunks are injected.
 */
export function invalidateSceneShadowMaterials(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => {
          mat.needsUpdate = true;
        });
      } else if (mesh.material) {
        mesh.material.needsUpdate = true;
      }
    }
  });
}
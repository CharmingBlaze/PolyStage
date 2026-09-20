import * as THREE from 'three';
import {
  SHADOW_QUALITY,
  configureShadow,
  fitShadowCameraToScene,
  createShadowCameraHelper,
  type ShadowQualityLevel,
} from './shadowQuality';

/**
 * Professional 3D modeler studio lighting rig.
 *
 * Camera-relative three-point lighting (key / fill / rim) + hemisphere ambient.
 * The key light casts shadows; fill and rim provide form definition without
 * washing out surface detail. Inspired by Marmoset Toolbag / Blender MatCap
 * studio lighting.
 *
 * Includes integrated shadow camera frustum helper and dynamic scene auto-fitting.
 */

export interface StudioRigConfig {
  shadowQuality?: ShadowQualityLevel;
  shadowBias?: number;
  shadowNormalBias?: number;
  shadowsEnabled?: boolean;
}

const _tempV = new THREE.Vector3();
const _tempUp = new THREE.Vector3();

export interface StudioLightRig {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  shadowFloor: THREE.Mesh;
  grid: THREE.GridHelper;
  shadowHelper: THREE.CameraHelper | null;

  syncToCamera(camera: THREE.Camera): void;
  autoFitShadowCamera(centerOrRadius: THREE.Vector3 | number, radius?: number): void;
  fitToScene(targetObject: THREE.Object3D): void;
  setShadowQuality(q: ShadowQualityLevel): void;
  setShadowBiases(bias: number, normalBias: number): void;
  setShadowsEnabled(enabled: boolean): void;
  setShadowHelperVisible(visible: boolean): void;
  setMasterIntensity(v: number): void;
  setHelpersVisible(v: boolean): void;
  dispose(): void;
}

export function createStudioLightRig(
  scene: THREE.Scene,
  config: StudioRigConfig = {},
): StudioLightRig {
  const sq = config.shadowQuality ?? 'standard';
  const shadowsEnabled = config.shadowsEnabled ?? true;

  // ambient fill
  const ambient = new THREE.HemisphereLight('#d4dce8', '#1a1a24', 0.35);
  ambient.name = 'studio-ambient';
  scene.add(ambient);

  // key (shadow caster)
  const key = new THREE.DirectionalLight('#fff5ec', 2.8);
  key.name = 'studio-key';
  configureShadow(key, SHADOW_QUALITY[sq], 10, {
    bias: config.shadowBias,
    normalBias: config.shadowNormalBias,
  });
  key.castShadow = shadowsEnabled;
  scene.add(key);

  // shadow camera helper (wireframe frustum box)
  const shadowHelper = createShadowCameraHelper(key);
  shadowHelper.visible = false;
  scene.add(shadowHelper);

  // fill
  const fill = new THREE.DirectionalLight('#d0dcff', 0.9);
  fill.name = 'studio-fill';
  fill.castShadow = false;
  scene.add(fill);

  // rim
  const rim = new THREE.DirectionalLight('#fff4e6', 1.5);
  rim.name = 'studio-rim';
  rim.castShadow = false;
  scene.add(rim);

  // ground grid
  const grid = new THREE.GridHelper(14, 28, 0x43474e, 0x24262b);
  grid.name = 'studio-grid';
  grid.position.y = -0.001;
  scene.add(grid);

  // ground shadow receiver
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ opacity: 0.2 }),
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -0.002;
  shadowFloor.receiveShadow = true;
  shadowFloor.name = 'studio-shadowFloor';
  scene.add(shadowFloor);

  function syncToCamera(camera: THREE.Camera): void {
    const cp = camera.getWorldPosition(_tempV);
    // Key: 45° right, 60° up
    const kd = new THREE.Vector3()
      .copy(cp)
      .normalize()
      .applyAxisAngle(_tempUp.set(0, 1, 0), Math.PI / 4)
      .multiplyScalar(10);
    kd.y += 8;
    key.position.copy(cp).add(kd);

    // Fill: 40° left, 25° up
    const fd = new THREE.Vector3()
      .copy(cp)
      .normalize()
      .applyAxisAngle(_tempUp.set(0, 1, 0), -Math.PI / 2.8)
      .multiplyScalar(8);
    fd.y += 3;
    fill.position.copy(cp).add(fd);

    // Rim: behind, high
    const rd = new THREE.Vector3()
      .copy(cp)
      .normalize()
      .applyAxisAngle(_tempUp.set(0, 1, 0), Math.PI)
      .multiplyScalar(6);
    rd.y += 10;
    rim.position.copy(cp).add(rd);

    if (shadowHelper.visible) {
      shadowHelper.update();
    }
  }

  function autoFitShadowCamera(centerOrRadius: THREE.Vector3 | number, maybeRadius?: number): void {
    let radius: number;
    if (typeof centerOrRadius === 'number') {
      radius = centerOrRadius;
    } else {
      radius = maybeRadius ?? 4;
    }
    const span = Math.max(radius * 2.2, 5);
    const cam = key.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.updateProjectionMatrix();
    key.shadow.needsUpdate = true;
    if (shadowHelper.visible) {
      shadowHelper.update();
    }
  }

  function fitToScene(targetObject: THREE.Object3D): void {
    fitShadowCameraToScene(key, targetObject);
    if (shadowHelper.visible) {
      shadowHelper.update();
    }
  }

  function setShadowQuality(q: ShadowQualityLevel): void {
    const currentSpan = key.shadow.camera.right || 10;
    configureShadow(key, SHADOW_QUALITY[q], currentSpan);
    if (shadowHelper.visible) {
      shadowHelper.update();
    }
  }

  function setShadowBiases(bias: number, normalBias: number): void {
    key.shadow.bias = bias;
    key.shadow.normalBias = normalBias;
    key.shadow.needsUpdate = true;
  }

  function setShadowsEnabled(enabled: boolean): void {
    key.castShadow = enabled;
    shadowFloor.visible = enabled;
    key.shadow.needsUpdate = true;
  }

  function setShadowHelperVisible(visible: boolean): void {
    shadowHelper.visible = visible;
    if (visible) {
      shadowHelper.update();
    }
  }

  function setMasterIntensity(v: number): void {
    key.intensity = 2.8 * v;
    fill.intensity = 0.9 * v;
    rim.intensity = 1.5 * v;
    ambient.intensity = 0.35 * v;
  }

  function setHelpersVisible(v: boolean): void {
    grid.visible = v;
    if (!v) {
      shadowHelper.visible = false;
    }
  }

  function dispose(): void {
    scene.remove(ambient, key, fill, rim, grid, shadowFloor, shadowHelper);
    grid.dispose();
    shadowFloor.geometry.dispose();
    (shadowFloor.material as THREE.Material).dispose();
    shadowHelper.dispose();
  }

  return {
    key,
    fill,
    rim,
    ambient,
    shadowFloor,
    grid,
    shadowHelper,
    syncToCamera,
    autoFitShadowCamera,
    fitToScene,
    setShadowQuality,
    setShadowBiases,
    setShadowsEnabled,
    setShadowHelperVisible,
    setMasterIntensity,
    setHelpersVisible,
    dispose,
  };
}
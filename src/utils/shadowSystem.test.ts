import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  resolveShadowMapType,
  getShadowMapLabel,
  configureShadow,
  fitShadowCameraToScene,
  createShadowCameraHelper,
  invalidateSceneShadowMaterials,
  SHADOW_QUALITY,
} from './shadowQuality';
import { createStudioLightRig } from './studioLighting';
import { applyRendererConfig } from './viewportRenderer';

describe('Three.js Shadow System', () => {
  describe('Algorithm Resolvers and Labels', () => {
    it('resolves PCFSoftShadowMap as recommended default', () => {
      expect(resolveShadowMapType('pcf-soft')).toBe(THREE.PCFSoftShadowMap);
      expect(resolveShadowMapType()).toBe(THREE.PCFSoftShadowMap);
    });

    it('resolves PCF, Basic, and VSM shadow map types', () => {
      expect(resolveShadowMapType('pcf')).toBe(THREE.PCFShadowMap);
      expect(resolveShadowMapType('basic')).toBe(THREE.BasicShadowMap);
      expect(resolveShadowMapType('vsm')).toBe(THREE.VSMShadowMap);
    });

    it('resolves disabled / off to null', () => {
      expect(resolveShadowMapType('off')).toBeNull();
    });

    it('provides user-friendly labels', () => {
      expect(getShadowMapLabel('pcf-soft')).toContain('PCF Soft');
      expect(getShadowMapLabel('basic')).toContain('Basic');
      expect(getShadowMapLabel('off')).toContain('Disabled');
    });
  });

  describe('configureShadow', () => {
    it('configures directional light shadow map size, biases, and camera frustum', () => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      configureShadow(dirLight, SHADOW_QUALITY.standard, 12, {
        bias: -0.0001,
        normalBias: 0.02,
        near: 0.5,
        far: 50,
      });

      expect(dirLight.castShadow).toBe(true);
      expect(dirLight.shadow.mapSize.x).toBe(2048);
      expect(dirLight.shadow.mapSize.y).toBe(2048);
      expect(dirLight.shadow.bias).toBe(-0.0001);
      expect(dirLight.shadow.normalBias).toBe(0.02);

      const cam = dirLight.shadow.camera;
      expect(cam.near).toBe(0.5);
      expect(cam.far).toBe(50);
      expect(cam.left).toBe(-12);
      expect(cam.right).toBe(12);
      expect(cam.top).toBe(12);
      expect(cam.bottom).toBe(-12);
    });

    it('disposes existing shadow render target if map resolution changes', () => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      const mockDispose = vi.fn();
      dirLight.shadow.map = { dispose: mockDispose } as unknown as THREE.WebGLRenderTarget;
      dirLight.shadow.mapSize.set(1024, 1024);

      configureShadow(dirLight, SHADOW_QUALITY.high);
      expect(mockDispose).toHaveBeenCalledTimes(1);
      expect(dirLight.shadow.mapSize.x).toBe(4096);
    });
  });

  describe('fitShadowCameraToScene', () => {
    it('tightens shadow camera around scene geometry and excludes helper objects', () => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      const sceneGroup = new THREE.Group();

      // Add a test cube mesh (size 4x4x4 centered at 0, 2, 0)
      const geo = new THREE.BoxGeometry(4, 4, 4);
      const mat = new THREE.MeshStandardMaterial();
      const cubeMesh = new THREE.Mesh(geo, mat);
      cubeMesh.position.set(0, 2, 0);
      sceneGroup.add(cubeMesh);

      // Add a shadowFloor and grid helper which should be excluded from bounding calculations
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
      floor.name = 'studio-shadowFloor';
      sceneGroup.add(floor);

      const grid = new THREE.GridHelper(100, 10);
      grid.name = 'studio-grid';
      sceneGroup.add(grid);

      const { span } = fitShadowCameraToScene(dirLight, sceneGroup);

      // Sphere radius for a 4x4x4 cube is approx sqrt(2^2 + 2^2 + 2^2) = 3.46.
      // With 1.35 padding, span should be approx 4.67 (or minimum 4)
      expect(span).toBeGreaterThan(4);
      expect(span).toBeLessThan(10); // Far smaller than 100x100 helper floor
      expect(dirLight.shadow.camera.right).toBe(span);
      expect(dirLight.shadow.camera.left).toBe(-span);
      expect(dirLight.shadow.needsUpdate).toBe(true);
    });

    it('falls back to minimum default span if target is empty', () => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      const emptyGroup = new THREE.Group();

      const { span } = fitShadowCameraToScene(dirLight, emptyGroup);
      expect(span).toBe(10);
    });
  });

  describe('createShadowCameraHelper and invalidateSceneShadowMaterials', () => {
    it('creates a camera helper referencing the light shadow camera', () => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      const helper = createShadowCameraHelper(dirLight);

      expect(helper).toBeInstanceOf(THREE.CameraHelper);
      expect(helper.name).toBe('shadow-camera-helper');
      expect(helper.camera).toBe(dirLight.shadow.camera);
    });

    it('invalidates materials across the scene graph on shadow map changes', () => {
      const scene = new THREE.Scene();
      const mat1 = new THREE.MeshStandardMaterial();
      const mat2 = new THREE.MeshStandardMaterial();
      const initialVer1 = mat1.version;
      const initialVer2 = mat2.version;

      const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat1);
      const mesh2 = new THREE.Mesh(new THREE.SphereGeometry(1), [mat2]);
      scene.add(mesh1, mesh2);

      invalidateSceneShadowMaterials(scene);
      expect(mat1.version).toBeGreaterThan(initialVer1);
      expect(mat2.version).toBeGreaterThan(initialVer2);
    });
  });

  describe('createStudioLightRig', () => {
    it('initializes studio lighting with soft shadows and helper', () => {
      const scene = new THREE.Scene();
      const rig = createStudioLightRig(scene, {
        shadowQuality: 'standard',
        shadowBias: -0.0001,
        shadowNormalBias: 0.02,
        shadowsEnabled: true,
      });

      expect(rig.key).toBeDefined();
      expect(rig.key.castShadow).toBe(true);
      expect(rig.key.shadow.bias).toBe(-0.0001);
      expect(rig.key.shadow.normalBias).toBe(0.02);
      expect(rig.shadowFloor.receiveShadow).toBe(true);
      expect(rig.shadowHelper).toBeDefined();
      expect(rig.shadowHelper?.visible).toBe(false);

      // Helper visibility toggle
      rig.setShadowHelperVisible(true);
      expect(rig.shadowHelper?.visible).toBe(true);

      // Shadow quality change
      rig.setShadowQuality('high');
      expect(rig.key.shadow.mapSize.x).toBe(4096);

      // Shadow disable
      rig.setShadowsEnabled(false);
      expect(rig.key.castShadow).toBe(false);
      expect(rig.shadowFloor.visible).toBe(false);

      // Clean disposal
      rig.dispose();
      expect(scene.children.length).toBe(0);
    });
  });

  describe('applyRendererConfig', () => {
    it('allows configuring shadow map algorithm and runtime updates on a renderer', () => {
      const mockRenderer = {
        shadowMap: {
          enabled: false,
          type: THREE.BasicShadowMap,
          needsUpdate: false,
        },
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 1.0,
      } as unknown as THREE.WebGLRenderer;

      const scene = new THREE.Scene();

      // Configure to PCF Soft
      applyRendererConfig(
        mockRenderer,
        {
          shadowMapType: 'pcf-soft',
          shadowsEnabled: true,
        },
        scene,
      );

      expect(mockRenderer.shadowMap.enabled).toBe(true);
      expect(mockRenderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
      expect(mockRenderer.shadowMap.needsUpdate).toBe(true);

      // Configure to disabled
      applyRendererConfig(
        mockRenderer,
        {
          shadowMapType: 'off',
        },
        scene,
      );
      expect(mockRenderer.shadowMap.enabled).toBe(false);
    });
  });
});

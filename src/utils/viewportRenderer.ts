import * as THREE from 'three';
import {
  type ShadowMapAlgorithm,
  resolveShadowMapType,
  invalidateSceneShadowMaterials,
} from './shadowQuality';

/**
 * Shared WebGL renderer factory for all PolyStage viewports.
 * Ensures consistent anti-aliasing, tone mapping, soft shadow config,
 * and color space across every 3D panel.
 */

export interface RendererConfig {
  antialiasSamples?: number; // 0 = off, 4 = default, 8 = high
  maxPixelRatio?: number;
  toneMapping?: 'none' | 'aces' | 'agx';
  canvas?: HTMLCanvasElement;
  shadowMapType?: ShadowMapAlgorithm;
  shadowsEnabled?: boolean;
}

export function createViewportRenderer(
  config: RendererConfig = {},
): THREE.WebGLRenderer {
  const {
    antialiasSamples = 4,
    maxPixelRatio = 2,
    canvas,
    shadowMapType = 'pcf-soft',
    shadowsEnabled = true,
  } = config;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: antialiasSamples > 0,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
    preserveDrawingBuffer: false,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const tm = config.toneMapping ?? 'aces';
  if (tm === 'aces') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  } else if (tm === 'agx') {
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
  }

  // Recommended default for 3D modelers: PCFSoftShadowMap for realistic, smooth edges
  const resolvedType = resolveShadowMapType(shadowMapType);
  if (resolvedType === null || !shadowsEnabled) {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = resolvedType;
  }

  return renderer;
}

/**
 * Apply post-creation config to an existing renderer
 * (for cases where the renderer is created outside the factory).
 */
export function applyRendererConfig(
  renderer: THREE.WebGLRenderer,
  config: Pick<RendererConfig, 'toneMapping' | 'shadowMapType' | 'shadowsEnabled'>,
  scene?: THREE.Scene,
): void {
  if (config.toneMapping) {
    const tm = config.toneMapping;
    if (tm === 'aces') {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
    } else if (tm === 'agx') {
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.toneMappingExposure = 1.0;
    } else {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1.0;
    }
  }

  if (config.shadowMapType !== undefined || config.shadowsEnabled !== undefined) {
    const smType = config.shadowMapType ?? 'pcf-soft';
    const enabled = config.shadowsEnabled ?? true;
    const resolvedType = resolveShadowMapType(smType);

    const prevEnabled = renderer.shadowMap.enabled;
    const prevType = renderer.shadowMap.type;

    if (resolvedType === null || !enabled) {
      renderer.shadowMap.enabled = false;
    } else {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = resolvedType;
    }

    // Material recompilation is needed in Three.js if shadowMap type or enabled state changes
    if (scene && (prevEnabled !== renderer.shadowMap.enabled || prevType !== renderer.shadowMap.type)) {
      renderer.shadowMap.needsUpdate = true;
      invalidateSceneShadowMaterials(scene);
    }
  }
}
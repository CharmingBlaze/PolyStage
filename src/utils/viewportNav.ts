import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Default viewport navigation — used in every 3D window / mode:
 *   LMB   — orbit (rotate)  ·  pan in orthographic views
 *   RMB   — pan (drag)
 *   MMB   — dolly (zoom drag)
 *   Wheel — zoom
 */
export const STANDARD_ORBIT_MOUSE_BUTTONS: OrbitControls['mouseButtons'] = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};

/** @deprecated alias */
export const BLOCKBENCH_ORBIT_MOUSE_BUTTONS = STANDARD_ORBIT_MOUSE_BUTTONS;

export function applyStandardOrbitMouseButtons(controls: OrbitControls | null | undefined) {
  if (!controls) return;
  controls.mouseButtons = {
    LEFT: controls.enableRotate ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enableZoom = true;
}

/** @deprecated alias */
export const applyBlockbenchOrbitMouseButtons = applyStandardOrbitMouseButtons;

/**
 * No-op kept for call-site compatibility (old Blockbench Ctrl+MMB zoom binder).
 */
export function bindBlockbenchOrbitModifiers(
  _controls: OrbitControls,
  _domElement: HTMLElement,
): () => void {
  return () => {};
}

/** Short HUD / status hint shared by 3D views */
export const STANDARD_NAV_HINT = 'LMB orbit · RMB pan · MMB/Wheel zoom';

/** @deprecated alias */
export const BLOCKBENCH_NAV_HINT = STANDARD_NAV_HINT;

/** 2D canvas pan buttons (UV / Pixel Paint / graphs) — RMB pans; MMB can also pan in 2D */
export function isStandard2DPanButton(button: number): boolean {
  return button === 1 || button === 2;
}

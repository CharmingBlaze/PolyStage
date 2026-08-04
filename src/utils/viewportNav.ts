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

/**
 * 3D Brush / paint: LMB is reserved for painting — never orbit.
 * OrbitControls fighting LMB was the main cause of "only dots, no drag stroke".
 *   LMB   — paint (handled by Viewport3D; disabled here)
 *   MMB   — dolly
 *   RMB   — pan
 *   Wheel — zoom
 *   Alt+LMB — orbit (Viewport temporarily re-enables LEFT rotate)
 */
export function applyPaintOrbitMouseButtons(controls: OrbitControls | null | undefined) {
  if (!controls) return;
  // LMB must stay unbound for the entire paint workspace — not only mid-stroke.
  // Re-applying STANDARD buttons while idle was re-arming orbit and stealing drags.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
}

/** Arm Alt+LMB orbit for a single gesture while staying in paint mode. */
export function applyPaintAltOrbitMouseButtons(controls: OrbitControls | null | undefined) {
  if (!controls) return;
  controls.enabled = true;
  controls.enableRotate = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
}

/**
 * Translate a camera and its orbit target together in camera screen space.
 * The camera→target offset never changes, so this is a true view drag—not a dolly.
 */
export function panCameraInScreenSpace(
  camera: THREE.Camera,
  target: THREE.Vector3,
  deltaX: number,
  deltaY: number,
  viewportHeight: number,
  shiftKey = false,
) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const height = Math.max(1, viewportHeight);
  let worldPerPixel = 0.01;

  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = Math.max(0.001, camera.position.distanceTo(target));
    worldPerPixel =
      (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / height;
  } else if (camera instanceof THREE.OrthographicCamera) {
    worldPerPixel = Math.abs(camera.top - camera.bottom) / Math.max(0.001, camera.zoom) / height;
  }

  if (shiftKey) worldPerPixel *= 0.25;
  const translation = right
    .multiplyScalar(-deltaX * worldPerPixel)
    .add(up.multiplyScalar(deltaY * worldPerPixel));
  camera.position.add(translation);
  target.add(translation);
}

/**
 * Blockout pen / modes where LMB is always a draw tool (never orbit).
 * Ortho drafting views also map MMB → pan (CAD-style); wheel still zooms.
 */
export function applyDrawToolOrbitMouseButtons(
  controls: OrbitControls | null | undefined,
  opts?: { ortho?: boolean },
) {
  if (!controls) return;
  controls.mouseButtons = {
    LEFT: -1 as unknown as THREE.MOUSE,
    MIDDLE: opts?.ortho ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
}

/** Clear a stuck OrbitControls gesture (pointer list desync after conflicting capture). */
export function resetOrbitPointerState(
  controls: OrbitControls | null | undefined,
  opts?: { enable?: boolean },
) {
  if (!controls) return;
  const c = controls as OrbitControls & {
    _pointers?: number[];
    _pointerPositions?: Record<string, unknown>;
    _controlActive?: boolean;
    state?: number;
  };
  if (c._pointers?.length) {
    c._pointers.length = 0;
  }
  if (c._pointerPositions) {
    for (const key of Object.keys(c._pointerPositions)) {
      delete c._pointerPositions[key];
    }
  }
  if (typeof c.state === 'number') c.state = 0; // NONE
  if (typeof c._controlActive === 'boolean') c._controlActive = false;
  // Default keeps prior behavior for non-paint callers; paint must pass enable:false
  // so we don't re-arm orbit mid-stroke.
  if (opts?.enable != null) {
    controls.enabled = opts.enable;
  }
}

/**
 * Full paint-idle nav restore: clear stuck gestures, rebind paint mouse buttons,
 * and ensure zoom/pan/rotate flags are healthy (fixes "zoom stuck after paint").
 */
export function restorePaintOrbitControls(
  controls: OrbitControls | null | undefined,
  opts?: { enable?: boolean; allowRotate?: boolean },
) {
  if (!controls) return;
  resetOrbitPointerState(controls, { enable: opts?.enable ?? true });
  applyPaintOrbitMouseButtons(controls);
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.enableRotate = opts?.allowRotate ?? true;
  controls.screenSpacePanning = true;
}


/** Short HUD / status hint shared by 3D views */
export const STANDARD_NAV_HINT = 'LMB orbit · RMB pan · MMB/Wheel zoom';

export const PAINT_NAV_HINT = 'LMB drag paint · Alt+LMB orbit · RMB pan · [ ] size';

/** @deprecated alias */
export const BLOCKBENCH_NAV_HINT = STANDARD_NAV_HINT;

/** 2D canvas pan buttons (UV / Pixel Paint / graphs) — RMB pans; MMB can also pan in 2D */
export function isStandard2DPanButton(button: number): boolean {
  return button === 1 || button === 2;
}

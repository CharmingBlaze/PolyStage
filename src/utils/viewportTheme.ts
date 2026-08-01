import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * Viewport / gizmo palette — Substance-style chrome (matches `index.css` tokens).
 * Axis colors stay RGB-readable but softened for the dark viewport; active = brand orange.
 */
export const VIEWPORT_THEME = {
  accent: 0xed7300,
  accentSoft: 0xff9a3c,
  accentStrong: 0xc96a00,
  warning: 0xe68619,
  danger: 0xec5b62,
  success: 0x2d9d78,
  /** Softened X (red) — theme danger family */
  axisX: 0xec5b62,
  /** Softened Y (green) — theme success */
  axisY: 0x2d9d78,
  /** Softened Z — cool slate-blue that sits with charcoal UI (not Adobe cyan) */
  axisZ: 0x6a9ec4,
  /** Hover / active gizmo axis */
  axisActive: 0xed7300,
  /** Perspective floor — charcoal like OutlineForge LIVE 3D (not orange). */
  gridMajor: 0x565656,
  gridMinor: 0x303030,
  gridOrthoMajor: 0xc96a00,
  gridOrthoMinor: 0x383838,
  selection: 0xe68619,
  hover: 0xec5b62,
  idleHandle: 0x6a9ec4,
  boneIdle: 0xed7300,
  boneSelected: 0xff9a3c,
  cameraIdle: 0x888888,
  cameraSelected: 0xed7300,
  particleIdle: 0xc96a00,
  particleSelected: 0xed7300,
  lightSelected: 0xe68619,
  lightShaft: 0xff9a3c,
  ghostFill: 0xed7300,
  ghostWire: 0xff9a3c,
  ghostRing: 0xe68619,
  weightZero: 0x6a9ec4,
} as const;

export function applyThemedTransformGizmo(controls: TransformControls) {
  const t = VIEWPORT_THEME;
  controls.setColors(t.axisX, t.axisY, t.axisZ, t.axisActive);
}

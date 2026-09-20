import type { GizmoMode, TransformGizmo } from '@voluma/three-transform-gizmo';
import type { TransformMode } from '../types/cad';

/**
 * Viewport / gizmo palette — TasteSkill Neochrome.
 * Axis colors stay RGB-readable; active = teal accent.
 */
export const VIEWPORT_THEME = {
  accent: 0x00b4c4,
  accentSoft: 0x00d4e2,
  accentStrong: 0x007a85,
  warning: 0xc98a26,
  danger: 0xe0556a,
  success: 0x34a87a,
  axisX: 0xe0556a,
  axisY: 0x34a87a,
  axisZ: 0x4a90d9,
  axisActive: 0x00b4c4,
  gridMajor: 0x2a2e38,
  gridMinor: 0x1d2028,
  gridOrthoMajor: 0x00b4c4,
  gridOrthoMinor: 0x1d2028,
  selection: 0xe6b422,
  hover: 0xe0556a,
  idleHandle: 0x4a90d9,
  boneIdle: 0x00b4c4,
  boneSelected: 0xe6b422,
  cameraIdle: 0x6e7584,
  cameraSelected: 0x00b4c4,
  particleIdle: 0xc98a26,
  particleSelected: 0xe6b422,
  lightSelected: 0xe6b422,
  lightShaft: 0x00b4c4,
  ghostFill: 0x00b4c4,
  ghostWire: 0x00d4e2,
  ghostRing: 0xe6b422,
  weightZero: 0x4a90d9,
} as const;

export function applyThemedTransformGizmo(controls: TransformGizmo | any) {
  const t = VIEWPORT_THEME;
  if (controls && typeof controls.setColors === 'function') {
    controls.setColors(t.axisX, t.axisY, t.axisZ, t.axisActive);
  }
  if (controls && typeof controls.setTheme === 'function') {
    controls.setTheme({
      colors: {
        x: t.axisX,
        y: t.axisY,
        z: t.axisZ,
        hover: t.axisActive,
        active: t.axisActive,
        screen: t.axisZ,
        uniform: t.accent,
        sector: t.axisActive,
        sectorLabel: 0xe2e6ec,
        originGhost: t.selection,
      },
    });
  }
}

export function gizmoModeForTool(mode: TransformMode): GizmoMode {
  if (mode === 'rotate') return 'rotate';
  if (mode === 'scale') return 'scale';
  if (mode === 'combined') return 'combined';
  return 'translate';
}

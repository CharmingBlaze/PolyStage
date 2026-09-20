/**
 * CAD unit system.
 *
 * PolyStage scene space is treated as meters. Everything the user reads or types
 * can be expressed in a real-world unit system so models line up with engine
 * scale (1 unit = 1 m in Godot/Unity-imported glTF, Unreal uses cm, etc).
 *
 * All functions here are pure so they can be unit tested without a renderer.
 */

export type UnitSystem = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface UnitDefinition {
  id: UnitSystem;
  /** Human readable name for menus. */
  label: string;
  /** Short suffix printed next to numbers. */
  suffix: string;
  /** Length of one unit expressed in meters. */
  meters: number;
  /** Digits after the decimal point used by default. */
  precision: number;
}

export const UNIT_DEFINITIONS: Record<UnitSystem, UnitDefinition> = {
  mm: { id: 'mm', label: 'Millimeters', suffix: 'mm', meters: 0.001, precision: 2 },
  cm: { id: 'cm', label: 'Centimeters', suffix: 'cm', meters: 0.01, precision: 2 },
  m: { id: 'm', label: 'Meters', suffix: 'm', meters: 1, precision: 3 },
  in: { id: 'in', label: 'Inches', suffix: 'in', meters: 0.0254, precision: 3 },
  ft: { id: 'ft', label: 'Feet', suffix: 'ft', meters: 0.3048, precision: 3 },
};

export const UNIT_SYSTEMS: UnitSystem[] = ['mm', 'cm', 'm', 'in', 'ft'];

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'm';

export function isUnitSystem(value: unknown): value is UnitSystem {
  return typeof value === 'string' && (UNIT_SYSTEMS as string[]).includes(value);
}

/** Meters covered by one unit of `unit`. */
export function unitScale(unit: UnitSystem): number {
  return UNIT_DEFINITIONS[unit].meters;
}

/** Scene-space meters -> the number the user sees in `unit`. */
export function metersToUnit(meters: number, unit: UnitSystem): number {
  return meters / unitScale(unit);
}

/** A user-entered number in `unit` -> scene-space meters. */
export function unitToMeters(value: number, unit: UnitSystem): number {
  return value * unitScale(unit);
}

/** Convert a length between two unit systems. */
export function convertLength(value: number, from: UnitSystem, to: UnitSystem): number {
  return metersToUnit(unitToMeters(value, from), to);
}

/** Round a number to a fixed amount of decimals without floating point noise. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  return String(rounded);
}

/** Format a scene-space length (meters) in the active unit system. */
export function formatLength(
  meters: number,
  unit: UnitSystem = DEFAULT_UNIT_SYSTEM,
  precision?: number,
): string {
  if (!Number.isFinite(meters)) return '—';
  const digits = precision ?? UNIT_DEFINITIONS[unit].precision;
  return `${formatNumber(metersToUnit(meters, unit), digits)} ${UNIT_DEFINITIONS[unit].suffix}`;
}

/** Format an angle in degrees. */
export function formatAngle(degrees: number, precision = 1): string {
  if (!Number.isFinite(degrees)) return '—';
  return `${formatNumber(degrees, precision)}°`;
}

/**
 * Extract an explicit unit suffix from free text.
 * Accepts the abbreviations plus the `"` (inch) and `'` (foot) shorthand.
 */
export function parseUnitSuffix(text: string): UnitSystem | null {
  if (typeof text !== 'string') return null;
  const match = /(mm|cm|in|ft|m|"|')/i.exec(text.trim());
  if (!match) return null;
  const token = match[1].toLowerCase();
  if (token === '"') return 'in';
  if (token === "'") return 'ft';
  return isUnitSystem(token) ? token : null;
}

/**
 * Parse a user typed length.
 *
 * Accepts a bare number (interpreted in `fallback`) or a value carrying an
 * explicit unit suffix (`"25cm"`, `"3.5 in"`, `12"`). Returns scene-space
 * meters, or `null` when the text cannot be understood.
 */
export function parseLength(text: string, fallback: UnitSystem = DEFAULT_UNIT_SYSTEM): number | null {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (!cleaned) return null;
  const numberMatch = /-?\d*\.?\d+(?:e[-+]?\d+)?/i.exec(cleaned);
  if (!numberMatch) return null;
  const value = Number(numberMatch[0]);
  if (!Number.isFinite(value)) return null;
  const unit = parseUnitSuffix(cleaned) ?? fallback;
  return unitToMeters(value, unit);
}

/**
 * CAD precision snap: round a scene-space value to the nearest multiple of
 * `step`. A non-positive step is a no-op so the caller can pass `gridSnap = 0`
 * to mean "off".
 */
export function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];

/**
 * Choose a human friendly grid step for a unit system: the smallest "nice"
 * number of units that covers at least `targetMeters`. Used to label the
 * viewport grid with real-world spacing.
 */
export function gridStepForUnit(
  unit: UnitSystem,
  targetMeters = 0.25,
): { meters: number; units: number } {
  const targetUnits = metersToUnit(targetMeters, unit);
  for (const candidate of NICE_STEPS) {
    if (candidate >= targetUnits) return { meters: unitToMeters(candidate, unit), units: candidate };
  }
  const units = Math.ceil(targetUnits);
  return { meters: unitToMeters(units, unit), units };
}

/** Full label including the numeric value, e.g. `"0.25 m"`. */
export function describeGridStep(unit: UnitSystem, targetMeters = 0.25): string {
  const { meters, units } = gridStepForUnit(unit, targetMeters);
  return `${formatNumber(units, UNIT_DEFINITIONS[unit].precision)} ${UNIT_DEFINITIONS[unit].suffix} (${formatNumber(meters, 3)} m)`;
}
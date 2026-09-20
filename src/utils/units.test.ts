import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_SYSTEM,
  UNIT_SYSTEMS,
  convertLength,
  describeGridStep,
  formatAngle,
  formatLength,
  formatNumber,
  gridStepForUnit,
  isUnitSystem,
  metersToUnit,
  parseLength,
  parseUnitSuffix,
  snapToStep,
  unitScale,
  unitToMeters,
} from './units';

describe('unit definitions', () => {
  it('exposes a scale for every unit system', () => {
    UNIT_SYSTEMS.forEach((unit) => {
      expect(unitScale(unit)).toBeGreaterThan(0);
    });
  });

  it('uses meters as the default system', () => {
    expect(DEFAULT_UNIT_SYSTEM).toBe('m');
    expect(unitScale('m')).toBe(1);
  });

  it('validates unit system strings', () => {
    expect(isUnitSystem('cm')).toBe(true);
    expect(isUnitSystem('km')).toBe(false);
    expect(isUnitSystem(undefined)).toBe(false);
  });
});

describe('conversion', () => {
  it('converts scene meters into each unit', () => {
    expect(metersToUnit(1, 'mm')).toBeCloseTo(1000, 9);
    expect(metersToUnit(1, 'cm')).toBeCloseTo(100, 9);
    expect(metersToUnit(1, 'm')).toBe(1);
    expect(metersToUnit(1, 'in')).toBeCloseTo(39.3700787, 6);
    expect(metersToUnit(1, 'ft')).toBeCloseTo(3.28083989, 6);
  });

  it('round-trips a value through unitToMeters and metersToUnit', () => {
    const meters = unitToMeters(12.5, 'cm');
    expect(meters).toBeCloseTo(0.125, 12);
    expect(metersToUnit(meters, 'cm')).toBeCloseTo(12.5, 12);
  });

  it('converts directly between two unit systems', () => {
    expect(convertLength(1, 'ft', 'in')).toBeCloseTo(12, 9);
    expect(convertLength(100, 'cm', 'm')).toBeCloseTo(1, 9);
    expect(convertLength(1000, 'mm', 'm')).toBeCloseTo(1, 9);
  });
});

describe('formatting', () => {
  it('formats lengths with the unit precision', () => {
    expect(formatLength(1, 'm')).toBe('1 m');
    expect(formatLength(1, 'cm')).toBe('100 cm');
    expect(formatLength(0.5, 'm')).toBe('0.5 m');
  });

  it('honours an explicit precision override', () => {
    expect(formatLength(1 / 3, 'm', 2)).toBe('0.33 m');
    expect(formatLength(1 / 3, 'm', 4)).toBe('0.3333 m');
  });

  it('never prints negative zero or floating point noise', () => {
    expect(formatNumber(0.1 + 0.2, 3)).toBe('0.3');
    expect(formatNumber(-0.0000001, 2)).toBe('0');
  });

  it('returns a placeholder for non-finite numbers', () => {
    expect(formatLength(Number.NaN, 'm')).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatAngle(Number.NaN)).toBe('—');
  });

  it('formats angles in degrees', () => {
    expect(formatAngle(45)).toBe('45°');
    expect(formatAngle(89.456)).toBe('89.5°');
  });
});

describe('parsing', () => {
  it('reads explicit unit suffixes', () => {
    expect(parseUnitSuffix('25cm')).toBe('cm');
    expect(parseUnitSuffix('3.5 in')).toBe('in');
    expect(parseUnitSuffix('12"')).toBe('in');
    expect(parseUnitSuffix("6'")).toBe('ft');
    expect(parseUnitSuffix('no unit here')).toBeNull();
  });

  it('prefers millimetres over the bare m suffix', () => {
    expect(parseUnitSuffix('400mm')).toBe('mm');
  });

  it('parses bare numbers using the fallback unit', () => {
    expect(parseLength('2.5', 'm')).toBeCloseTo(2.5, 12);
    expect(parseLength('2.5', 'cm')).toBeCloseTo(0.025, 12);
  });

  it('parses suffixed numbers into meters', () => {
    expect(parseLength('250cm')).toBeCloseTo(2.5, 12);
    expect(parseLength('1000mm')).toBeCloseTo(1, 12);
    expect(parseLength('12"')).toBeCloseTo(0.3048, 12);
  });

  it('accepts negative values and scientific notation', () => {
    expect(parseLength('-3cm')).toBeCloseTo(-0.03, 12);
    expect(parseLength('1e2cm')).toBeCloseTo(1, 12);
  });

  it('rejects text with no number', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('   ')).toBeNull();
  });
});

describe('precision snapping', () => {
  it('rounds to the nearest step', () => {
    expect(snapToStep(0.26, 0.25)).toBeCloseTo(0.25, 12);
    expect(snapToStep(0.38, 0.25)).toBeCloseTo(0.5, 12);
    expect(snapToStep(-1.1, 0.5)).toBeCloseTo(-1, 12);
  });

  it('is a no-op when the step is disabled', () => {
    expect(snapToStep(0.37, 0)).toBe(0.37);
    expect(snapToStep(0.37, -1)).toBe(0.37);
    expect(snapToStep(0.37, Number.NaN)).toBe(0.37);
  });
});

describe('grid step selection', () => {
  it('picks a nice number of units covering the target', () => {
    expect(gridStepForUnit('m', 0.25)).toEqual({ meters: 0.25, units: 0.25 });
    expect(gridStepForUnit('cm', 0.25).units).toBe(25);
    expect(gridStepForUnit('mm', 0.25).units).toBe(250);
  });

  it('reports the spacing in both units and meters', () => {
    expect(describeGridStep('cm', 0.25)).toBe('25 cm (0.25 m)');
  });
});
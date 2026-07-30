import { describe, expect, it } from 'vitest';
import {
  createCamera,
  createDefaultEnvironment,
  createParticleEmitter,
  createParticleFromPreset,
  exportParticleGameJson,
  weatherPresetToEnv,
} from './cutsceneEnv';

describe('cutscene environment', () => {
  it('builds cameras and default env', () => {
    const cam = createCamera('A');
    expect(cam.fov).toBe(45);
    expect(createDefaultEnvironment().weather).toBe('clear');
  });

  it('maps weather presets to fog', () => {
    expect(weatherPresetToEnv('fog').fogDensity).toBeGreaterThan(0);
    expect(weatherPresetToEnv('clear').fogDensity).toBe(0);
    expect(weatherPresetToEnv('storm').windStrength).toBeGreaterThan(1);
  });

  it('exports game particle json', () => {
    const emitter = createParticleEmitter('Sparks');
    const json = JSON.parse(exportParticleGameJson(emitter));
    expect(json.format).toBe('polystage-particle');
    expect(json.emitter.rate).toBe(emitter.rate);
    expect(json.identifier).toContain('gel:');
  });

  it('builds particle effect presets', () => {
    const fire = createParticleFromPreset('fire');
    expect(fire.name).toBe('Fire');
    expect(fire.rate).toBeGreaterThan(40);
    expect(fire.startColor).toMatch(/^#/);
  });
});

import type {
  CADCamera,
  EnvironmentSettings,
  ParticleEmitter,
  Vector3D,
  WeatherPreset,
} from '../types/cad';
import { PARTICLE_FORMAT } from '../brand';
import { generateId } from './meshUtils';

const v = (x = 0, y = 0, z = 0): Vector3D => ({ x, y, z });
const id = (prefix: string) => `${prefix}_${generateId()}`;

export function createDefaultEnvironment(): EnvironmentSettings {
  return {
    weather: 'clear',
    fogDensity: 0,
    fogColor: '#a8b4c4',
    sunElevation: 48,
    sunAzimuth: 39,
    sunColor: '#ffffff',
    ambientColor: '#ffffff',
    skyTopColor: '#1a2740',
    skyHorizonColor: '#6b8caf',
    windStrength: 0.2,
    backgroundMode: 'sky',
    backgroundColor: '#1b1b1b',
    visible: false,
    position: v(0, 2, 0),
    rotation: v(),
    scale: v(1, 1, 1),
  };
}

export function createCamera(name = 'Camera', position = v(4, 3, 5)): CADCamera {
  return {
    id: id('cam'),
    name,
    position: { ...position },
    rotation: { x: -0.4, y: 0.6, z: 0 },
    lookAt: { x: 0, y: 1, z: 0 },
    fov: 45,
    near: 0.1,
    far: 500,
    visible: true,
    locked: false,
  };
}

export type CameraShotPresetId = 'wide' | 'medium' | 'close' | 'low' | 'high' | 'profile' | 'otsp';

export const CAMERA_SHOT_PRESETS: Array<{
  id: CameraShotPresetId;
  label: string;
  hint: string;
  position: Vector3D;
  lookAt: Vector3D;
  fov: number;
}> = [
  { id: 'wide', label: 'Wide', hint: 'Establishing / master shot', position: v(9, 5, 11), lookAt: v(0, 1, 0), fov: 55 },
  { id: 'medium', label: 'Medium', hint: 'Waist-up character shot', position: v(4.5, 2.2, 5.5), lookAt: v(0, 1.2, 0), fov: 40 },
  { id: 'close', label: 'Close-up', hint: 'Face / detail', position: v(2.2, 1.6, 2.8), lookAt: v(0, 1.5, 0), fov: 32 },
  { id: 'low', label: 'Low Angle', hint: 'Hero / power', position: v(3.5, 0.6, 5), lookAt: v(0, 1.4, 0), fov: 42 },
  { id: 'high', label: 'High Angle', hint: 'Overview / vulnerability', position: v(4, 7, 4), lookAt: v(0, 0.8, 0), fov: 48 },
  { id: 'profile', label: 'Profile', hint: 'Side silhouette', position: v(6, 1.6, 0.2), lookAt: v(0, 1.4, 0), fov: 38 },
  { id: 'otsp', label: 'OTS', hint: 'Over-the-shoulder dialogue', position: v(1.4, 1.7, 2.6), lookAt: v(0, 1.5, -0.4), fov: 36 },
];

/** Build a camera aimed at lookAt from position (Euler XYZ). */
export function createCameraShot(preset: CameraShotPresetId, name?: string): CADCamera {
  const shot = CAMERA_SHOT_PRESETS.find((p) => p.id === preset) || CAMERA_SHOT_PRESETS[1];
  const cam = createCamera(name || shot.label, shot.position);
  cam.lookAt = { ...shot.lookAt };
  cam.fov = shot.fov;
  cam.rotation = aimCameraRotation(shot.position, shot.lookAt);
  return cam;
}

/** Create a camera matching the free orbit view (machinima “set shot from view”). */
export function createCameraFromView(
  name: string,
  position: Vector3D,
  rotation: Vector3D,
  fov: number,
  lookAt: Vector3D | null = null,
): CADCamera {
  const cam = createCamera(name, position);
  cam.rotation = { ...rotation };
  cam.fov = Math.max(15, Math.min(100, fov));
  cam.lookAt = lookAt ? { ...lookAt } : null;
  return cam;
}

/** Euler so local −Z aims from `from` toward `target` (Three.js camera default). */
export function aimCameraRotation(from: Vector3D, target: Vector3D): Vector3D {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  return { x: pitch, y: yaw, z: 0 };
}

export function createParticleEmitter(name = 'Spark'): ParticleEmitter {
  return {
    id: id('fx'),
    name,
    identifier: `gel:${name.toLowerCase().replace(/\s+/g, '_')}`,
    position: v(0, 1, 0),
    rotation: v(),
    scale: v(1, 1, 1),
    enabled: true,
    shape: 'point',
    shapeSize: v(0.5, 0.5, 0.5),
    rate: 40,
    maxParticles: 200,
    lifetime: 1.2,
    lifetimeRandom: 0.4,
    startSpeed: 1.5,
    startSpeedRandom: 0.5,
    gravity: v(0, -2, 0),
    drag: 0.05,
    startSize: 0.12,
    endSize: 0.02,
    startColor: '#ffe08a',
    endColor: '#ff5522',
    startAlpha: 1,
    endAlpha: 0,
    billboard: 'camera',
    textureDataUrl: null,
    emitStart: 0,
    emitEnd: 999,
  };
}

export type ParticlePresetId =
  | 'sparks' | 'smoke' | 'fire' | 'magic' | 'dust' | 'embers' | 'snow_burst' | 'rain_mist';

export const PARTICLE_PRESETS: { id: ParticlePresetId; label: string; hint: string }[] = [
  { id: 'sparks', label: 'Sparks', hint: 'Hot upward sparks' },
  { id: 'smoke', label: 'Smoke', hint: 'Soft rising smoke' },
  { id: 'fire', label: 'Fire', hint: 'Campfire-style flames' },
  { id: 'magic', label: 'Magic', hint: 'Glowing arcane motes' },
  { id: 'dust', label: 'Dust', hint: 'Ground dust puff' },
  { id: 'embers', label: 'Embers', hint: 'Floating embers' },
  { id: 'snow_burst', label: 'Snow', hint: 'Local snowfall burst' },
  { id: 'rain_mist', label: 'Mist', hint: 'Fine rain mist' },
];

/** Quick-add cutscene particle effects (Snowstorm-style authoring presets). */
export function createParticleFromPreset(preset: ParticlePresetId): ParticleEmitter {
  const base = createParticleEmitter(PARTICLE_PRESETS.find((p) => p.id === preset)?.label || 'Effect');
  switch (preset) {
    case 'sparks':
      return {
        ...base,
        shape: 'point',
        rate: 55,
        lifetime: 0.9,
        startSpeed: 2.4,
        gravity: v(0, -4, 0),
        startSize: 0.08,
        endSize: 0.01,
        startColor: '#ffe08a',
        endColor: '#ff3b1f',
      };
    case 'smoke':
      return {
        ...base,
        shape: 'disc',
        shapeSize: v(0.35, 0.1, 0.35),
        rate: 18,
        lifetime: 2.4,
        startSpeed: 0.55,
        gravity: v(0, 0.35, 0),
        drag: 0.12,
        startSize: 0.22,
        endSize: 0.55,
        startColor: '#9aa3ad',
        endColor: '#4a5560',
        startAlpha: 0.55,
        endAlpha: 0,
      };
    case 'fire':
      return {
        ...base,
        shape: 'disc',
        shapeSize: v(0.25, 0.05, 0.25),
        rate: 70,
        lifetime: 0.7,
        startSpeed: 1.1,
        gravity: v(0, 1.8, 0),
        startSize: 0.16,
        endSize: 0.02,
        startColor: '#ffd36a',
        endColor: '#ff4d18',
      };
    case 'magic':
      return {
        ...base,
        shape: 'sphere',
        shapeSize: v(0.6, 0.6, 0.6),
        rate: 35,
        lifetime: 1.6,
        startSpeed: 0.7,
        gravity: v(0, 0.15, 0),
        startSize: 0.1,
        endSize: 0.02,
        startColor: '#9b7bff',
        endColor: '#38bdf8',
      };
    case 'dust':
      return {
        ...base,
        shape: 'box',
        shapeSize: v(1.2, 0.15, 1.2),
        rate: 28,
        lifetime: 1.8,
        startSpeed: 0.35,
        gravity: v(0, -0.15, 0),
        drag: 0.2,
        startSize: 0.14,
        endSize: 0.28,
        startColor: '#c4b59a',
        endColor: '#8a7a60',
        startAlpha: 0.45,
        endAlpha: 0,
      };
    case 'embers':
      return {
        ...base,
        shape: 'point',
        rate: 22,
        lifetime: 2.2,
        startSpeed: 0.45,
        gravity: v(0, 0.55, 0),
        startSize: 0.06,
        endSize: 0.01,
        startColor: '#ffb347',
        endColor: '#ff6b35',
      };
    case 'snow_burst':
      return {
        ...base,
        shape: 'box',
        shapeSize: v(2, 0.4, 2),
        position: v(0, 3, 0),
        rate: 40,
        lifetime: 3.5,
        startSpeed: 0.25,
        gravity: v(0, -0.55, 0),
        drag: 0.08,
        startSize: 0.08,
        endSize: 0.05,
        startColor: '#ffffff',
        endColor: '#dbe7f3',
      };
    case 'rain_mist':
      return {
        ...base,
        shape: 'box',
        shapeSize: v(2.5, 0.2, 2.5),
        position: v(0, 3.5, 0),
        rate: 90,
        lifetime: 1.1,
        startSpeed: 0.1,
        gravity: v(0, -6, 0),
        startSize: 0.04,
        endSize: 0.02,
        startColor: '#9ec8ff',
        endColor: '#6a90b8',
        startAlpha: 0.7,
        endAlpha: 0.1,
      };
    default:
      return base;
  }
}

export function weatherPresetToEnv(weather: WeatherPreset, base?: EnvironmentSettings): EnvironmentSettings {
  const env = { ...(base || createDefaultEnvironment()), weather };
  switch (weather) {
    case 'clear':
      return { ...env, fogDensity: 0, sunElevation: 60, windStrength: 0.1, skyTopColor: '#1a2740', skyHorizonColor: '#6b8caf' };
    case 'fog':
      return { ...env, fogDensity: 0.08, fogColor: '#9aa8b8', sunElevation: 40, windStrength: 0.05, skyTopColor: '#4a5568', skyHorizonColor: '#8a96a8' };
    case 'rain':
      return { ...env, fogDensity: 0.035, fogColor: '#6a7585', sunElevation: 35, windStrength: 0.6, skyTopColor: '#2a3344', skyHorizonColor: '#5a6678' };
    case 'snow':
      return { ...env, fogDensity: 0.025, fogColor: '#d0d8e0', sunElevation: 30, windStrength: 0.35, skyTopColor: '#3a4558', skyHorizonColor: '#b0bcc8' };
    case 'storm':
      return { ...env, fogDensity: 0.06, fogColor: '#4a5564', sunElevation: 20, windStrength: 1.2, skyTopColor: '#121820', skyHorizonColor: '#3a4450' };
    case 'overcast':
      return { ...env, fogDensity: 0.015, fogColor: '#8894a4', sunElevation: 45, windStrength: 0.25, skyTopColor: '#3a4658', skyHorizonColor: '#7a8898' };
    default:
      return env;
  }
}

/** Export particle emitter to engine-agnostic game JSON (Snowstorm-inspired schema). */
export function exportParticleGameJson(emitter: ParticleEmitter): string {
  return JSON.stringify(
    {
      format: PARTICLE_FORMAT,
      version: 1,
      identifier: emitter.identifier,
      name: emitter.name,
      emitter: {
        shape: emitter.shape,
        shape_size: [emitter.shapeSize.x, emitter.shapeSize.y, emitter.shapeSize.z],
        rate: emitter.rate,
        max_particles: emitter.maxParticles,
        lifetime: [Math.max(0.05, emitter.lifetime - emitter.lifetimeRandom), emitter.lifetime + emitter.lifetimeRandom],
        speed: [Math.max(0, emitter.startSpeed - emitter.startSpeedRandom), emitter.startSpeed + emitter.startSpeedRandom],
        gravity: [emitter.gravity.x, emitter.gravity.y, emitter.gravity.z],
        drag: emitter.drag,
        size: [emitter.startSize, emitter.endSize],
        color: {
          start: emitter.startColor,
          end: emitter.endColor,
          start_alpha: emitter.startAlpha,
          end_alpha: emitter.endAlpha,
        },
        billboard: emitter.billboard,
        transform: {
          position: [emitter.position.x, emitter.position.y, emitter.position.z],
          rotation: [emitter.rotation.x, emitter.rotation.y, emitter.rotation.z],
        },
      },
    },
    null,
    2,
  );
}

export function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number): Vector3D {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: Math.cos(el) * Math.cos(az),
  };
}

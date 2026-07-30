import type { CADBone, Vector3D } from '../types/cad';

export type ProcAnimId =
  | 'fish_swim_x' | 'fish_swim_y' | 'fish_slow_x' | 'fish_slow_y' | 'fish_idle_x' | 'fish_idle_y'
  | 'bird_idle_1' | 'bird_idle_2' | 'bird_fly_glide' | 'bird_fly_fast' | 'bird_peck' | 'bird_scratch' | 'bird_drink';

export interface ProcAnimMeta {
  id: ProcAnimId;
  label: string;
  description: string;
  species: 'fish' | 'bird';
  duration: number;
}

export const PROC_ANIMATIONS: ProcAnimMeta[] = [
  { id: 'fish_swim_x', label: 'Swim X', description: 'Side-to-side swim wave along the body.', species: 'fish', duration: 1.2 },
  { id: 'fish_swim_y', label: 'Swim Y', description: 'Vertical undulation while swimming.', species: 'fish', duration: 1.2 },
  { id: 'fish_slow_x', label: 'Slow Swim X', description: 'Gentle lateral cruise.', species: 'fish', duration: 2.0 },
  { id: 'fish_slow_y', label: 'Slow Swim Y', description: 'Gentle vertical cruise.', species: 'fish', duration: 2.0 },
  { id: 'fish_idle_x', label: 'Idle X', description: 'Subtle lateral idle sway.', species: 'fish', duration: 2.4 },
  { id: 'fish_idle_y', label: 'Idle Y', description: 'Subtle vertical idle sway.', species: 'fish', duration: 2.4 },
  { id: 'bird_idle_1', label: 'Bird Idle 1', description: 'Calm idle: body breath + alert head.', species: 'bird', duration: 2.5 },
  { id: 'bird_idle_2', label: 'Bird Idle 2', description: 'Soft wing settle + tail flick.', species: 'bird', duration: 2.8 },
  { id: 'bird_fly_glide', label: 'Fly Glide', description: 'Slow wing flaps with glide hold.', species: 'bird', duration: 1.6 },
  { id: 'bird_fly_fast', label: 'Fly Fast', description: 'Rapid wing beat cycle.', species: 'bird', duration: 0.7 },
  { id: 'bird_peck', label: 'Peck', description: 'Neck/head peck downward.', species: 'bird', duration: 0.9 },
  { id: 'bird_scratch', label: 'Scratch', description: 'Leg scratch near body.', species: 'bird', duration: 1.1 },
  { id: 'bird_drink', label: 'Drink', description: 'Dip head then lift (drink).', species: 'bird', duration: 1.4 },
];

const cloneV = (vec: Vector3D): Vector3D => ({ x: vec.x, y: vec.y, z: vec.z });

function findByName(bones: CADBone[], name: string) {
  return bones.find((b) => b.name === name || b.name.toLowerCase() === name.toLowerCase());
}

function setRot(bone: CADBone, rx: number, ry: number, rz: number): CADBone {
  const rest = bone.restRotation || { x: 0, y: 0, z: 0 };
  return {
    ...bone,
    rotation: { x: rest.x + rx, y: rest.y + ry, z: rest.z + rz },
  };
}

/**
 * Evaluate a procedural bone animation at time t (seconds), scaled by speed.
 * Returns posed bones (rest + procedural offsets). Does not mutate rest.
 */
export function evaluateProceduralBoneAnim(
  bones: CADBone[],
  animId: ProcAnimId,
  time: number,
  speed = 1,
): CADBone[] {
  const meta = PROC_ANIMATIONS.find((a) => a.id === animId);
  const duration = meta?.duration || 2;
  const t = ((time * Math.max(0.05, speed)) % duration) / duration;
  const w = t * Math.PI * 2;

  if (animId.startsWith('fish_')) {
    const axis = animId.includes('_y') ? 'x' : 'y'; // swim_y pitches (x), swim_x yaws (y)
    const amp =
      animId.includes('idle') ? 0.08 :
      animId.includes('slow') ? 0.18 :
      0.32;
    const phaseStep = 0.55;
    return bones.map((bone, index) => {
      const phase = w - index * phaseStep;
      const amount = Math.sin(phase) * amp * (0.6 + index * 0.08);
      if (axis === 'y') return setRot(bone, 0, amount, 0);
      return setRot(bone, amount, 0, 0);
    });
  }

  // Bird animations
  const byName = (name: string) => findByName(bones, name);
  const map = new Map(bones.map((b) => [b.id, { ...b, rotation: cloneV(b.restRotation || b.rotation), position: cloneV(b.restPosition || b.position) }]));
  const apply = (name: string, rx = 0, ry = 0, rz = 0) => {
    const bone = byName(name);
    if (!bone) return;
    const current = map.get(bone.id)!;
    const rest = bone.restRotation || { x: 0, y: 0, z: 0 };
    map.set(bone.id, {
      ...current,
      rotation: { x: rest.x + rx, y: rest.y + ry, z: rest.z + rz },
    });
  };

  const breath = Math.sin(w) * 0.04;
  if (animId === 'bird_idle_1') {
    apply('Body', breath, 0, 0);
    apply('Neck', Math.sin(w * 0.5) * 0.08, Math.sin(w * 0.7) * 0.1, 0);
    apply('Head', Math.sin(w * 0.5 + 0.4) * 0.12, Math.sin(w * 0.6) * 0.08, 0);
    apply('TailBase', 0, 0, Math.sin(w + 1) * 0.06);
  } else if (animId === 'bird_idle_2') {
    apply('Body', breath * 0.7, 0, 0);
    apply('WingL_Upper', 0, 0, Math.sin(w) * 0.05);
    apply('WingR_Upper', 0, 0, -Math.sin(w) * 0.05);
    apply('TailTip', Math.sin(w * 2) * 0.1, 0, 0);
  } else if (animId === 'bird_fly_glide') {
    const flap = Math.sin(w) * 0.55;
    apply('WingL_Upper', 0, 0, flap);
    apply('WingR_Upper', 0, 0, -flap);
    apply('WingL_Tip', 0, 0, flap * 0.4);
    apply('WingR_Tip', 0, 0, -flap * 0.4);
    apply('Body', Math.sin(w * 0.5) * 0.05, 0, 0);
  } else if (animId === 'bird_fly_fast') {
    const flap = Math.sin(w) * 0.85;
    apply('WingL_Upper', 0, 0, flap);
    apply('WingR_Upper', 0, 0, -flap);
    apply('WingL_Tip', 0, 0, flap * 0.55);
    apply('WingR_Tip', 0, 0, -flap * 0.55);
    apply('Body', Math.sin(w) * 0.08, 0, 0);
  } else if (animId === 'bird_peck') {
    const dip = Math.sin(Math.min(1, t * 2) * Math.PI) * 0.7;
    apply('Neck', dip, 0, 0);
    apply('Head', dip * 0.5, 0, 0);
  } else if (animId === 'bird_scratch') {
    const kick = Math.max(0, Math.sin(w)) * 0.9;
    apply('LegL', -kick, 0, kick * 0.3);
    apply('FootL', kick * 0.4, 0, 0);
  } else if (animId === 'bird_drink') {
    const dip = Math.sin(t * Math.PI) * 0.85;
    apply('Neck', dip, 0, 0);
    apply('Head', dip * 0.65, 0, 0);
    apply('Body', dip * 0.15, 0, 0);
  }

  return bones.map((b) => map.get(b.id) || b);
}

export function detectProcSpecies(bones: CADBone[]): 'fish' | 'bird' | 'other' {
  const names = new Set(bones.map((b) => b.name));
  if (names.has('WingL_Upper')) return 'bird';
  if (names.has('Mid1') || names.has('TailFin')) return 'fish';
  return 'other';
}

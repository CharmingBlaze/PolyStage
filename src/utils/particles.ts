import * as THREE from 'three';
import type { ParticleEmitter } from '../types/cad';

type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  alive: boolean;
};

function hexToRgb(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/**
 * Lightweight GPU-friendly Points particle system for cutscene preview.
 */
export class ParticleSystem {
  group: THREE.Group;
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private particles: Particle[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private emitAcc = 0;
  emitter: ParticleEmitter;

  constructor(emitter: ParticleEmitter) {
    this.emitter = emitter;
    this.group = new THREE.Group();
    this.group.name = emitter.name;

    const max = Math.max(1, emitter.maxParticles);
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: emitter.startSize,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
    this.group.position.set(emitter.position.x, emitter.position.y, emitter.position.z);

    for (let i = 0; i < max; i += 1) {
      this.particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0,
        lifetime: 1,
        alive: false,
      });
    }
  }

  updateEmitter(emitter: ParticleEmitter) {
    this.emitter = emitter;
    this.group.position.set(emitter.position.x, emitter.position.y, emitter.position.z);
    this.material.size = emitter.startSize;
  }

  private spawnOne(p: Particle) {
    const e = this.emitter;
    const sx = e.shapeSize.x;
    const sy = e.shapeSize.y;
    const sz = e.shapeSize.z;
    if (e.shape === 'box') {
      p.position.set((Math.random() - 0.5) * sx, (Math.random() - 0.5) * sy, (Math.random() - 0.5) * sz);
    } else if (e.shape === 'sphere') {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.position.copy(dir.multiplyScalar(Math.random() * Math.max(sx, sy, sz) * 0.5));
    } else if (e.shape === 'disc') {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * sx * 0.5;
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    } else {
      p.position.set(0, 0, 0);
    }

    const speed = e.startSpeed + (Math.random() * 2 - 1) * e.startSpeedRandom;
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
    p.velocity.copy(dir.multiplyScalar(speed));
    p.lifetime = Math.max(0.05, e.lifetime + (Math.random() * 2 - 1) * e.lifetimeRandom);
    p.age = 0;
    p.alive = true;
  }

  update(dt: number, cutsceneTime?: number) {
    const e = this.emitter;
    if (!e.enabled) {
      this.geometry.attributes.position.needsUpdate = true;
      return;
    }
    if (
      typeof cutsceneTime === 'number' &&
      (cutsceneTime < (e.emitStart ?? 0) || cutsceneTime > (e.emitEnd ?? 9999))
    ) {
      // Still age existing particles but don't emit
    } else {
      this.emitAcc += e.rate * dt;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const slot = this.particles.find((p) => !p.alive);
        if (slot) this.spawnOne(slot);
      }
    }

    const startCol = hexToRgb(e.startColor);
    const endCol = hexToRgb(e.endColor);
    let aliveCount = 0;

    this.particles.forEach((p, i) => {
      if (!p.alive) {
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = -9999;
        this.positions[i * 3 + 2] = 0;
        return;
      }
      p.age += dt;
      if (p.age >= p.lifetime) {
        p.alive = false;
        this.positions[i * 3 + 1] = -9999;
        return;
      }
      p.velocity.x += e.gravity.x * dt;
      p.velocity.y += e.gravity.y * dt;
      p.velocity.z += e.gravity.z * dt;
      p.velocity.multiplyScalar(Math.max(0, 1 - e.drag * dt * 60));
      p.position.addScaledVector(p.velocity, dt);

      const t = p.age / p.lifetime;
      const col = startCol.clone().lerp(endCol, t);
      const alpha = e.startAlpha + (e.endAlpha - e.startAlpha) * t;
      this.positions[i * 3] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;
      this.colors[i * 3] = col.r * alpha;
      this.colors[i * 3 + 1] = col.g * alpha;
      this.colors[i * 3 + 2] = col.b * alpha;
      aliveCount += 1;
    });

    const size = e.startSize + (e.endSize - e.startSize) * 0.5;
    this.material.size = size;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    void aliveCount;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { CADLight, CADLightType, Vector3D } from '../types/cad';
import { generateId } from './meshUtils';

const v = (x = 0, y = 0, z = 0): Vector3D => ({ x, y, z });

let areaLibReady = false;

export function ensureAreaLightSupport() {
  if (areaLibReady) return;
  RectAreaLightUniformsLib.init();
  areaLibReady = true;
}

export const CAD_LIGHT_TYPE_LABELS: Record<CADLightType, string> = {
  ambient: 'Ambient',
  directional: 'Sun',
  point: 'Point',
  spot: 'Spot',
  area: 'Area',
};

export function createCADLight(
  type: CADLightType = 'point',
  name?: string,
  position = v(2, 4, 2),
): CADLight {
  const labels: Record<CADLightType, string> = {
    ambient: 'Ambient Light',
    directional: 'Sun Light',
    point: 'Point Light',
    spot: 'Spot Light',
    area: 'Area Light',
  };
  const isArea = type === 'area';
  const isSun = type === 'directional';
  return {
    id: `light_${generateId()}`,
    name: name || labels[type],
    type,
    position: { ...position },
    rotation: isSun || type === 'spot' || isArea
      ? aimLightRotation(position, v(0, 0.6, 0))
      : v(),
    scale: isArea ? v(1.5, 1, 1) : v(1, 1, 1),
    color: type === 'ambient' ? '#c8d4e8' : isSun ? '#ffe4c4' : type === 'area' ? '#fff0dd' : '#c8d4ff',
    intensity: type === 'ambient' ? 0.12 : isSun ? 3.2 : type === 'area' ? 4 : type === 'spot' ? 2.4 : 0.45,
    distance: type === 'point' || type === 'spot' ? 22 : 0,
    angle: Math.PI / 5,
    penumbra: 0.35,
    decay: 2,
    width: isArea ? 3 : undefined,
    height: isArea ? 2 : undefined,
    castShadow: isSun || type === 'spot',
    visible: true,
    locked: false,
  };
}

/** Rotation so local −Y aims from `from` toward `target` (matches Cutscene light sync). */
export function aimLightRotation(from: Vector3D, target: Vector3D = v(0, 0.6, 0)): Vector3D {
  const dir = new THREE.Vector3(target.x - from.x, target.y - from.y, target.z - from.z);
  if (dir.lengthSq() < 1e-8) return v(-0.8, 0.4, 0);
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { x: e.x, y: e.y, z: e.z };
}

/** High-contrast Key / cool Fill / warm Rim for cinematic cutscenes. */
export function createDramaticThreePointLights(): CADLight[] {
  const keyPos = v(5.5, 7.5, 4.5);
  const key = createCADLight('directional', 'Key Light', keyPos);
  key.color = '#ffd7b0';
  key.intensity = 4.2;
  key.castShadow = true;
  key.rotation = aimLightRotation(keyPos, v(0, 0.5, 0));

  const fillPos = v(-4.5, 2.8, 3.2);
  const fill = createCADLight('point', 'Fill Light', fillPos);
  fill.color = '#8ea8ff';
  fill.intensity = 0.28;
  fill.distance = 16;
  fill.castShadow = false;

  const rimPos = v(-3.2, 5.5, -5.5);
  const rim = createCADLight('directional', 'Rim Light', rimPos);
  rim.color = '#ffc4a0';
  rim.intensity = 2.4;
  rim.castShadow = false;
  rim.rotation = aimLightRotation(rimPos, v(0, 1, 0));

  return [key, fill, rim];
}

function configureShadow(light: THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight) {
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.00015;
  light.shadow.normalBias = 0.03;
  if (light instanceof THREE.DirectionalLight) {
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 60;
    light.shadow.camera.left = -10;
    light.shadow.camera.right = 10;
    light.shadow.camera.top = 10;
    light.shadow.camera.bottom = -10;
    light.shadow.radius = 2;
  }
  if (light instanceof THREE.SpotLight) {
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = Math.max(4, light.distance || 40);
  }
}

export function areaSizeFromLight(L: CADLight): { width: number; height: number } {
  return {
    width: Math.max(0.1, L.width ?? L.scale.x * 2),
    height: Math.max(0.1, L.height ?? L.scale.y * 2),
  };
}

/** Build a Three.js light matching a CADLight authoring object. */
export function createThreeLightFromCad(L: CADLight): THREE.Light {
  ensureAreaLightSupport();
  let light: THREE.Light;
  if (L.type === 'ambient') {
    light = new THREE.AmbientLight(L.color, L.intensity);
  } else if (L.type === 'directional') {
    const d = new THREE.DirectionalLight(L.color, L.intensity);
    d.castShadow = L.castShadow !== false;
    configureShadow(d);
    light = d;
  } else if (L.type === 'spot') {
    const s = new THREE.SpotLight(
      L.color,
      L.intensity,
      L.distance,
      L.angle,
      L.penumbra,
      L.decay ?? 2,
    );
    s.castShadow = L.castShadow !== false;
    configureShadow(s);
    light = s;
  } else if (L.type === 'area') {
    const { width, height } = areaSizeFromLight(L);
    light = new THREE.RectAreaLight(L.color, L.intensity, width, height);
  } else {
    const p = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay ?? 2);
    p.castShadow = L.castShadow !== false;
    configureShadow(p);
    light = p;
  }
  light.userData = { lightType: L.type, animTarget: 'light', targetId: L.id };
  return light;
}

/** Sync mutable light props + pose onto an existing Three light / helper. */
export function syncThreeLightFromCad(
  light: THREE.Light,
  helper: THREE.Object3D,
  L: CADLight,
  scene: THREE.Scene,
  skipPose: boolean,
) {
  light.intensity = L.intensity;
  if ('color' in light && (light as THREE.Light & { color?: THREE.Color }).color) {
    (light as THREE.DirectionalLight).color.set(L.color);
  }

  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    light.distance = L.distance;
    light.decay = L.decay ?? 2;
    light.castShadow = L.castShadow !== false;
  }
  if (light instanceof THREE.SpotLight) {
    light.angle = L.angle;
    light.penumbra = L.penumbra;
  }
  if (light instanceof THREE.DirectionalLight) {
    light.castShadow = L.castShadow !== false;
  }
  if (light instanceof THREE.RectAreaLight) {
    const { width, height } = areaSizeFromLight(L);
    light.width = width;
    light.height = height;
  }

  if (!skipPose) {
    light.position.set(L.position.x, L.position.y, L.position.z);
    helper.position.copy(light.position);
    helper.rotation.set(L.rotation.x, L.rotation.y, L.rotation.z);
    helper.scale.set(L.scale.x, L.scale.y, L.scale.z);

    if (light instanceof THREE.RectAreaLight) {
      light.rotation.set(L.rotation.x, L.rotation.y, L.rotation.z);
    } else if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
      const dir = new THREE.Vector3(0, -1, 0).applyEuler(
        new THREE.Euler(L.rotation.x, L.rotation.y, L.rotation.z),
      );
      light.target.position.copy(light.position).add(dir);
      light.target.updateMatrixWorld();
      if (!light.target.parent) scene.add(light.target);
    }
  }
}

/** Cheap live property updates during slider drag — no pose rewrite. */
export function applyLiveLightProps(light: THREE.Light, partial: Partial<CADLight>) {
  if (partial.intensity != null) light.intensity = partial.intensity;
  if (partial.color != null && 'color' in light && (light as THREE.DirectionalLight).color) {
    (light as THREE.DirectionalLight).color.set(partial.color);
  }
  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    if (partial.distance != null) light.distance = partial.distance;
    if (partial.decay != null) light.decay = partial.decay;
  }
  if (light instanceof THREE.SpotLight) {
    if (partial.angle != null) light.angle = partial.angle;
    if (partial.penumbra != null) light.penumbra = partial.penumbra;
  }
  if (light instanceof THREE.RectAreaLight) {
    if (partial.width != null) light.width = Math.max(0.1, partial.width);
    if (partial.height != null) light.height = Math.max(0.1, partial.height);
    if (partial.scale) {
      light.width = Math.max(0.1, (partial.width ?? partial.scale.x * 2));
      light.height = Math.max(0.1, (partial.height ?? partial.scale.y * 2));
    }
  }
  if (partial.castShadow != null) {
    if (
      light instanceof THREE.DirectionalLight
      || light instanceof THREE.SpotLight
      || light instanceof THREE.PointLight
    ) {
      light.castShadow = partial.castShadow;
    }
  }
}

/** Build a selectable viewport gizmo for a CAD light. */
export function createCadLightHelper(L: CADLight, selected: boolean): THREE.Group {
  const helper = new THREE.Group();
  const color = new THREE.Color(selected ? '#ed7300' : L.color || '#fff5e6');
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });

  if (L.type === 'directional') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), mat);
    cone.rotation.x = Math.PI;
    helper.add(cone);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: selected ? 0xed7300 : 0xff9a3c, depthTest: false }),
    );
    shaft.position.y = -0.35;
    helper.add(shaft);
  } else if (L.type === 'spot') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 10), mat);
    cone.rotation.x = Math.PI;
    helper.add(cone);
    const reach = Math.min(4, Math.max(0.6, L.distance * 0.15));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, Math.max(0.12, Math.tan(L.angle) * reach * 0.35), 16),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -reach * 0.5;
    helper.add(ring);
  } else if (L.type === 'ambient') {
    helper.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat));
  } else if (L.type === 'area') {
    const { width, height } = areaSizeFromLight(L);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(2.5, width * 0.35), Math.min(2.5, height * 0.35)),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.75,
      }),
    );
    helper.add(plane);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(Math.min(2.5, width * 0.35), Math.min(2.5, height * 0.35))),
      new THREE.LineBasicMaterial({ color: selected ? 0xed7300 : 0xff9a3c }),
    );
    helper.add(frame);
  } else {
    helper.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat));
    if (L.distance > 0) {
      const radius = Math.min(2.2, Math.max(0.35, L.distance * 0.08));
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.92, radius, 24),
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: false,
          transparent: true,
          opacity: 0.35,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      helper.add(ring);
    }
  }

  helper.traverse((obj) => {
    obj.userData = { animTarget: 'light', targetId: L.id, sceneKind: 'light' };
  });
  helper.userData = { animTarget: 'light', targetId: L.id, sceneKind: 'light', lightType: L.type };
  helper.renderOrder = 22;
  return helper;
}

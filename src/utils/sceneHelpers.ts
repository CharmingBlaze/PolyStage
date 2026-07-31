import * as THREE from 'three';
import type { CADCamera, CADLight, EnvironmentSettings, ParticleEmitter, SceneObjectKind, Vector3D } from '../types/cad';
import { VIEWPORT_THEME } from './viewportTheme';

const v3 = (v: Vector3D) => new THREE.Vector3(v.x, v.y, v.z);

export function setObjectPRS(
  obj: THREE.Object3D,
  position: Vector3D,
  rotation: Vector3D,
  scale?: Vector3D,
) {
  obj.position.set(position.x, position.y, position.z);
  obj.rotation.set(rotation.x, rotation.y, rotation.z);
  if (scale) obj.scale.set(scale.x, scale.y, scale.z);
  else obj.scale.set(1, 1, 1);
}

export function readObjectPRS(obj: THREE.Object3D) {
  return {
    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
  };
}

function tag(obj: THREE.Object3D, kind: SceneObjectKind, id: string) {
  obj.userData = { ...obj.userData, sceneKind: kind, sceneId: id, animTarget: kind, targetId: id };
  obj.traverse((child) => {
    child.userData = { ...child.userData, sceneKind: kind, sceneId: id, animTarget: kind, targetId: id };
  });
}

export function createCameraHelper(cam: CADCamera, selected: boolean): THREE.Group {
  const helper = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.2, 0.38),
    new THREE.MeshBasicMaterial({
      color: selected ? VIEWPORT_THEME.cameraSelected : VIEWPORT_THEME.cameraIdle,
      depthTest: false,
    }),
  );
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, 0.14, 10),
    new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.24;
  helper.add(body, lens);
  setObjectPRS(helper, cam.position, cam.rotation);
  helper.visible = cam.visible !== false;
  tag(helper, 'camera', cam.id);
  return helper;
}

export function createLightHelper(light: CADLight, selected: boolean): THREE.Group {
  const helper = new THREE.Group();
  const color = new THREE.Color(light.color || '#fff5e6');
  const mat = new THREE.MeshBasicMaterial({
    color: selected ? VIEWPORT_THEME.lightSelected : color.getHex(),
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  let mesh: THREE.Mesh;
  if (light.type === 'directional') {
    mesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), mat);
    mesh.rotation.x = Math.PI;
  } else if (light.type === 'spot') {
    mesh = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 10), mat);
    mesh.rotation.x = Math.PI;
  } else if (light.type === 'ambient') {
    mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat);
  } else if (light.type === 'area') {
    const w = Math.min(1.4, Math.max(0.25, (light.width ?? light.scale.x * 2) * 0.35));
    const h = Math.min(1.4, Math.max(0.25, (light.height ?? light.scale.y * 2) * 0.35));
    mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: selected ? VIEWPORT_THEME.lightSelected : color.getHex(),
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
  } else {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat);
  }
  helper.add(mesh);
  if (light.type === 'directional' || light.type === 'spot') {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6),
      new THREE.MeshBasicMaterial({
        color: selected ? VIEWPORT_THEME.lightSelected : VIEWPORT_THEME.lightShaft,
        depthTest: false,
      }),
    );
    shaft.position.y = -0.35;
    helper.add(shaft);
  }
  setObjectPRS(helper, light.position, light.rotation, light.scale);
  helper.visible = light.visible !== false;
  tag(helper, 'light', light.id);
  return helper;
}

export function createParticleHelper(p: ParticleEmitter, selected: boolean): THREE.Group {
  const helper = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18),
    new THREE.MeshBasicMaterial({
      color: selected ? VIEWPORT_THEME.particleSelected : VIEWPORT_THEME.particleIdle,
      depthTest: false,
      wireframe: true,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.02, 6, 16),
    new THREE.MeshBasicMaterial({
      color: selected ? VIEWPORT_THEME.particleSelected : VIEWPORT_THEME.accentSoft,
      depthTest: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  helper.add(core, ring);
  const scl = p.scale || { x: 1, y: 1, z: 1 };
  setObjectPRS(helper, p.position, p.rotation, scl);
  helper.visible = p.enabled !== false;
  tag(helper, 'particle', p.id);
  return helper;
}

export function createWeatherHelper(env: EnvironmentSettings, selected: boolean): THREE.Group {
  const helper = new THREE.Group();
  const cloud = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 8),
    new THREE.MeshBasicMaterial({
      color: selected ? VIEWPORT_THEME.warning : 0x8aa0b8,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    }),
  );
  const drop = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.2, 6),
    new THREE.MeshBasicMaterial({
      color: selected ? VIEWPORT_THEME.accent : 0x6ec8ff,
      depthTest: false,
    }),
  );
  drop.position.y = -0.35;
  drop.rotation.x = Math.PI;
  helper.add(cloud, drop);
  const pos = env.position || { x: 0, y: 2, z: 0 };
  const rot = env.rotation || { x: 0, y: 0, z: 0 };
  const scl = env.scale || { x: 1, y: 1, z: 1 };
  setObjectPRS(helper, pos, rot, scl);
  helper.visible = env.visible === true;
  tag(helper, 'weather', 'environment');
  return helper;
}

export function disposeObject3D(root: THREE.Object3D, opts?: { disposeTextures?: boolean }) {
  root.traverse((obj) => {
    const anyObj = obj as THREE.Mesh;
    anyObj.geometry?.dispose?.();
    const mat = anyObj.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    mats.forEach((m) => {
      if (opts?.disposeTextures && m) {
        const std = m as THREE.MeshStandardMaterial;
        const maps = [
          std.map,
          std.normalMap,
          std.roughnessMap,
          std.metalnessMap,
          std.emissiveMap,
          std.aoMap,
          (std as unknown as { alphaMap?: THREE.Texture }).alphaMap,
        ];
        maps.forEach((tex) => tex?.dispose?.());
      }
      m.dispose();
    });
  });
}

/** Remove and dispose every child of a group (geometry + materials; keep shared textures). */
export function clearAndDisposeGroup(group: THREE.Object3D | null | undefined) {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject3D(child);
  }
}

/** Map light gizmo scale → distance for point/spot falloff feedback. */
export function lightDistanceFromScale(scale: Vector3D, type: CADLight['type']) {
  if (type === 'area') return 0;
  if (type !== 'point' && type !== 'spot') return 0;
  return Math.max(0.5, ((scale.x + scale.y + scale.z) / 3) * 8);
}

export function particleShapeSizeFromScale(base: Vector3D, scale: Vector3D): Vector3D {
  return {
    x: Math.max(0.05, base.x * scale.x),
    y: Math.max(0.05, base.y * scale.y),
    z: Math.max(0.05, base.z * scale.z),
  };
}

export { v3 };

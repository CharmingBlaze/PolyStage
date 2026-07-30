import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { AnimationClip as CADAnimClip, CADBone, CADMesh, Vector3D } from '../types/cad';
import { getBoneWorldMatrices } from './rigging';
import { sampleChannel } from './animation';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildTriangulatedBuffers(mesh: CADMesh) {
  const vertIndex = new Map(mesh.vertices.map((v, i) => [v.id, i]));
  const positions: number[] = [];
  mesh.vertices.forEach((v) => positions.push(v.x, v.y, v.z));

  const indices: number[] = [];
  mesh.faces.forEach((face) => {
    if (face.vertexIds.length < 3) return;
    const i0 = vertIndex.get(face.vertexIds[0]);
    if (i0 == null) return;
    for (let i = 1; i < face.vertexIds.length - 1; i += 1) {
      const i1 = vertIndex.get(face.vertexIds[i]);
      const i2 = vertIndex.get(face.vertexIds[i + 1]);
      if (i1 == null || i2 == null) continue;
      indices.push(i0, i1, i2);
    }
  });

  return { positions, indices, vertIndex };
}

function buildSkinAttributes(mesh: CADMesh, boneIndexById: Map<string, number>, vertCount: number) {
  const skinIndex = new Uint16Array(vertCount * 4);
  const skinWeight = new Float32Array(vertCount * 4);

  mesh.vertices.forEach((vertex, vi) => {
    const influences = (mesh.skinWeights?.[vertex.id] || []).slice(0, 4);
    let total = influences.reduce((s, inf) => s + inf.weight, 0);
    if (total <= 0 && mesh.boneId && boneIndexById.has(mesh.boneId)) {
      skinIndex[vi * 4] = boneIndexById.get(mesh.boneId)!;
      skinWeight[vi * 4] = 1;
      return;
    }
    if (total <= 0) {
      skinWeight[vi * 4] = 1;
      return;
    }
    influences.forEach((inf, slot) => {
      skinIndex[vi * 4 + slot] = boneIndexById.get(inf.boneId) ?? 0;
      skinWeight[vi * 4 + slot] = inf.weight / total;
    });
  });

  return { skinIndex, skinWeight };
}

function toThreeBones(bones: CADBone[]): {
  root: THREE.Group;
  threeBones: THREE.Bone[];
  boneIndexById: Map<string, number>;
  boneById: Map<string, THREE.Bone>;
} {
  const root = new THREE.Group();
  root.name = 'Armature';
  const boneById = new Map<string, THREE.Bone>();
  const boneIndexById = new Map<string, number>();
  const threeBones: THREE.Bone[] = [];

  // Create bones in any order first
  bones.forEach((bone, index) => {
    const tb = new THREE.Bone();
    tb.name = bone.name;
    boneById.set(bone.id, tb);
    boneIndexById.set(bone.id, index);
    threeBones.push(tb);
  });

  // Parent using rest transforms as bind pose locals
  bones.forEach((bone) => {
    const tb = boneById.get(bone.id)!;
    const pos = bone.restPosition || bone.position;
    const rot = bone.restRotation || bone.rotation;
    const scl = bone.restScale || bone.scale;
    tb.position.set(pos.x, pos.y, pos.z);
    tb.rotation.set(rot.x, rot.y, rot.z);
    tb.scale.set(scl.x, scl.y, scl.z);
    if (bone.parentId && boneById.has(bone.parentId)) {
      boneById.get(bone.parentId)!.add(tb);
    } else {
      root.add(tb);
    }
  });

  return { root, threeBones, boneIndexById, boneById };
}

function vecKeysToTypedTimesValues(keyframes: { time: number; value: Vector3D }[]) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const times: number[] = [];
  const values: number[] = [];
  sorted.forEach((kf) => {
    times.push(kf.time);
    values.push(kf.value.x, kf.value.y, kf.value.z);
  });
  return { times, values };
}

function eulerKeysToQuatTrack(keyframes: { time: number; value: Vector3D }[]) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const times: number[] = [];
  const values: number[] = [];
  sorted.forEach((kf) => {
    times.push(kf.time);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(kf.value.x, kf.value.y, kf.value.z),
    );
    values.push(q.x, q.y, q.z, q.w);
  });
  return { times, values };
}

function clipToThreeAnimation(
  clip: CADAnimClip,
  boneById: Map<string, THREE.Bone>,
  meshNodes: Map<string, THREE.Object3D>,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  clip.tracks.forEach((track) => {
    const target =
      track.targetType === 'bone' ? boneById.get(track.targetId) : meshNodes.get(track.targetId);
    if (!target) return;
    const path = target.name;

    if (track.posKeyframes.length) {
      const { times, values } = vecKeysToTypedTimesValues(track.posKeyframes);
      tracks.push(new THREE.VectorKeyframeTrack(`${path}.position`, times, values));
    }
    if (track.rotKeyframes.length) {
      const { times, values } = eulerKeysToQuatTrack(track.rotKeyframes);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${path}.quaternion`, times, values));
    }
    if (track.sclKeyframes.length) {
      const { times, values } = vecKeysToTypedTimesValues(track.sclKeyframes);
      tracks.push(new THREE.VectorKeyframeTrack(`${path}.scale`, times, values));
    }
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Build a Three.js scene with skeleton + skinned meshes + animation clips, export as GLB.
 */
export async function exportSceneToGLB(
  meshes: CADMesh[],
  bones: CADBone[],
  clips: CADAnimClip[] = [],
  filename = 'character.glb',
): Promise<void> {
  const scene = new THREE.Scene();
  scene.name = 'Scene';

  const { root, threeBones, boneIndexById, boneById } = toThreeBones(bones);
  scene.add(root);

  // Bind skeleton at rest pose
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(threeBones);

  const meshNodes = new Map<string, THREE.Object3D>();

  meshes.forEach((mesh) => {
    if (mesh.visible === false) return;
    const { positions, indices } = buildTriangulatedBuffers(mesh);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const hasSkin = Boolean(mesh.skinWeights) || Boolean(mesh.boneId);
    let object: THREE.Object3D;

    if (hasSkin && threeBones.length) {
      const { skinIndex, skinWeight } = buildSkinAttributes(mesh, boneIndexById, mesh.vertices.length);
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.name = mesh.name;
      skinned.bind(skeleton);
      skinned.position.set(0, 0, 0);
      scene.add(skinned);
      object = skinned;
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.name = mesh.name;
      meshObj.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      meshObj.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
      meshObj.scale.set(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      scene.add(meshObj);
      object = meshObj;
    }

    meshNodes.set(mesh.id, object);
  });

  // Armature stays on scene root
  if (!scene.children.includes(root)) scene.add(root);

  const animations = clips
    .filter((c) => c.tracks.length > 0)
    .map((c) => clipToThreeAnimation(c, boneById, meshNodes));

  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        if (gltf instanceof ArrayBuffer) resolve(gltf);
        else reject(new Error('Expected binary GLB ArrayBuffer'));
      },
      (error) => reject(error),
      {
        binary: true,
        animations,
        onlyVisible: true,
      },
    );
  });

  downloadBlob(filename, new Blob([result], { type: 'model/gltf-binary' }));
}

/** Synchronous smoke helper: builds export scene graph without downloading. */
export function buildExportSceneGraph(
  meshes: CADMesh[],
  bones: CADBone[],
  clips: CADAnimClip[] = [],
): { scene: THREE.Scene; animations: THREE.AnimationClip[]; boneCount: number } {
  const scene = new THREE.Scene();
  const { root, threeBones, boneIndexById, boneById } = toThreeBones(bones);
  scene.add(root);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(threeBones);
  const meshNodes = new Map<string, THREE.Object3D>();

  meshes.forEach((mesh) => {
    const { positions, indices } = buildTriangulatedBuffers(mesh);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    if (mesh.skinWeights && threeBones.length) {
      const { skinIndex, skinWeight } = buildSkinAttributes(mesh, boneIndexById, mesh.vertices.length);
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
      skinned.name = mesh.name;
      skinned.bind(skeleton);
      scene.add(skinned);
      meshNodes.set(mesh.id, skinned);
    } else {
      const meshObj = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      meshObj.name = mesh.name;
      scene.add(meshObj);
      meshNodes.set(mesh.id, meshObj);
    }
  });

  const animations = clips
    .filter((c) => c.tracks.length > 0)
    .map((c) => clipToThreeAnimation(c, boneById, meshNodes));

  return { scene, animations, boneCount: threeBones.length };
}

/** Sample helper used by tests — ensure animation module is wired. */
export function sampleClipBonePosition(
  clip: CADAnimClip,
  boneId: string,
  time: number,
  fallback: Vector3D,
): Vector3D {
  const track = clip.tracks.find((t) => t.targetId === boneId && t.targetType === 'bone');
  if (!track) return fallback;
  return sampleChannel(track.posKeyframes, time, clip.interpolation || 'linear') || fallback;
}

/** Expose rest matrices for tests / debugging. */
export function getRestWorldMatrices(bones: CADBone[]) {
  return getBoneWorldMatrices(bones, true);
}

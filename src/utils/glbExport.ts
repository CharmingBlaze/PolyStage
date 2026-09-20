import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { AnimationClip as CADAnimClip, CADBone, CADMesh, MaterialAsset, Vector3D } from '../types/cad';
import { getBoneWorldMatrices } from './rigging';
import { sampleChannel } from './animation';
import { albedoDataUrlForMesh, prepareMeshesForExport } from './exportPrepare';

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

function hexColor(color: string | undefined, fallback = 0xcccccc): number {
  if (!color) return fallback;
  const raw = color.startsWith('#') ? color.slice(1) : color;
  const n = Number.parseInt(raw, 16);
  return Number.isFinite(n) ? n : fallback;
}

/** Split-by-corner buffers so UV seams survive export and match 3D paint. */
export function buildTriangulatedBuffers(mesh: CADMesh) {
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sourceVertexIds: string[] = [];

  const pushCorner = (vertexId: string, uv: { u: number; v: number }) => {
    const v = vertMap.get(vertexId);
    if (!v) return -1;
    const index = sourceVertexIds.length;
    positions.push(v.x, v.y, v.z);
    uvs.push(uv.u, uv.v);
    sourceVertexIds.push(vertexId);
    return index;
  };

  mesh.faces.forEach((face) => {
    if (face.vertexIds.length < 3) return;
    const cornerIndex: number[] = [];
    for (let i = 0; i < face.vertexIds.length; i += 1) {
      const uv = face.uvs?.[i] || { u: 0, v: 0 };
      const idx = pushCorner(face.vertexIds[i], uv);
      if (idx < 0) return;
      cornerIndex.push(idx);
    }
    for (let i = 1; i < cornerIndex.length - 1; i += 1) {
      indices.push(cornerIndex[0], cornerIndex[i], cornerIndex[i + 1]);
    }
  });

  return { positions, uvs, indices, sourceVertexIds };
}

function buildSkinAttributes(
  mesh: CADMesh,
  sourceVertexIds: string[],
  boneIndexById: Map<string, number>,
) {
  const skinIndex = new Uint16Array(sourceVertexIds.length * 4);
  const skinWeight = new Float32Array(sourceVertexIds.length * 4);

  sourceVertexIds.forEach((vertexId, vi) => {
    const influences = (mesh.skinWeights?.[vertexId] || []).slice(0, 4);
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

  bones.forEach((bone, index) => {
    const tb = new THREE.Bone();
    tb.name = bone.name;
    boneById.set(bone.id, tb);
    boneIndexById.set(bone.id, index);
    threeBones.push(tb);
  });

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

function applyMeshTransform(object: THREE.Object3D, mesh: CADMesh) {
  object.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
  object.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
  object.scale.set(mesh.scale.x, mesh.scale.y, mesh.scale.z);
}

function makeMaterial(mesh: CADMesh, materials: MaterialAsset[], map?: THREE.Texture) {
  const asset = materials.find((item) => item.id === mesh.materialId);
  const color = map ? 0xffffff : hexColor(asset?.color);
  return new THREE.MeshStandardMaterial({
    color,
    map: map || null,
    roughness: asset?.roughness ?? 0.6,
    metalness: asset?.metalness ?? 0.1,
    emissive: new THREE.Color(hexColor(asset?.emissive, 0x000000)),
    emissiveIntensity: asset?.emissiveIntensity ?? 0,
    side: mesh.doubleSided === false && asset?.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
  });
}

async function textureFromDataUrl(dataUrl: string): Promise<THREE.Texture | null> {
  if (typeof Image === 'undefined') return null;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('texture decode failed'));
      img.src = dataUrl;
    });
    const tex = new THREE.Texture(image);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

export interface BuildExportOptions {
  materials?: MaterialAsset[];
  textures?: Map<string, THREE.Texture>;
  prepare?: boolean;
}

function populateExportScene(
  meshes: CADMesh[],
  bones: CADBone[],
  clips: CADAnimClip[],
  options: BuildExportOptions = {},
): { scene: THREE.Scene; animations: THREE.AnimationClip[]; boneCount: number } {
  const materials = options.materials || [];
  const scene = new THREE.Scene();
  scene.name = 'Scene';

  const { root, threeBones, boneIndexById, boneById } = toThreeBones(bones);
  scene.add(root);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(threeBones);
  const meshNodes = new Map<string, THREE.Object3D>();

  meshes.forEach((mesh) => {
    if (mesh.visible === false) return;
    const { positions, uvs, indices, sourceVertexIds } = buildTriangulatedBuffers(mesh);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const map = options.textures?.get(mesh.id);
    const material = makeMaterial(mesh, materials, map);
    const hasSkin = Boolean(mesh.skinWeights && Object.keys(mesh.skinWeights).length) || Boolean(mesh.boneId);
    let object: THREE.Object3D;

    if (hasSkin && threeBones.length) {
      const { skinIndex, skinWeight } = buildSkinAttributes(mesh, sourceVertexIds, boneIndexById);
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      const skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.name = mesh.name;
      skinned.bind(skeleton);
      applyMeshTransform(skinned, mesh);
      scene.add(skinned);
      object = skinned;
    } else {
      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.name = mesh.name;
      applyMeshTransform(meshObj, mesh);
      scene.add(meshObj);
      object = meshObj;
    }

    meshNodes.set(mesh.id, object);
  });

  const animations = clips
    .filter((c) => c.tracks.length > 0)
    .map((c) => clipToThreeAnimation(c, boneById, meshNodes));

  return { scene, animations, boneCount: threeBones.length };
}

/**
 * Build a Three.js scene with skeleton + skinned meshes + animation clips, export as GLB.
 */
export async function exportSceneToGLB(
  meshes: CADMesh[],
  bones: CADBone[],
  clips: CADAnimClip[] = [],
  filename = 'character.glb',
  materials: MaterialAsset[] = [],
): Promise<void> {
  const prepared = prepareMeshesForExport(meshes, bones, clips);
  const textures = new Map<string, THREE.Texture>();
  await Promise.all(
    prepared.meshes.map(async (mesh) => {
      const dataUrl = albedoDataUrlForMesh(mesh, materials);
      if (!dataUrl) return;
      const tex = await textureFromDataUrl(dataUrl);
      if (tex) textures.set(mesh.id, tex);
    }),
  );

  const { scene, animations } = populateExportScene(prepared.meshes, prepared.bones, prepared.clips, {
    materials,
    textures,
  });

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
  options: BuildExportOptions = {},
): { scene: THREE.Scene; animations: THREE.AnimationClip[]; boneCount: number } {
  const prepared = options.prepare === false
    ? { meshes, bones, clips }
    : prepareMeshesForExport(meshes, bones, clips);
  return populateExportScene(prepared.meshes, prepared.bones, prepared.clips, options);
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

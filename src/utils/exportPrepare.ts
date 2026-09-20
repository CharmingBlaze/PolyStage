import type { AnimationClip, CADBone, CADMesh, MaterialAsset } from '../types/cad';
import { bakeAnimationClip } from './animation';
import { autoFixMeshIntegrity } from './meshValidator';
import { ensureBindPose, sanitizeMeshSkinWeights } from './rigging';
import { ensurePaintableUVs } from './uvAdvanced';

export interface PreparedExport {
  meshes: CADMesh[];
  bones: CADBone[];
  clips: AnimationClip[];
}

export function prepareMeshesForExport(
  meshes: CADMesh[],
  bones: CADBone[],
  clips: AnimationClip[] = [],
): PreparedExport {
  const bindBones = ensureBindPose(bones);
  return {
    bones: bindBones,
    meshes: meshes
      .filter((mesh) => mesh.visible !== false)
      .map((mesh) => {
        const cleaned = autoFixMeshIntegrity(mesh);
        const unwrapped = ensurePaintableUVs(cleaned);
        return sanitizeMeshSkinWeights(unwrapped, bindBones);
      }),
    clips: clips
      .filter((clip) => clip.tracks.length > 0)
      .map((clip) => bakeAnimationClip(clip)),
  };
}

export function albedoDataUrlForMesh(mesh: CADMesh, materials: MaterialAsset[] = []): string | undefined {
  if (mesh.textureCanvasDataUrl) return mesh.textureCanvasDataUrl;
  const frame = mesh.textureAnimation?.frames?.[0]?.dataUrl;
  if (frame) return frame;
  const mat = materials.find((item) => item.id === mesh.materialId);
  if (mat?.textureDataUrl) return mat.textureDataUrl;
  return undefined;
}

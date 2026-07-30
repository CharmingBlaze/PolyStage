export { ensureBvhPatched, attachMeshBvh, disposeMeshGeometry } from './setup';
export {
  createBvhRaycaster,
  setRayFromPointer,
  broadphaseMeshes,
  pickMeshes,
  pickClosestMesh,
  pickLogicalFace,
  pickPaintUv,
  samplePaintStrokeUvs,
} from './picking';
export type { BvhPaintHit, BvhFaceHit, BvhMeshHit } from './picking';

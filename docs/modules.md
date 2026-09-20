# Module Index

## Utility Modules

| Module | Path | Key Exports |
|--------|------|-------------|
| **sceneStore** | `src/store/useSceneStore.ts` | `useSceneStore` |
| **historyStore** | `src/store/useHistoryStore.ts` | `useHistoryStore` |
| **vectorStore** | `src/store/useVectorStore.ts` | `useVectorStore` |
| **cadTypes** | `src/types/cad.ts` | `CADMesh`, `ToolState`, `EditMode`, etc. |
| **sequenceTypes** | `src/types/sequence.ts` | `CutsceneSequence`, timeline types |
| **meshUtils** | `src/utils/meshUtils.ts` | `buildThreeGeometry`, `generatePrimitive`, `generateId` |
| **meshOperators** | `src/utils/meshOperators.ts` | `resolveOperatorTargets`, `beginEdgeExtrude`, `beginVertexExtrude`, `beginVertexBevel`, `subdivideTargets`, `fillTargets`, `mirrorTargets` |
| **meshCutTools** | `src/utils/meshCutTools.ts` | `findEdgeLoop`, `KnifeHit`, `loopCutFactors` |
| **modalMeshOps** | `src/utils/modalMeshOps.ts` | `beginModalMeshOp`, `ModalMeshSession` |
| **mirrorModeling** | `src/utils/mirrorModeling.ts` | `applyMirrorSymmetry`, mirror modifiers |
| **subdivision** | `src/utils/subdivision.ts` | `catmullClarkSubdivide` |
| **selection** | `src/utils/selection.ts` | `selectionCounts`, selection helpers |
| **rigging** | `src/utils/rigging.ts` | `deformMeshWithBones`, `paintVertexWeight`, `boneTailOffset`, `getBoneDepths`, `pruneBoneReferences`, `validateRig` |
| **ik** | `src/utils/ik.ts` | `solveCcdIk` (tip-tail effector, 1..N chain), `evaluateConstraints` (with influence) |
| **paint3dSurface** | `src/utils/paint3dSurface.ts` | `paint3dBridge`, 3D painting |
| **pixelPaint** | `src/utils/pixelPaint.ts` | 2D pixel painting ops |
| **paintStroke** | `src/utils/paintStroke.ts` | Paint stroke logic |
| **uvUnwrapUtils** | `src/utils/uvUnwrapUtils.ts` | UV projection |
| **uvAdvanced** | `src/utils/uvAdvanced.ts` | UV packing, layout |
| **uvTopology** | `src/utils/uvTopology.ts` | UV seam/island queries |
| **vectorBlockout** | `src/utils/vectorBlockout.ts` | `vectorPathsToMesh`, blockout pipeline |
| **studioLighting** | `src/utils/studioLighting.ts` | `createStudioLightRig`, `StudioLightRig`, shadow camera helper |
| **shadowQuality** | `src/utils/shadowQuality.ts` | `SHADOW_QUALITY`, `configureShadow`, `fitShadowCameraToScene`, `resolveShadowMapType`, [docs/shadow-system.md](shadow-system.md) |
| **viewportRenderer** | `src/utils/viewportRenderer.ts` | `createViewportRenderer`, `applyRendererConfig` (PCFSoftShadowMap default) |
| **viewportTheme** | `src/utils/viewportTheme.ts` | `VIEWPORT_THEME`, gizmo colors |
| **viewportNav** | `src/utils/viewportNav.ts` | Orbit control bindings |
| **sceneHelpers** | `src/utils/sceneHelpers.ts` | `createCameraHelper`, `createLightHelper` |
| **importers** | `src/utils/importers.ts` | `import3DModelFromFile` |
| **exporters** | `src/utils/exporters.ts` | Format exporters |
| **glbExport** | `src/utils/glbExport.ts` | `exportSceneToGLB` |
| **cutsceneEnv** | `src/utils/cutsceneEnv.ts` | Weather, environment presets |
| **cutsceneLights** | `src/utils/cutsceneLights.ts` | `createDramaticThreePointLights` |
| **sequence** | `src/utils/sequence.ts` | Timeline/sequence runtime |
| **animation** | `src/utils/animation.ts` | Keyframe interpolation |
| **textureAnimation** | `src/utils/textureAnimation.ts` | Animated texture clips |
| **particles** | `src/utils/particles.ts` | Particle emitter |
| **bvh** | `src/utils/bvh/` | BVH picking, raycasting |
| **topology** | `src/utils/topology/` | Edge overlays, triangulation, validation |
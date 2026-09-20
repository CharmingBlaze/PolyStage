import { APP_NAME, PROJECT_EXT } from '../brand';
import type { CADScene } from '../types/cad';
import {
  useVectorStore,
  type VectorPart,
  type VectorPointEditMode,
  type VectorRefImage,
  type VectorRefPlaneId,
} from '../store/useVectorStore';
import type { VectorCapStyle } from './vectorBlockout';
import { finalizeEditableMesh } from './topology/validate';
import { createEdgesFromFaces } from './meshUtils';

export const PROJECT_FORMAT = 'polystage-project' as const;
export const PROJECT_FORMAT_VERSION = 3;

export interface VectorProjectState {
  parts: VectorPart[];
  activePartId: string;
  pathStyle: 'polygon' | 'curve';
  mirrorWidth: boolean;
  pointEditMode: VectorPointEditMode;
  snap: boolean;
  snapSize: number;
  verticalSegments: number;
  radialSegments: number;
  thickness: number;
  capStyle: VectorCapStyle;
  roundness: number;
  refImages: Partial<Record<VectorRefPlaneId, VectorRefImage | null>>;
  builtRevision: number | null;
}

export interface PolyStageProject {
  version: number;
  format: typeof PROJECT_FORMAT;
  app: string;
  savedAt: string;
  activeSceneId: string;
  scenes: CADScene[];
  vector?: VectorProjectState;
}

export interface ProjectParseResult {
  project: PolyStageProject;
  legacy: boolean;
}

export function captureVectorProjectState(): VectorProjectState {
  const s = useVectorStore.getState();
  return {
    parts: s.parts,
    activePartId: s.activePartId,
    pathStyle: s.pathStyle,
    mirrorWidth: s.mirrorWidth,
    pointEditMode: s.pointEditMode,
    snap: s.snap,
    snapSize: s.snapSize,
    verticalSegments: s.verticalSegments,
    radialSegments: s.radialSegments,
    thickness: s.thickness,
    capStyle: s.capStyle,
    roundness: s.roundness,
    refImages: s.refImages,
    builtRevision: s.builtRevision,
  };
}

export function applyVectorProjectState(doc: VectorProjectState | undefined) {
  if (!doc?.parts?.length) return;
  const s = useVectorStore.getState();
  s.loadParts(doc.parts, doc.activePartId);
  s.setPathStyle(doc.pathStyle);
  s.setMirrorWidth(doc.mirrorWidth);
  s.setPointEditMode(doc.pointEditMode);
  s.setSnap(doc.snap);
  s.setSnapSize(doc.snapSize);
  s.setSegments(doc.verticalSegments, doc.radialSegments);
  s.setThickness(doc.thickness);
  s.setCapStyle(doc.capStyle);
  s.setRoundness(doc.roundness);
  (['front', 'side'] as VectorRefPlaneId[]).forEach((plane) => {
    const image = doc.refImages?.[plane] ?? null;
    s.setRefImage(plane, image);
  });
  if (typeof doc.builtRevision === 'number') s.markBuilt();
}

function finalizeScene(scene: CADScene): CADScene {
  return {
    ...scene,
    meshes: (scene.meshes || [])
      .filter((m) => m && Array.isArray(m.vertices) && Array.isArray(m.faces))
      .map((m) =>
        finalizeEditableMesh({
          ...m,
          edges: m.edges?.length ? m.edges : createEdgesFromFaces(m.faces),
        }),
      ),
    groups: scene.groups || [],
    bones: scene.bones || [],
    clips: scene.clips || [],
    cameras: scene.cameras || [],
    lights: scene.lights || [],
    particles: scene.particles || [],
    materials: scene.materials || [],
  };
}

export function buildProjectDocument(input: {
  scenes: CADScene[];
  activeSceneId: string;
  vector?: VectorProjectState;
  savedAt?: string;
}): PolyStageProject {
  return {
    version: PROJECT_FORMAT_VERSION,
    format: PROJECT_FORMAT,
    app: APP_NAME,
    savedAt: input.savedAt || new Date().toISOString(),
    activeSceneId: input.activeSceneId,
    scenes: input.scenes,
    vector: input.vector,
  };
}

export function serializeProject(project: PolyStageProject): string {
  return JSON.stringify(project);
}

function isProjectDocument(parsed: Record<string, unknown>): boolean {
  return parsed.format === PROJECT_FORMAT && Array.isArray(parsed.scenes);
}

function wrapMeshesAsProject(meshes: CADScene['meshes'], name = 'Imported'): PolyStageProject {
  const scene: CADScene = {
    id: 'scene_main',
    name,
    meshes,
    groups: [],
    bones: [],
  };
  return buildProjectDocument({
    scenes: [finalizeScene(scene)],
    activeSceneId: scene.id,
  });
}

export function parseProjectDocument(jsonStr: string): ProjectParseResult {
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  if (isProjectDocument(parsed)) {
    const project = parsed as unknown as PolyStageProject;
    return {
      project: {
        ...project,
        scenes: project.scenes.map(finalizeScene),
        vector: project.vector,
      },
      legacy: project.version < PROJECT_FORMAT_VERSION,
    };
  }

  if (parsed.mesh && typeof parsed.mesh === 'object') {
    const mesh = parsed.mesh as CADScene['meshes'][number];
    return { project: wrapMeshesAsProject([mesh], mesh.name || 'Imported'), legacy: true };
  }

  if (Array.isArray(parsed.meshes) && parsed.meshes.length) {
    return {
      project: wrapMeshesAsProject(parsed.meshes as CADScene['meshes']),
      legacy: true,
    };
  }

  if (parsed.polystage_mesh && typeof parsed.polystage_mesh === 'object') {
    const mesh = parsed.polystage_mesh as CADScene['meshes'][number];
    return { project: wrapMeshesAsProject([mesh], mesh.name || 'Imported'), legacy: true };
  }

  throw new Error(`Not a ${PROJECT_EXT} project file`);
}

export function suggestedProjectFilename(sceneName: string): string {
  const slug = (sceneName || 'project').toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'project';
  return `${slug}${PROJECT_EXT}`;
}

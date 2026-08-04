import { create } from 'zustand';
import type { CADMesh, CADBone, EditMode } from '../types/cad';

export interface SceneStoreState {
  meshes: CADMesh[];
  bones: CADBone[];
  selectedMeshId: string | null;
  selectedMeshIds: string[];
  activeMeshId: string | null;
  selectedBoneId: string | null;
  selectedVertexIds: string[];
  selectedEdgeIds: string[];
  selectedFaceIds: string[];
  editMode: EditMode;

  // Actions
  setMeshes: (meshes: CADMesh[] | ((prev: CADMesh[]) => CADMesh[])) => void;
  setBones: (bones: CADBone[] | ((prev: CADBone[]) => CADBone[])) => void;
  setSelectedMeshId: (id: string | null) => void;
  setSelectedMeshIds: (ids: string[]) => void;
  setActiveMeshId: (id: string | null) => void;
  setSelectedBoneId: (id: string | null) => void;
  setSelectedVertexIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setSelectedFaceIds: (ids: string[]) => void;
  setEditMode: (mode: EditMode) => void;
  updateActiveMesh: (updater: (mesh: CADMesh) => CADMesh) => void;
  clearSelection: () => void;
}

export const useSceneStore = create<SceneStoreState>((set, get) => ({
  meshes: [],
  bones: [],
  selectedMeshId: null,
  selectedMeshIds: [],
  activeMeshId: null,
  selectedBoneId: null,
  selectedVertexIds: [],
  selectedEdgeIds: [],
  selectedFaceIds: [],
  editMode: 'object',

  setMeshes: (meshes) =>
    set((state) => ({
      meshes: typeof meshes === 'function' ? meshes(state.meshes) : meshes,
    })),

  setBones: (bones) =>
    set((state) => ({
      bones: typeof bones === 'function' ? bones(state.bones) : bones,
    })),

  setSelectedMeshId: (id) =>
    set({
      selectedMeshId: id,
      activeMeshId: id,
      selectedMeshIds: id ? [id] : [],
    }),

  setSelectedMeshIds: (ids) =>
    set({
      selectedMeshIds: ids,
      selectedMeshId: ids[0] || null,
      activeMeshId: ids[0] || null,
    }),

  setActiveMeshId: (id) =>
    set({
      activeMeshId: id,
      selectedMeshId: id,
    }),

  setSelectedBoneId: (id) => set({ selectedBoneId: id }),
  setSelectedVertexIds: (ids) => set({ selectedVertexIds: ids }),
  setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),
  setSelectedFaceIds: (ids) => set({ selectedFaceIds: ids }),
  setEditMode: (mode) => set({ editMode: mode }),

  updateActiveMesh: (updater) => {
    const { activeMeshId, meshes } = get();
    if (!activeMeshId) return;
    set({
      meshes: meshes.map((m) => (m.id === activeMeshId ? updater(m) : m)),
    });
  },

  clearSelection: () =>
    set({
      selectedVertexIds: [],
      selectedEdgeIds: [],
      selectedFaceIds: [],
    }),
}));

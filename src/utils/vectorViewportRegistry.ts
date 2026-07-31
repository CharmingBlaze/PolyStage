import * as THREE from 'three';

export type VectorViewportKind = 'front' | 'side' | 'top' | 'perspective';

export type VectorViewportApi = {
  kind: VectorViewportKind;
  camera: THREE.Camera;
  container: HTMLElement;
};

const registry = new Map<VectorViewportKind, VectorViewportApi>();

export function registerVectorViewport(api: VectorViewportApi) {
  registry.set(api.kind, api);
}

export function unregisterVectorViewport(kind: VectorViewportKind) {
  registry.delete(kind);
}

export function getVectorViewport(kind: VectorViewportKind): VectorViewportApi | null {
  return registry.get(kind) ?? null;
}

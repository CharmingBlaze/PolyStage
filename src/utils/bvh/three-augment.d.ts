import * as THREE from 'three';

declare module 'three' {
  interface Raycaster {
    /** When true with three-mesh-bvh, use raycastFirst for faster picks/paint. */
    firstHitOnly?: boolean;
  }
}

export {};

import * as THREE from 'three';
import type { CADMesh } from '../types/cad';

export type VertexHandleState = 'idle' | 'selected' | 'hovered';

/**
 * Transform local coordinate of a CAD mesh to world space coordinates.
 */
export function localToWorld(mesh: CADMesh, x: number, y: number, z: number): THREE.Vector3 {
  const v = new THREE.Vector3(x, y, z);
  v.applyEuler(new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z));
  v.multiply(new THREE.Vector3(mesh.scale.x, mesh.scale.y, mesh.scale.z));
  v.add(new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z));
  return v;
}

// Global texture & material caches to avoid recreating objects on every frame
const textureCache = new Map<string, THREE.CanvasTexture>();
const materialCache = new Map<string, THREE.SpriteMaterial>();

/**
 * Generate a sharp, anti-aliased circular sprite texture with a crisp dark
 * border and subtle optical depth. Looks clean against any viewport background
 * (light or dark) or dense geometry.
 */
export function createVertexCircleTexture(
  fillColor: string,
  borderColor = 'rgba(15, 18, 24, 0.95)',
  centerHighlight = 'rgba(255, 255, 255, 0.35)',
  size = 64,
): THREE.CanvasTexture {
  const cacheKey = `${fillColor}_${borderColor}_${centerHighlight}_${size}`;
  const existing = textureCache.get(cacheKey);
  if (existing) return existing;

  // In Node.js / non-browser environments (e.g. unit tests without DOM canvas)
  if (typeof document === 'undefined') {
    const fallback = new THREE.CanvasTexture({} as HTMLCanvasElement);
    textureCache.set(cacheKey, fallback);
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const center = size / 2;
    const outerRadius = size * 0.44;

    ctx.clearRect(0, 0, size, size);

    // 1. Soft dark outer drop shadow / halo for contrast against white or bright materials
    ctx.beginPath();
    ctx.arc(center, center, outerRadius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    // 2. High-contrast solid dark boundary ring
    ctx.beginPath();
    ctx.arc(center, center, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = borderColor;
    ctx.fill();

    // 3. Vibrant inner circle fill
    const innerRadius = outerRadius * 0.72;
    ctx.beginPath();
    ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    // 4. Subtle directional top-left specular highlight for a refined lens feel
    if (centerHighlight) {
      ctx.beginPath();
      ctx.arc(center - innerRadius * 0.22, center - innerRadius * 0.22, innerRadius * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = centerHighlight;
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Get or create a cached SpriteMaterial for a given vertex state or custom color.
 */
export function getVertexSpriteMaterial(
  state: VertexHandleState,
  customColor?: string,
): THREE.SpriteMaterial {
  let fillColor = '#00b4c4';
  let borderColor = 'rgba(15, 18, 24, 0.95)';
  let highlight = 'rgba(255, 255, 255, 0.35)';
  let opacity = 0.95;

  if (customColor) {
    fillColor = customColor;
  } else if (state === 'selected') {
    fillColor = '#e6b422'; // TasteSkill Selection Gold
    highlight = 'rgba(255, 255, 220, 0.6)';
    opacity = 1.0;
  } else if (state === 'hovered') {
    fillColor = '#ffffff'; // High-contrast hover feedback
    borderColor = '#00b4c4';
    highlight = 'rgba(0, 180, 196, 0.8)';
    opacity = 1.0;
  } else {
    fillColor = '#00b4c4'; // TasteSkill primary Teal
    opacity = 0.92;
  }

  const cacheKey = `${state}_${fillColor}_${borderColor}_${opacity}`;
  const existing = materialCache.get(cacheKey);
  if (existing) return existing;

  const texture = createVertexCircleTexture(fillColor, borderColor, highlight);
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
    opacity,
  });

  materialCache.set(cacheKey, material);
  return material;
}

/**
 * Target screen size in CSS pixels for vertex handles.
 */
export function getTargetScreenPixels(state: VertexHandleState): number {
  switch (state) {
    case 'hovered':
      return 19;
    case 'selected':
      return 16.5;
    default:
      return 14.5;
  }
}

/**
 * Create a new vertex handle sprite.
 */
export function createVertexSprite(
  vertexId: string,
  meshId: string,
  worldPos: THREE.Vector3,
  state: VertexHandleState = 'idle',
  customColor?: string,
): THREE.Sprite {
  const material = getVertexSpriteMaterial(state, customColor);
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(worldPos);
  sprite.renderOrder = 45;
  sprite.userData = {
    vertexId,
    meshId,
    state,
    customColor,
    targetPx: getTargetScreenPixels(state),
  };
  return sprite;
}

/**
 * Update an existing vertex sprite's visual state and size without recreating it.
 */
export function updateVertexSpriteState(
  sprite: THREE.Sprite,
  state: VertexHandleState,
  customColor?: string,
) {
  if (sprite.userData.state === state && sprite.userData.customColor === customColor) {
    return;
  }
  sprite.userData.state = state;
  sprite.userData.customColor = customColor;
  sprite.userData.targetPx = getTargetScreenPixels(state);
  sprite.material = getVertexSpriteMaterial(state, customColor);
}

/**
 * Compute the world-space scale for a sprite at a given distance so that it
 * occupies exactly `targetPx` pixels on screen, at ANY camera distance or zoom level.
 */
export function calculateScreenStableScale(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  viewportHeight: number,
  targetPx = 14.5,
): number {
  if (viewportHeight <= 0) return 0.05;

  if (camera instanceof THREE.PerspectiveCamera) {
    const dist = camera.position.distanceTo(worldPos);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const visibleWorldHeightAtDist = 2 * dist * Math.tan(fovRad / 2);
    return (targetPx / viewportHeight) * visibleWorldHeightAtDist;
  }

  if (camera instanceof THREE.OrthographicCamera) {
    const orthoSpan = (camera.top - camera.bottom) / (camera.zoom || 1);
    return (targetPx / viewportHeight) * orthoSpan;
  }

  return 0.05;
}

/**
 * Update the scale of all vertex sprites in a group to keep them constant in
 * screen pixels. Called on camera movement or during the viewport animation loop.
 */
export function updateVertexSpriteScales(
  group: THREE.Group | null,
  camera: THREE.Camera | null,
  container: HTMLElement | null,
) {
  if (!group || !camera || !container || group.children.length === 0) return;
  const viewportHeight = Math.max(1, container.clientHeight);

  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i];
    if (child instanceof THREE.Sprite) {
      const targetPx = (child.userData.targetPx as number) || 14.5;
      const worldScale = calculateScreenStableScale(
        camera,
        child.position,
        viewportHeight,
        targetPx,
      );
      child.scale.set(worldScale, worldScale, 1);
    }
  }
}

/**
 * Pick the closest vertex to a 2D screen coordinate within a generous pixel threshold.
 * Resolves overlapping vertices by depth (closest to camera).
 */
export function pickClosestVertex(
  clientX: number,
  clientY: number,
  mesh: CADMesh | undefined,
  camera: THREE.Camera | null,
  container: HTMLElement | null,
  pixelThreshold = 20,
  toWorld?: (mesh: CADMesh, x: number, y: number, z: number) => THREE.Vector3,
): string | null {
  if (!mesh || !camera || !container) return null;
  const rect = container.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;

  let bestId: string | null = null;
  let bestDist = pixelThreshold;
  let bestZ = Infinity;

  const tempPos = new THREE.Vector3();
  const transform = toWorld || localToWorld;

  mesh.vertices.forEach((v) => {
    tempPos.copy(transform(mesh, v.x, v.y, v.z));
    tempPos.project(camera);

    // If point is behind camera near-plane, skip
    if (tempPos.z > 1) return;

    const screenX = ((tempPos.z > 1 ? -tempPos.x : tempPos.x) + 1) * 0.5 * rect.width;
    const screenY = (-(tempPos.z > 1 ? -tempPos.y : tempPos.y) + 1) * 0.5 * rect.height;

    const d = Math.hypot(mx - screenX, my - screenY);
    if (d < bestDist || (Math.abs(d - bestDist) < 2 && tempPos.z < bestZ)) {
      bestDist = d;
      bestZ = tempPos.z;
      bestId = v.id;
    }
  });

  return bestId;
}

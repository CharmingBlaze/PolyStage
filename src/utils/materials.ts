import type { CADMesh, MaterialAsset } from '../types/cad';

export const DEFAULT_MATERIALS: MaterialAsset[] = [
  { id: 'mat_default', name: 'Studio White', color: '#d8dce2', shading: 'pbr', roughness: 0.55, metalness: 0.05, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true, source: 'color' },
  { id: 'mat_uv_grid', name: 'UV Check', color: '#4a90a4', shading: 'unlit', roughness: 0.7, metalness: 0, emissive: '#000000', emissiveIntensity: 0, pattern: 'checker', tileScale: 4, doubleSided: true, source: 'uv' },
  { id: 'mat_ruby', name: 'Ruby', color: '#c33b45', shading: 'pbr', roughness: 0.28, metalness: 0.35, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true, source: 'color' },
  { id: 'mat_steel', name: 'Brushed Steel', color: '#8e99a6', shading: 'metallic', roughness: 0.22, metalness: 0.92, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true, source: 'color' },
  { id: 'mat_toon', name: 'Toon Coral', color: '#e96d73', shading: 'toon', roughness: 0.85, metalness: 0, emissive: '#000000', emissiveIntensity: 0, pattern: 'solid', tileScale: 1, doubleSided: true, source: 'color' },
];

export function cloneDefaultMaterials(): MaterialAsset[] {
  return DEFAULT_MATERIALS.map((material) => ({ ...material }));
}

export function materialForMesh(mesh: CADMesh, materials: MaterialAsset[]): MaterialAsset | undefined {
  const id = mesh.materialId || mesh.faces.find((face) => face.materialId)?.materialId;
  return materials.find((material) => material.id === id);
}

export function materialTextureDataUrl(material: MaterialAsset): string | undefined {
  if (material.source === 'painted') return material.textureDataUrl;
  if (material.source !== 'uv' && material.pattern === 'solid') return undefined;
  if (typeof document === 'undefined') return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.fillStyle = material.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cells = Math.max(2, Math.round(4 * material.tileScale));
  const size = canvas.width / cells;
  const dark = '#20262c';
  const light = '#d9eef1';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? dark : light;
      ctx.fillRect(x * size, y * size, size, size);
      if (material.source === 'uv' && cells <= 8) {
        ctx.fillStyle = (x + y) % 2 ? light : dark;
        ctx.fillText(`${x},${y}`, x * size + size / 2, y * size + size / 2);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

export function createMaterial(name = 'Material'): MaterialAsset {
  return {
    ...DEFAULT_MATERIALS[0],
    id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
  };
}

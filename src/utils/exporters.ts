import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CADMesh } from '../types/cad';
import { APP_GENERATOR, APP_NAME } from '../brand';

function faceNormal(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Wavefront OBJ + MTL with vertices, UVs (vt), normals (vn), and faces.
 */
export function exportToOBJ(mesh: CADMesh): { obj: string; mtl: string } {
  const mtlFilename = `${mesh.name.toLowerCase().replace(/\s+/g, '_')}.mtl`;
  let obj = `# ${APP_NAME} - Wavefront OBJ Exporter\n`;
  obj += `mtllib ${mtlFilename}\n`;
  obj += `o ${mesh.name.replace(/\s+/g, '_')}\n\n`;

  const vertMap = new Map<string, number>();
  mesh.vertices.forEach((v, index) => {
    vertMap.set(v.id, index + 1);
    obj += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
  });

  obj += `\n# UV Coordinates\n`;
  const uvList: { u: number; v: number }[] = [];
  const uvIndexMap = new Map<string, number>();

  mesh.faces.forEach((face) => {
    face.uvs.forEach((uv) => {
      const key = `${uv.u.toFixed(5)},${uv.v.toFixed(5)}`;
      if (!uvIndexMap.has(key)) {
        uvList.push(uv);
        uvIndexMap.set(key, uvList.length);
        obj += `vt ${uv.u.toFixed(6)} ${uv.v.toFixed(6)}\n`;
      }
    });
  });

  obj += `\n# Normals\n`;
  const vertLookup = new Map(mesh.vertices.map((v) => [v.id, v]));
  const normals: { x: number; y: number; z: number }[] = [];
  const faceNormalIdx: number[] = [];
  mesh.faces.forEach((face) => {
    const verts = face.vertexIds.map((id) => vertLookup.get(id)).filter(Boolean) as {
      x: number;
      y: number;
      z: number;
    }[];
    if (verts.length < 3) {
      faceNormalIdx.push(1);
      return;
    }
    const n = faceNormal(verts[0], verts[1], verts[2]);
    normals.push(n);
    faceNormalIdx.push(normals.length);
    obj += `vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}\n`;
  });
  if (normals.length === 0) {
    obj += `vn 0 1 0\n`;
  }

  obj += `\nusemtl default_material\n`;

  mesh.faces.forEach((face, faceIdx) => {
    if (face.vertexIds.length < 3) return;
    const vn = faceNormalIdx[faceIdx] || 1;
    const faceTokens = face.vertexIds.map((id, idx) => {
      const vIdx = vertMap.get(id);
      const uv = face.uvs[idx] || { u: 0, v: 0 };
      const key = `${uv.u.toFixed(5)},${uv.v.toFixed(5)}`;
      const vtIdx = uvIndexMap.get(key) || 1;
      return `${vIdx}/${vtIdx}/${vn}`;
    });
    obj += `f ${faceTokens.join(' ')}\n`;
  });

  let mtl = `# ${APP_NAME} Material File\n`;
  mtl += `newmtl default_material\n`;
  mtl += `Ka 1.000000 1.000000 1.000000\n`;
  mtl += `Kd 0.800000 0.800000 0.800000\n`;
  mtl += `Ks 0.500000 0.500000 0.500000\n`;
  mtl += `Ns 96.078431\n`;
  mtl += `d 1.000000\n`;
  mtl += `illum 2\n`;

  return { obj, mtl };
}

/**
 * ASCII STL with computed facet normals.
 */
export function exportToSTL(mesh: CADMesh): string {
  const solidName = mesh.name.replace(/\s+/g, '_') || 'mesh';
  let stl = `solid ${solidName}\n`;
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  mesh.faces.forEach((face) => {
    const verts = face.vertexIds.map((id) => vertMap.get(id)).filter(Boolean);
    if (verts.length < 3) return;
    for (let i = 1; i < verts.length - 1; i++) {
      const v1 = verts[0]!;
      const v2 = verts[i]!;
      const v3 = verts[i + 1]!;
      const n = faceNormal(v1, v2, v3);

      stl += `  facet normal ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}\n`;
      stl += `    outer loop\n`;
      stl += `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n`;
      stl += `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n`;
      stl += `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n`;
      stl += `    endloop\n`;
      stl += `  endfacet\n`;
    }
  });

  stl += `endsolid ${solidName}\n`;
  return stl;
}

function meshToThreeObject(mesh: CADMesh): THREE.Mesh {
  const vertIndex = new Map(mesh.vertices.map((v, i) => [v.id, i]));

  // Expand to unique face corners for correct UVs
  const outPos: number[] = [];
  const outUv: number[] = [];
  const indices: number[] = [];
  let cursor = 0;

  mesh.faces.forEach((face) => {
    if (face.vertexIds.length < 3) return;
    const cornerIds: number[] = [];
    face.vertexIds.forEach((id, idx) => {
      const v = mesh.vertices[vertIndex.get(id) ?? 0];
      if (!v) return;
      const uv = face.uvs[idx] || { u: 0, v: 0 };
      outPos.push(v.x, v.y, v.z);
      outUv.push(uv.u, uv.v);
      cornerIds.push(cursor++);
    });
    for (let i = 1; i < cornerIds.length - 1; i++) {
      indices.push(cornerIds[0], cornerIds[i], cornerIds[i + 1]);
    }
  });

  if (!outPos.length) {
    mesh.vertices.forEach((v) => outPos.push(v.x, v.y, v.z));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  if (outUv.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  if (indices.length) geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const obj = new THREE.Mesh(geometry, material);
  obj.name = mesh.name;
  obj.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
  obj.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
  obj.scale.set(mesh.scale.x, mesh.scale.y, mesh.scale.z);
  return obj;
}

/**
 * Valid glTF 2.0 JSON (embedded buffers) via Three.js GLTFExporter.
 */
export async function exportToGLTF(mesh: CADMesh): Promise<string> {
  ensureFileReaderPolyfill();

  const scene = new THREE.Scene();
  scene.name = 'Scene';
  scene.add(meshToThreeObject(mesh));

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: false,
    onlyVisible: true,
  });

  if (result instanceof ArrayBuffer) {
    return JSON.stringify({
      asset: { version: '2.0', generator: APP_GENERATOR },
      error: 'Exporter returned binary; use Export GLB instead.',
    });
  }

  const json = result as object;
  if (json && typeof json === 'object' && 'asset' in json) {
    const asset = (json as { asset: { generator?: string } }).asset;
    asset.generator = APP_GENERATOR;
  }
  return JSON.stringify(json, null, 2);
}

/** Vitest / Node lack browser FileReader; GLTFExporter embeds buffers via data URLs. */
function ensureFileReaderPolyfill() {
  if (typeof globalThis.FileReader !== 'undefined') return;

  class FileReaderPolyfill {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;

    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const b64 =
          typeof btoa === 'function'
            ? btoa(binary)
            : Buffer.from(bytes).toString('base64');
        this.result = `data:application/octet-stream;base64,${b64}`;
        this.onloadend?.();
      });
    }

    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  }

  (globalThis as unknown as { FileReader: typeof FileReaderPolyfill }).FileReader = FileReaderPolyfill;
}

/**
 * Blockbench-compatible .bbmodel with embedded PolyStage mesh for round-trip.
 */
export function exportToBlockbench(mesh: CADMesh): string {
  const xs = mesh.vertices.map((v) => v.x);
  const ys = mesh.vertices.map((v) => v.y);
  const zs = mesh.vertices.map((v) => v.z);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const minZ = Math.min(...zs, 0);
  const maxX = Math.max(...xs, 1);
  const maxY = Math.max(...ys, 1);
  const maxZ = Math.max(...zs, 1);

  // Blockbench element units are roughly 1 unit = 1px; scale world meters → BB cubes.
  const scale = 16;
  const from = [minX * scale, minY * scale, minZ * scale];
  const to = [maxX * scale, maxY * scale, maxZ * scale];

  const bbData = {
    meta: {
      format_version: '4.5',
      model_format: 'free',
      box_uv: false,
    },
    name: mesh.name,
    resolution: { width: 16, height: 16 },
    elements: [
      {
        name: mesh.name,
        from,
        to,
        origin: [0, 0, 0],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: null },
          south: { uv: [0, 0, 16, 16], texture: null },
          east: { uv: [0, 0, 16, 16], texture: null },
          west: { uv: [0, 0, 16, 16], texture: null },
          up: { uv: [0, 0, 16, 16], texture: null },
          down: { uv: [0, 0, 16, 16], texture: null },
        },
      },
    ],
    outliner: [mesh.name],
    // PolyStage extension — full editable mesh for re-import
    polystage_mesh: {
      id: mesh.id,
      name: mesh.name,
      type: mesh.type || 'custom',
      position: mesh.position,
      rotation: mesh.rotation,
      scale: mesh.scale,
      visible: mesh.visible !== false,
      vertices: mesh.vertices,
      faces: mesh.faces,
      edges: mesh.edges,
    },
  };
  return JSON.stringify(bbData, null, 2);
}

export function exportProjectJSON(mesh: CADMesh): string {
  return JSON.stringify(
    {
      version: '2.1.0',
      app: APP_NAME,
      mesh,
    },
    null,
    2,
  );
}

export function downloadFile(filename: string, content: string | Blob | ArrayBuffer, mimeType: string) {
  const blob =
    content instanceof Blob
      ? content
      : content instanceof ArrayBuffer
        ? new Blob([content], { type: mimeType })
        : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function generateSpriteSheet(
  canvas: HTMLCanvasElement,
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  drawFrame: (angle: number) => void,
): string {
  const cols = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / cols);

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = cols * frameWidth;
  sheetCanvas.height = rows * frameHeight;
  const sheetCtx = sheetCanvas.getContext('2d')!;

  for (let i = 0; i < frameCount; i++) {
    const angle = (i / frameCount) * Math.PI * 2;
    drawFrame(angle);

    const col = i % cols;
    const row = Math.floor(i / cols);
    sheetCtx.drawImage(canvas, col * frameWidth, row * frameHeight);
  }

  return sheetCanvas.toDataURL('image/png');
}

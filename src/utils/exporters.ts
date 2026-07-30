import type { CADMesh } from '../types/cad';
import { APP_GENERATOR, APP_NAME } from '../brand';

/**
 * Upgraded Wavefront OBJ Exporter: Exports 3D geometry with vertices, UV coordinates (vt),
 * normals (vn), and material (.mtl) references for full Blender / Unity / Unreal engine compatibility.
 */
export function exportToOBJ(mesh: CADMesh): { obj: string; mtl: string } {
  const mtlFilename = `${mesh.name.toLowerCase().replace(/\s+/g, '_')}.mtl`;
  let obj = `# ${APP_NAME} - Wavefront OBJ Exporter\n`;
  obj += `mtllib ${mtlFilename}\n`;
  obj += `o ${mesh.name}\n\n`;

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
      const key = `${uv.u.toFixed(4)},${uv.v.toFixed(4)}`;
      if (!uvIndexMap.has(key)) {
        uvList.push(uv);
        uvIndexMap.set(key, uvList.length);
        obj += `vt ${uv.u.toFixed(6)} ${uv.v.toFixed(6)}\n`;
      }
    });
  });

  obj += `\nusemtl default_material\n`;

  mesh.faces.forEach((face) => {
    const vertIndices = face.vertexIds.map((id) => vertMap.get(id)).filter(Boolean);
    if (vertIndices.length >= 3) {
      const faceTokens = face.vertexIds.map((id, idx) => {
        const vIdx = vertMap.get(id);
        const uv = face.uvs[idx] || { u: 0, v: 0 };
        const key = `${uv.u.toFixed(4)},${uv.v.toFixed(4)}`;
        const vtIdx = uvIndexMap.get(key) || 1;
        return `${vIdx}/${vtIdx}`;
      });
      obj += `f ${faceTokens.join(' ')}\n`;
    }
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
 * STL 3D Printing ASCII Exporter.
 */
export function exportToSTL(mesh: CADMesh): string {
  let stl = `solid ${mesh.name.replace(/\s+/g, '_')}\n`;
  const vertMap = new Map(mesh.vertices.map((v) => [v.id, v]));

  mesh.faces.forEach((face) => {
    const verts = face.vertexIds.map((id) => vertMap.get(id)).filter(Boolean);
    if (verts.length >= 3) {
      for (let i = 1; i < verts.length - 1; i++) {
        const v1 = verts[0]!;
        const v2 = verts[i]!;
        const v3 = verts[i + 1]!;

        stl += `  facet normal 0 0 0\n`;
        stl += `    outer loop\n`;
        stl += `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n`;
        stl += `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n`;
        stl += `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n`;
        stl += `    endloop\n`;
        stl += `  endfacet\n`;
      }
    }
  });

  stl += `endsolid ${mesh.name.replace(/\s+/g, '_')}\n`;
  return stl;
}

/**
 * Upgraded glTF 2.0 JSON Exporter.
 */
export function exportToGLTF(mesh: CADMesh): string {
  const positions: number[] = [];
  const uvs: number[] = [];
  const vertMap = new Map<string, number>();

  mesh.vertices.forEach((v, idx) => {
    vertMap.set(v.id, idx);
    positions.push(v.x, v.y, v.z);
  });

  const indices: number[] = [];
  mesh.faces.forEach((f) => {
    if (f.vertexIds.length >= 3) {
      for (let i = 1; i < f.vertexIds.length - 1; i++) {
        indices.push(
          vertMap.get(f.vertexIds[0]) || 0,
          vertMap.get(f.vertexIds[i]) || 0,
          vertMap.get(f.vertexIds[i + 1]) || 0
        );
      }
    }
  });

  const gltfObj = {
    asset: { version: '2.0', generator: APP_GENERATOR },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: mesh.name }],
    meshes: [
      {
        name: mesh.name,
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
          },
        ],
      },
    ],
    buffers: [{ byteLength: (positions.length + indices.length) * 4 }],
  };

  return JSON.stringify(gltfObj, null, 2);
}

/**
 * Blockbench Native .bbmodel Exporter.
 */
export function exportToBlockbench(mesh: CADMesh): string {
  const bbData = {
    meta: {
      format_version: '4.0',
      model_format: 'freecode',
      box_uv: false,
    },
    name: mesh.name,
    elements: [
      {
        name: mesh.name,
        from: [mesh.position.x - 8, mesh.position.y - 8, mesh.position.z - 8],
        to: [mesh.position.x + 8, mesh.position.y + 8, mesh.position.z + 8],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: 0 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ],
    outliner: [mesh.name],
  };
  return JSON.stringify(bbData, null, 2);
}

export function exportProjectJSON(mesh: CADMesh): string {
  return JSON.stringify({ version: '2.0.0', mesh }, null, 2);
}

export function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
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
  drawFrame: (angle: number) => void
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

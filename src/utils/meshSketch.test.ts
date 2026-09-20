import { describe, expect, it } from 'vitest';
import { constructionPlaneForView, vec } from './primitiveDraw';
import { createPrimitiveMesh } from './topology/primitives';
import { createPenSession, DEFAULT_PEN_SETTINGS, penAddPoint } from './penTool';
import {
  commitSketchOperation,
  createQuadStrip,
  createSketchFace,
  createSketchVertex,
  extrudeSketchProfile,
  splitSketchEdge,
} from './meshSketch';

const session = () => createPenSession(DEFAULT_PEN_SETTINGS, constructionPlaneForView('top'));

describe('Mesh Sketch SDK', () => {
  it('returns explicit deltas when creating and confirming topology', () => {
    let current = session();
    for (const point of [vec(0, 0, 0), vec(1, 0, 0), vec(1, 0, 1)]) {
      current = createSketchVertex(current, point).value;
    }
    const face = createSketchFace(current);
    expect(face.createdFaces).toHaveLength(1);
    expect(face.value.state).toBe('Confirming');

    const committed = commitSketchOperation(createPrimitiveMesh('plane'), face.value);
    expect(committed.createdFaces).toHaveLength(1);
    expect(committed.errors).toEqual([]);
  });

  it('splits an existing logical edge and updates incident faces', () => {
    const mesh = createPrimitiveMesh('plane');
    const edge = mesh.edges[0];
    const split = splitSketchEdge(mesh, edge.id, vec(0, 0, 0));
    expect(split.createdVertices).toHaveLength(1);
    expect(split.removedElements).toEqual([edge.id]);
    expect(split.value.faces[0].vertexIds).toContain(split.createdVertices[0]);
  });

  it('extrudes a valid profile into a cap and boundary quads', () => {
    let current = session();
    current = penAddPoint(current, vec(0, 0, 0));
    current = penAddPoint(current, vec(1, 0, 0));
    current = penAddPoint(current, vec(1, 0, 1));
    const extruded = extrudeSketchProfile(current, vec(0, 1, 0));
    expect(extruded.createdVertices).toHaveLength(3);
    expect(extruded.createdFaces).toHaveLength(4);
    expect(extruded.value.activeIds).toEqual([]);
  });

  it('builds continuous quad strips as a dedicated mode', () => {
    const strip = createQuadStrip(session(), [
      vec(0, 0, 0), vec(1, 0, 0), vec(0, 0, 2), vec(0, 0, 4),
    ]);
    expect(strip.createdFaces).toHaveLength(2);
    expect(strip.value.state).toBe('DrawingQuadStrip');
  });
});

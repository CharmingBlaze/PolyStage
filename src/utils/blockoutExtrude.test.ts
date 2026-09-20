import { describe, expect, it } from 'vitest';
import { extrusionMesh } from './blockoutExtrude';
import { analyzeVectorMesh } from './vectorBlockout';
import { useVectorStore } from '../store/useVectorStore';

const outline=[{u:0,v:0},{u:3,v:0},{u:3,v:1},{u:1,v:1},{u:1,v:3},{u:0,v:3}];
describe('draw and raise',()=>{
  it.each([0,0.35,1])('makes closed concave solids at roundness %s',(roundness)=>{
    const mesh=extrusionMesh({outline,height:2,roundness});
    expect(analyzeVectorMesh(mesh).issues).toEqual([]);
    // Signed volume detects inward winding and missing caps.
    let volume=0;
    for(const face of mesh.faces) for(let i=1;i<face.length-1;i++) {
      const a=mesh.vertices[face[0]],b=mesh.vertices[face[i]],c=mesh.vertices[face[i+1]];
      volume+=(a.x*(b.y*c.z-b.z*c.y)+a.y*(b.z*c.x-b.x*c.z)+a.z*(b.x*c.y-b.y*c.x))/6;
    }
    expect(volume).toBeGreaterThan(0);
    if(!roundness) expect(volume).toBeCloseTo(10);
  });
  it('rejects crossings and zero height',()=>{
    expect(()=>extrusionMesh({outline:[{u:0,v:0},{u:2,v:2},{u:0,v:2},{u:2,v:0}],height:1,roundness:0})).toThrow(/crosses/);
    expect(()=>extrusionMesh({outline,height:0,roundness:0})).toThrow(/height/);
  });
  it('commits a part as one undoable action and preserves it through copies',()=>{
    const store=useVectorStore.getState();
    const count=store.parts.length;
    store.addExtrusion({outline,height:2,roundness:0.35});
    expect(useVectorStore.getState().parts).toHaveLength(count+1);
    store.undo();expect(useVectorStore.getState().parts).toHaveLength(count);
    store.redo();
    const part=useVectorStore.getState().parts.at(-1)!;
    expect(part.extrusion?.height).toBe(2);
    store.duplicatePart();
    expect(useVectorStore.getState().parts.at(-1)!.extrusion).toEqual(part.extrusion);
  });
});

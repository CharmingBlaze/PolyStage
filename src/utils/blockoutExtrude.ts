import { ShapeUtils, Vector2 } from 'three';
import type { VectorMeshSnapshot, VectorPoint } from './vectorBlockout';

export type BlockoutExtrusion = { outline: VectorPoint[]; height: number; roundness: number };

export function extrusionMesh({ outline, height, roundness }: BlockoutExtrusion): VectorMeshSnapshot {
  if (outline.length < 3) throw new Error('Draw at least three corners.');
  if (!Number.isFinite(height) || height < 0.01) throw new Error('Raise the height before confirming.');
  const points = outline.map((p) => new Vector2(p.u, p.v));
  if (points.some((p) => !Number.isFinite(p.x + p.y))) throw new Error('Invalid outline coordinates.');
  const cross = (a: Vector2, b: Vector2, c: Vector2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const validate = (ps: Vector2[]) => {
    const on = (a: Vector2, b: Vector2, p: Vector2) => Math.abs(cross(a,b,p)) < 1e-9 &&
      p.x >= Math.min(a.x,b.x)-1e-9 && p.x <= Math.max(a.x,b.x)+1e-9 &&
      p.y >= Math.min(a.y,b.y)-1e-9 && p.y <= Math.max(a.y,b.y)+1e-9;
    for (let i=0;i<ps.length;i++) {
      const a=ps[i], b=ps[(i+1)%ps.length];
      if (a.distanceTo(b)<1e-6) throw new Error('Remove overlapping corners.');
      for (let j=i+1;j<ps.length;j++) {
        if (j===i+1 || (i===0 && j===ps.length-1)) continue;
        const c=ps[j], d=ps[(j+1)%ps.length];
        if ((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) ||
          on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)) throw new Error('Outline crosses itself. Move back and redraw that corner.');
      }
    }
    if (Math.abs(ShapeUtils.area(ps))<1e-8) throw new Error('The outline needs an area.');
  };
  validate(points);
  if (ShapeUtils.area(points)<0) points.reverse();
  const amount=Math.max(0,Math.min(1,roundness))*0.45;
  const contour: Vector2[]=[];
  points.forEach((p,i) => {
    if (!amount) { contour.push(p); return; }
    const a=p.clone().lerp(points[(i+points.length-1)%points.length],amount);
    const b=p.clone().lerp(points[(i+1)%points.length],amount);
    for (let j=0;j<=3;j++) {
      const t=j/3;
      contour.push(a.clone().multiplyScalar((1-t)**2).addScaledVector(p,2*t*(1-t)).addScaledVector(b,t*t));
    }
  });
  validate(contour);
  const n=contour.length;
  const triangles=ShapeUtils.triangulateShape(contour,[]);
  const vertices=[0,height].flatMap((y)=>contour.map((p)=>({x:p.x,y,z:p.y})));
  const faces:number[][]=[];
  for(let i=0;i<n;i++) {
    const j=(i+1)%n;
    faces.push([i,i+n,j+n,j]);
  }
  for(const tri of triangles) {
    faces.push(tri);
    faces.push([...tri].reverse().map((i)=>i+n));
  }
  const edgeMap=new Map<string,[number,number]>();
  for(const face of faces) for(let i=0;i<face.length;i++) {
    const a=face[i],b=face[(i+1)%face.length];
    edgeMap.set(`${Math.min(a,b)}:${Math.max(a,b)}`,[a,b]);
  }
  return {vertices,faces,edges:[...edgeMap.values()]};
}

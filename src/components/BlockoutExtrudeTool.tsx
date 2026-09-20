import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useVectorStore } from '../store/useVectorStore';
import { getVectorViewport } from '../utils/vectorViewportRegistry';
import { extrusionMesh } from '../utils/blockoutExtrude';
import type { VectorPoint } from '../utils/vectorBlockout';

export function BlockoutExtrudeTool() {
  const [outline,setOutline]=useState<VectorPoint[]>([]);
  const [raising,setRaising]=useState(false);
  const [height,setHeight]=useState(0);
  const [error,setError]=useState('');
  const [,redraw]=useState(0);
  const lastY=useRef(0), startY=useRef(0);
  const roundness=useVectorStore((s)=>s.roundness);
  const vp=getVectorViewport('perspective');
  const finish=()=>{
    try {
      if(!raising) {
        extrusionMesh({outline,height:0.01,roundness});
        startY.current=lastY.current; setRaising(true); setHeight(0); setError('');
      } else useVectorStore.getState().addExtrusion({outline,height,roundness});
    } catch(e) {setError((e as Error).message);}
  };
  const finishRef=useRef(finish); finishRef.current=finish;
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement)?.closest('input,select,textarea,[contenteditable=true]'))return;
      if(!['Enter','Escape','Backspace'].includes(e.key))return;
      e.preventDefault(); e.stopImmediatePropagation(); if(e.repeat)return;
      if(e.key==='Enter')finishRef.current();
      else if(e.key==='Escape')useVectorStore.getState().setMode('edit');
      else {setRaising(false);setOutline((p)=>p.slice(0,-1));setError('');}
    };
    window.addEventListener('keydown',key,true);
    const timer=window.setInterval(()=>redraw((n)=>n+1),50);
    return ()=>{window.removeEventListener('keydown',key,true);clearInterval(timer);};
  },[]);
  const project=(x:number,y:number,z:number)=>{
    if(!vp)return '0,0';
    const p=new THREE.Vector3(x,y,z).project(vp.camera);
    return `${(p.x+1)*vp.container.clientWidth/2},${(1-p.y)*vp.container.clientHeight/2}`;
  };
  let preview:ReturnType<typeof extrusionMesh>|null=null;
  try {if(raising)preview=extrusionMesh({outline,height:Math.max(0.01,height),roundness});}catch{/* confirmation reports invalid outlines */}
  return <>
    <svg className="blockout-extrude-surface" onPointerDown={(e)=>{
      if(e.button!==0||!vp)return;
      e.preventDefault();e.stopPropagation();lastY.current=e.clientY;
      if(raising){finish();return;}
      const rect=vp.container.getBoundingClientRect(), ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),vp.camera);
      const p=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
      if(!p||p.length()>10000){setError('Aim at the ground grid below the horizon.');return;}
      const s=useVectorStore.getState(),snap=(v:number)=>s.snap?Math.round(v/s.snapSize)*s.snapSize:v;
      setOutline((points)=>[...points,{u:snap(p.x),v:snap(p.z)}]);setError('');
    }} onPointerMove={(e)=>{
      lastY.current=e.clientY;if(!raising||!vp)return;
      const c=vp.camera as THREE.PerspectiveCamera;
      const scale=2*c.position.length()*Math.tan(THREE.MathUtils.degToRad(c.fov/2))/vp.container.clientHeight;
      const raw=Math.max(0,(startY.current-e.clientY)*scale), s=useVectorStore.getState();
      setHeight(s.snap?Math.round(raw/s.snapSize)*s.snapSize:raw);
    }}>
      {preview?.faces.map((face,i)=><polygon key={i} points={face.map((j)=>{const p=preview!.vertices[j];return project(p.x,p.y,p.z);}).join(' ')} fill="rgba(210,180,140,0.15)" stroke="#e8d090"/>)}
      <polyline points={outline.map((p)=>project(p.u,0,p.v)).join(' ')} fill="none" stroke="#00d4e2" strokeWidth="2"/>
      {outline.map((p,i)=>{const [cx,cy]=project(p.u,0,p.v).split(',');return <circle key={i} cx={cx} cy={cy} r="4" fill="#101114" stroke="#ffc078"/>;})}
    </svg>
    <div className="blockout-extrude-prompt">
      <strong>Draw &amp; Raise</strong>
      <span>{raising?`Height ${height.toFixed(2)} · Move up · Click or Enter to confirm`:`${outline.length} corners · Click ground grid · Enter to close`}</span>
      <span>Backspace: undo corner · Esc: cancel</span>
      {error&&<span role="alert">{error}</span>}
      <button type="button" onClick={finish}>{raising?'Confirm height':'Finish outline'}</button>
    </div>
  </>;
}

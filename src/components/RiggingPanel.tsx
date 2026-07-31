import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone, Box, CheckCircle2, ChevronRight, Copy, Film, GitBranch, Key, Link, Lock,
  Paintbrush, Pause, Play, RotateCw, ShieldAlert, Sparkles, Trash2, Unlock, Unlink, Wand2, Download,
} from 'lucide-react';
import type { CADBone, CADMesh, RigMode, ToolState, Vector3D } from '../types/cad';
import {
  autoWeightMesh, bindMeshRigid, bindSkinToSkeleton, clearSkin, createBone, createTailChainRig,
  resetPoseToRest, setRestToCurrentPose, exportGameRig, unbindSkin,
  createsCycle, deleteBoneBranch, getBoneDepth, validateRig,
} from '../utils/rigging';
import { applySkeletonPreset, SKELETON_PRESETS, type SkeletonPresetId } from '../utils/skeletonPresets';
import {
  detectProcSpecies, evaluateProceduralBoneAnim, PROC_ANIMATIONS, type ProcAnimId,
} from '../utils/proceduralBoneAnim';
import { evaluateConstraints } from '../utils/ik';
import { downloadFile } from '../utils/exporters';

interface RiggingPanelProps {
  bones: CADBone[];
  setBones: React.Dispatch<React.SetStateAction<CADBone[]>>;
  meshes: CADMesh[];
  setMeshes: React.Dispatch<React.SetStateAction<CADMesh[]>>;
  activeMeshId: string;
  selectedBoneId: string;
  setSelectedBoneId: (id: string) => void;
  toolState: ToolState;
  setToolState: React.Dispatch<React.SetStateAction<ToolState>>;
  onKeyPoseToClip?: () => void;
  onOpenAnimation?: () => void;
  /** Full Easy Rig workspace — guided pipeline + pose test. */
  easyRig?: boolean;
}

type EasyStepId = 'skeleton' | 'rest' | 'bind' | 'paint' | 'test' | 'animate';

const EASY_STEPS: Array<{ id: EasyStepId; label: string; hint: string; rigMode: RigMode }> = [
  { id: 'skeleton', label: '1 Skeleton', hint: 'Pick a preset or build bones, then parent the hierarchy.', rigMode: 'edit' },
  { id: 'rest', label: '2 Rest', hint: 'Pose the bind skeleton, then Set Rest Pose.', rigMode: 'edit' },
  { id: 'bind', label: '3 Bind', hint: 'Auto-weight the mesh to bones (Bind ON).', rigMode: 'skin' },
  { id: 'paint', label: '4 Paint', hint: 'Fix influence with weight paint. Red = strong.', rigMode: 'skin' },
  { id: 'test', label: '5 Test', hint: 'Pose-test or play a procedural motion to check skin.', rigMode: 'pose' },
  { id: 'animate', label: '6 Anim', hint: 'Key the pose and open ANIM for clips & cutscenes.', rigMode: 'pose' },
];

const axes: Array<keyof Vector3D> = ['x', 'y', 'z'];
const deg = (radians: number) => Math.round((radians * 180 / Math.PI) * 10) / 10;
const rad = (degrees: number) => degrees * Math.PI / 180;

const paintModes: Array<{ id: NonNullable<ToolState['weightPaintMode']>; label: string; hint: string }> = [
  { id: 'add', label: 'Add', hint: 'Paint influence onto the active bone' },
  { id: 'subtract', label: 'Sub', hint: 'Remove influence (or hold Shift)' },
  { id: 'smooth', label: 'Smooth', hint: 'Average with neighbors (or hold Alt)' },
  { id: 'replace', label: 'Replace', hint: 'Set weight directly to brush strength' },
];

export const RiggingPanel: React.FC<RiggingPanelProps> = ({
  bones, setBones, meshes, setMeshes, activeMeshId, selectedBoneId, setSelectedBoneId,
  toolState, setToolState, onKeyPoseToClip, onOpenAnimation, easyRig = false,
}) => {
  const [newBoneName, setNewBoneName] = useState('Bone');
  const [procAnimId, setProcAnimId] = useState<ProcAnimId>('fish_swim_x');
  const [procSpeed, setProcSpeed] = useState(1);
  const [procPreviewT, setProcPreviewT] = useState(0);
  const [easyStep, setEasyStep] = useState<EasyStepId>('skeleton');
  const [poseTesting, setPoseTesting] = useState(false);
  const poseTestRef = useRef<number | null>(null);
  const poseTRef = useRef(0);

  const selected = bones.find((bone) => bone.id === selectedBoneId) || bones[0] || null;
  const activeMesh = meshes.find((mesh) => mesh.id === activeMeshId) || meshes[0] || null;
  const isBound = Boolean(activeMesh?.skinWeights && Object.keys(activeMesh.skinWeights).length);
  const diagnostics = useMemo(() => validateRig(bones, meshes), [bones, meshes]);
  const orderedBones = useMemo(
    () => [...bones].sort((a, b) => getBoneDepth(bones, a.id) - getBoneDepth(bones, b.id)),
    [bones],
  );
  const procSpecies = useMemo(() => detectProcSpecies(bones), [bones]);
  const procOptions = useMemo(
    () => PROC_ANIMATIONS.filter((a) => procSpecies === 'other' || a.species === procSpecies),
    [procSpecies],
  );

  const stopPoseTest = () => {
    if (poseTestRef.current != null) {
      cancelAnimationFrame(poseTestRef.current);
      poseTestRef.current = null;
    }
    setPoseTesting(false);
  };

  useEffect(() => () => stopPoseTest(), []);

  useEffect(() => {
    if (!poseTesting) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      poseTRef.current += 0.016 * procSpeed;
      setBones((current) => evaluateProceduralBoneAnim(current, procAnimId, poseTRef.current, 1));
      poseTestRef.current = requestAnimationFrame(tick);
    };
    poseTestRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (poseTestRef.current != null) {
        cancelAnimationFrame(poseTestRef.current);
        poseTestRef.current = null;
      }
    };
  }, [poseTesting, procAnimId, procSpeed, setBones]);

  const applyPreset = (id: SkeletonPresetId) => {
    const label = SKELETON_PRESETS.find((p) => p.id === id)?.label || id;
    if (bones.length && !window.confirm(`Replace the current skeleton with ${label}? Mesh is kept.`)) return;
    stopPoseTest();
    const preset = applySkeletonPreset(id, activeMesh);
    setBones(preset);
    setSelectedBoneId(preset[0]?.id || '');
    if (activeMesh?.skinWeights) {
      setMeshes((current) => current.map((mesh) => mesh.id === activeMesh.id ? clearSkin(mesh) : mesh));
    }
    if (easyRig) goEasyStep('rest');
  };

  const patchSelected = (patch: Partial<CADBone>) => {
    if (!selected) return;
    setBones((current) => current.map((bone) => bone.id === selected.id ? { ...bone, ...patch } : bone));
  };

  const patchVector = (field: 'position' | 'rotation' | 'scale', axis: keyof Vector3D, value: number) => {
    if (!selected) return;
    const vector = { ...selected[field], [axis]: field === 'rotation' ? rad(value) : value };
    patchSelected({ [field]: vector });
  };

  const setRigMode = (mode: RigMode) => {
    setToolState((state) => ({
      ...state,
      editMode: 'bone',
      rigMode: mode,
      showBones: true,
      isPainting3D: false,
      brushSize: mode === 'skin' ? Math.max(state.brushSize || 1, 2) : state.brushSize,
      weightPaintMode: state.weightPaintMode || 'add',
    }));
  };

  const goEasyStep = (step: EasyStepId) => {
    const meta = EASY_STEPS.find((s) => s.id === step);
    setEasyStep(step);
    if (meta) setRigMode(meta.rigMode);
    if (step !== 'test') stopPoseTest();
  };

  const addBone = (asChild: boolean) => {
    const parent = asChild ? selected : null;
    const position = parent ? { x: 0, y: parent.length, z: 0 } : { x: 0, y: 0, z: 0 };
    const bone = createBone(newBoneName.trim() || `Bone ${bones.length + 1}`, parent?.id || null, position);
    setBones((current) => [...current, bone]);
    setSelectedBoneId(bone.id);
    setNewBoneName(`Bone ${bones.length + 2}`);
  };

  const addIkEffector = () => {
    if (!selected) return;
    const effector = createBone(`${selected.name}.IK`, selected.parentId, {
      x: selected.position.x,
      y: selected.position.y + selected.length,
      z: selected.position.z,
    }, 0.35);
    effector.deform = false;
    effector.color = '#ec5b62';
    const existing = (selected.constraints || []).filter((item) => item.type !== 'ik');
    setBones((current) => [
      ...current.map((bone) => bone.id === selected.id ? {
        ...bone,
        constraints: [...existing, {
          type: 'ik' as const,
          enabled: true,
          targetBoneId: effector.id,
          influence: 1,
          chainLength: 2,
        }],
      } : bone),
      effector,
    ]);
    setSelectedBoneId(effector.id);
    setRigMode('pose');
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy = createBone(`${selected.name}.copy`, selected.parentId, {
      x: selected.position.x + 0.15, y: selected.position.y, z: selected.position.z,
    }, selected.length);
    Object.assign(copy, {
      rotation: { ...selected.rotation }, scale: { ...selected.scale },
      deform: selected.deform, inheritRotation: selected.inheritRotation,
      constraints: selected.constraints?.map((constraint) => ({ ...constraint })),
    });
    setBones((current) => [...current, copy]);
    setSelectedBoneId(copy.id);
  };

  const mirrorSelected = () => {
    if (!selected) return;
    const mirrored = createBone(
      selected.name.endsWith('.L') ? selected.name.replace(/\.L$/, '.R') :
      selected.name.endsWith('.R') ? selected.name.replace(/\.R$/, '.L') : `${selected.name}.mirror`,
      selected.parentId,
      { x: -selected.position.x, y: selected.position.y, z: selected.position.z },
      selected.length,
    );
    mirrored.rotation = { x: selected.rotation.x, y: -selected.rotation.y, z: -selected.rotation.z };
    mirrored.restRotation = { ...mirrored.rotation };
    mirrored.mirrorBoneId = selected.id;
    setBones((current) => [
      ...current.map((bone) => bone.id === selected.id ? { ...bone, mirrorBoneId: mirrored.id } : bone),
      mirrored,
    ]);
    setSelectedBoneId(mirrored.id);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const removed = new Set<string>();
    const collect = (id: string) => {
      removed.add(id);
      bones.forEach((b) => { if (b.parentId === id) collect(b.id); });
    };
    collect(selected.id);
    setBones((current) => deleteBoneBranch(current, selected.id));
    setMeshes((current) => current.map((mesh) => ({
      ...mesh,
      boneId: mesh.boneId && removed.has(mesh.boneId) ? null : mesh.boneId,
      skinWeights: mesh.skinWeights ? Object.fromEntries(Object.entries(mesh.skinWeights).map(([vertexId, weights]) => [
        vertexId, weights.filter((weight) => !removed.has(weight.boneId)),
      ])) : undefined,
    })));
    setSelectedBoneId('');
  };

  const bindActiveMesh = () => {
    if (!activeMesh || !bones.length) return;
    stopPoseTest();
    setMeshes((current) => current.map((mesh) => mesh.id === activeMesh.id ? bindSkinToSkeleton(mesh, bones) : mesh));
    setRigMode('skin');
    if (easyRig) goEasyStep('paint');
  };

  const rigMode = toolState.rigMode || 'edit';
  const paintMode = toolState.weightPaintMode || 'add';
  const weightedCount = activeMesh?.vertices.filter((vertex) => activeMesh.skinWeights?.[vertex.id]?.length).length || 0;
  const ikConstraint = selected?.constraints?.find((item) => item.type === 'ik');
  const currentEasy = EASY_STEPS.find((s) => s.id === easyStep) || EASY_STEPS[0];

  return (
    <div className="adobe-workspace h-full flex flex-col text-[10px] overflow-hidden">
      <div className="adobe-panel-header h-9 shrink-0 justify-between">
        <span className="flex items-center gap-1.5 font-semibold">
          <Bone className="w-3.5 h-3.5 text-[#ed7300]"/>
          {easyRig ? 'EASY RIG' : 'RIGGING'}
        </span>
        <span className={diagnostics.valid ? 'text-[#2d9d78]' : 'text-[#ec5b62]'}>
          {diagnostics.valid ? 'RIG OK' : 'CHECK RIG'}
        </span>
      </div>

      {easyRig && (
        <div className="shrink-0 border-b border-[#1a1a1a] bg-[#3a3a3a] p-2 space-y-2">
          <div className="grid grid-cols-6 gap-0.5">
            {EASY_STEPS.map((step) => (
              <button
                key={step.id}
                type="button"
                title={step.hint}
                onClick={() => goEasyStep(step.id)}
                className={`h-7 px-0.5 rounded text-[8px] font-bold tracking-tight ${
                  easyStep === step.id
                    ? 'bg-[#ed7300] text-white'
                    : 'bg-[#2e2e2e] text-[#8c8c8c] hover:text-white'
                }`}
              >
                {step.label.replace(/^\d+\s/, '')}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-[#8c8c8c] leading-snug">{currentEasy.hint}</p>
          <div className="flex gap-1">
            <button
              type="button"
              className="adobe-control h-7 flex-1"
              disabled={easyStep === 'skeleton'}
              onClick={() => {
                const idx = EASY_STEPS.findIndex((s) => s.id === easyStep);
                if (idx > 0) goEasyStep(EASY_STEPS[idx - 1].id);
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="adobe-control is-active h-7 flex-1"
              onClick={() => {
                if (easyStep === 'skeleton') {
                  if (!bones.length) {
                    applyPreset('human');
                    return;
                  }
                  goEasyStep('rest');
                  return;
                }
                if (easyStep === 'rest') {
                  setBones((b) => setRestToCurrentPose(b));
                  goEasyStep('bind');
                  return;
                }
                if (easyStep === 'bind') {
                  bindActiveMesh();
                  return;
                }
                if (easyStep === 'paint') {
                  goEasyStep('test');
                  return;
                }
                if (easyStep === 'test') {
                  goEasyStep('animate');
                  return;
                }
                onKeyPoseToClip?.();
                onOpenAnimation?.();
              }}
            >
              {easyStep === 'animate' ? 'Key → ANIM' : easyStep === 'bind' ? 'Bind & Next' : easyStep === 'skeleton' && !bones.length ? 'Add Human' : 'Next'}
            </button>
          </div>
        </div>
      )}

      <div className="adobe-toolbar shrink-0 grid grid-cols-3">
        {([
          { id: 'edit' as const, label: 'EDIT', title: 'Build & parent the bind skeleton' },
          { id: 'pose' as const, label: 'POSE', title: 'Animate transforms + IK' },
          { id: 'skin' as const, label: 'PAINT', title: 'Weight paint view' },
        ]).map((mode) => (
          <button
            key={mode.id}
            title={mode.title}
            className={`adobe-control h-7 px-2 ${rigMode === mode.id ? 'is-active' : ''}`}
            onClick={() => setRigMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {!easyRig && (
        <div className="px-2 py-1.5 border-b border-[#1a1a1a] bg-[#2b2b2b] text-[9px] text-[#8c8c8c] leading-snug shrink-0">
          {rigMode === 'edit' && '1) Add bones · 2) Parent hierarchy · 3) Set Rest Pose · then Auto Weights'}
          {rigMode === 'pose' && 'Drag bones in the viewport. IK solves on release. Key Pose → Animation when ready.'}
          {rigMode === 'skin' && 'Select a bone, paint the mesh. Red = strong · Blue = none. Shift=Sub · Alt=Smooth'}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-2">
        {(rigMode === 'skin' || easyStep === 'paint') && (
          <section className="cad-card p-2 space-y-2 border border-[#ed7300]/40">
            <b className="uppercase tracking-wide text-[#ed7300] flex items-center gap-1">
              <Paintbrush className="w-3 h-3" /> Weight Paint Tools
            </b>
            <div className="grid grid-cols-4 gap-1">
              {paintModes.map((mode) => (
                <button
                  key={mode.id}
                  title={mode.hint}
                  className={`adobe-control h-7 px-1 ${paintMode === mode.id ? 'is-active' : ''}`}
                  onClick={() => setToolState((s) => ({ ...s, weightPaintMode: mode.id, editMode: 'bone', rigMode: 'skin' }))}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="block text-[#8c8c8c]">
              Brush radius
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.1}
                value={toolState.brushSize || 2}
                onChange={(e) => setToolState((s) => ({ ...s, brushSize: Number(e.target.value) }))}
                className="w-full accent-[#ed7300] mt-1"
              />
            </label>
            <label className="block text-[#8c8c8c]">
              Strength
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={Math.min(1, toolState.paintOpacity ?? 1)}
                onChange={(e) => setToolState((s) => ({ ...s, paintOpacity: Number(e.target.value) }))}
                className="w-full accent-[#e68619] mt-1"
              />
            </label>
            <div className="rounded bg-[#3a3a3a] px-2 py-1.5 text-[#8c8c8c]">
              Painting for: <b className="text-white">{selected?.name || 'select a bone'}</b>
            </div>
          </section>
        )}

        <section className="cad-card p-2 space-y-2">
          <div className="flex items-center justify-between">
            <b className="uppercase tracking-wide text-[#b3b3b3]">Skeleton hierarchy</b>
            <span className="text-[#8c8c8c]">{bones.length} bones</span>
          </div>
          <div className="flex gap-1">
            <input value={newBoneName} onChange={(event) => setNewBoneName(event.target.value)}
              className="cad-input h-7 min-w-0 flex-1 px-2" placeholder="Bone name"/>
            <button className="adobe-control h-7 px-2" onClick={() => addBone(false)}>Root</button>
            <button className="adobe-control is-active h-7 px-2" onClick={() => addBone(true)}>Child</button>
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar">
            {orderedBones.map((bone) => {
              const depth = getBoneDepth(bones, bone.id);
              const active = bone.id === selected?.id;
              return (
                <button key={bone.id} onClick={() => setSelectedBoneId(bone.id)}
                  className={`w-full h-7 rounded border flex items-center gap-1.5 pr-2 text-left ${active ? 'bg-[rgba(20,115,230,.24)] border-[#ed7300] text-white' : 'bg-[#2e2e2e] border-transparent hover:border-[#4d4d4d] text-[#b3b3b3]'}`}
                  style={{ paddingLeft: 6 + depth * 13 }}>
                  {depth > 0 && <ChevronRight className="w-3 h-3 text-[#6f6f6f]"/>}
                  <Bone className="w-3.5 h-3.5" style={{ color: bone.color || '#ed7300' }}/>
                  <span className="truncate flex-1">{bone.name}</span>
                  {bone.locked && <Lock className="w-3 h-3 text-[#8c8c8c]"/>}
                  {bone.deform === false && <span className="text-[8px] text-[#e68619]">IK</span>}
                </button>
              );
            })}
            {!bones.length && <div className="p-3 text-center text-[#8c8c8c]">Create a root bone or use a skeleton preset.</div>}
          </div>
          <div className="space-y-1">
            <span className="uppercase tracking-wide text-[8px] text-[#8c8c8c] font-semibold">Skeleton Presets</span>
            <div className="grid grid-cols-2 gap-1">
              {SKELETON_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  className="adobe-control h-7 px-1 text-[9px]"
                  onClick={() => applyPreset(preset.id)}
                >
                  <Wand2 className="w-3 h-3 text-[#ed7300]" />{preset.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-[#1a1a1a]">
              <button className="adobe-control h-7 px-1 text-[9px]" onClick={() => {
                if (bones.length && !window.confirm('Replace the current skeleton with Tail Chain?')) return;
                const preset = createTailChainRig(5);
                setBones(preset);
                setSelectedBoneId(preset[0].id);
                if (easyRig) goEasyStep('rest');
              }}><Wand2 className="w-3 h-3 text-[#2d9d78]"/>Tail</button>
              <button className="adobe-control h-7 text-[9px]" onClick={() => {
                stopPoseTest();
                setBones((b) => resetPoseToRest(b));
              }}>
                <RotateCw className="w-3 h-3 text-cyan-400"/>Reset
              </button>
              <button className="adobe-control h-7 text-[9px]" disabled={!bones.length} onClick={() => {
                if (!window.confirm('Remove skeleton? Mesh is kept.')) return;
                stopPoseTest();
                setBones([]);
                setSelectedBoneId('');
                if (activeMesh) setMeshes((c) => c.map((m) => m.id === activeMesh.id ? clearSkin(m) : m));
              }}><Trash2 className="w-3 h-3 text-[#ec5b62]"/>Remove</button>
            </div>
            <button className="adobe-control w-full h-7 text-[9px]" onClick={() => {
              setBones((b) => setRestToCurrentPose(b));
              if (easyRig) goEasyStep('bind');
            }}>
              <CheckCircle2 className="w-3 h-3 text-emerald-400"/>Set Rest Pose
            </button>
          </div>
        </section>

        {selected && <section className="cad-card p-2 space-y-2">
          <div className="flex items-center justify-between">
            <input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })}
              className="cad-input h-7 min-w-0 flex-1 px-2 font-semibold"/>
            <button className="p-1.5 text-[#8c8c8c] hover:text-white" onClick={() => patchSelected({ locked: !selected.locked })}>
              {selected.locked ? <Lock className="w-3.5 h-3.5"/> : <Unlock className="w-3.5 h-3.5"/>}
            </button>
          </div>
          <label className="block text-[#8c8c8c]">Parent
            <select value={selected.parentId || ''} onChange={(event) => {
              const parentId = event.target.value || null;
              if (!createsCycle(bones, selected.id, parentId)) patchSelected({ parentId });
            }} className="cad-input mt-1 h-7 w-full px-1">
              <option value="">— Root —</option>
              {bones.filter((bone) => bone.id !== selected.id && !createsCycle(bones, selected.id, bone.id)).map((bone) => (
                <option key={bone.id} value={bone.id}>{bone.name}</option>
              ))}
            </select>
          </label>
          {(['position', 'rotation', 'scale'] as const).map((field) => (
            <div key={field}>
              <span className="uppercase text-[8px] tracking-wider text-[#8c8c8c]">{field}</span>
              <div className="grid grid-cols-3 gap-1 mt-1">
                {axes.map((axis) => <label key={axis} className="cad-input h-7 flex items-center px-1 gap-1">
                  <span className="uppercase text-[#6f6f6f]">{axis}</span>
                  <input type="number" step={field === 'rotation' ? 1 : .05}
                    value={field === 'rotation' ? deg(selected[field][axis]) : selected[field][axis]}
                    onChange={(event) => patchVector(field, axis, Number(event.target.value))}
                    className="w-full min-w-0 bg-transparent outline-none text-right"/>
                </label>)}
              </div>
            </div>
          ))}
          <label className="cad-input h-7 flex items-center px-2 gap-2">Length
            <input type="number" min=".05" step=".05" value={selected.length}
              onChange={(event) => patchSelected({ length: Math.max(.05, Number(event.target.value)) })}
              className="w-full min-w-0 bg-transparent outline-none text-right"/>
          </label>
          <div className="grid grid-cols-2 gap-1">
            <button className={`adobe-control h-7 ${selected.deform !== false ? 'is-active' : ''}`}
              onClick={() => patchSelected({ deform: selected.deform === false })}>Deform</button>
            <button className={`adobe-control h-7 ${selected.inheritRotation !== false ? 'is-active' : ''}`}
              onClick={() => patchSelected({ inheritRotation: selected.inheritRotation === false })}>Inherit Rot.</button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button className="adobe-control h-7" onClick={duplicateSelected}><Copy className="w-3 h-3"/>Copy</button>
            <button className="adobe-control h-7" onClick={mirrorSelected}><GitBranch className="w-3 h-3"/>Mirror</button>
            <button className="adobe-control h-7 !text-[#ec5b62]" onClick={deleteSelected}><Trash2 className="w-3 h-3"/>Delete</button>
          </div>
          <button className="adobe-control w-full h-7" onClick={() => patchSelected({
            restPosition: { ...selected.position }, restRotation: { ...selected.rotation }, restScale: { ...selected.scale },
          })}><RotateCw className="w-3 h-3"/>Set Current as Rest Pose</button>

          <div className="border-t border-[#4d4d4d] pt-2 space-y-1">
            <b className="uppercase tracking-wide text-[8px] text-[#8c8c8c]">IK & Constraints</b>
            <button className={`adobe-control w-full h-7 ${selected.constraints?.some((item) => item.type === 'limit-rotation' && item.enabled) ? 'is-active' : ''}`}
              onClick={() => {
                const existing = selected.constraints || [];
                const limit = existing.find((item) => item.type === 'limit-rotation');
                patchSelected({ constraints: limit
                  ? existing.map((item) => item === limit ? { ...item, enabled: !item.enabled } : item)
                  : [...existing, {
                    type: 'limit-rotation', enabled: true,
                    min: { x: -Math.PI, y: -Math.PI, z: -Math.PI },
                    max: { x: Math.PI, y: Math.PI, z: Math.PI },
                  }],
                });
              }}>Rotation Limits</button>
            <div className="grid grid-cols-[1fr_70px] gap-1">
              <select className="cad-input h-7 px-1" value={ikConstraint?.targetBoneId || ''}
                onChange={(event) => {
                  const existing = (selected.constraints || []).filter((item) => item.type !== 'ik');
                  patchSelected({ constraints: event.target.value ? [...existing, {
                    type: 'ik', enabled: true, targetBoneId: event.target.value, influence: 1, chainLength: 2,
                  }] : existing });
                }}>
                <option value="">No IK target</option>
                {bones.filter((bone) => bone.id !== selected.id).map((bone) => <option key={bone.id} value={bone.id}>{bone.name}</option>)}
              </select>
              <input type="number" min="1" max="16" title="IK chain length"
                value={ikConstraint?.chainLength || 2}
                onChange={(event) => patchSelected({ constraints: (selected.constraints || []).map((item) =>
                  item.type === 'ik' ? { ...item, chainLength: Math.max(1, Number(event.target.value)) } : item,
                ) })} className="cad-input h-7 px-2 text-right"/>
            </div>
            <button className="adobe-control w-full h-7" onClick={addIkEffector} title="Creates a non-deform target bone and wires IK">
              + IK Effector Bone
            </button>
            <button
              className="adobe-control w-full h-7"
              title="Run IK / constraints on the current pose"
              onClick={() => setBones((prev) => evaluateConstraints(prev))}
            >
              Solve IK / Constraints
            </button>
          </div>
        </section>}

        <section className="cad-card p-2 space-y-2">
          <b className="uppercase tracking-wide text-[#b3b3b3] flex items-center gap-1"><Box className="w-3 h-3"/>Skin binding</b>
          <div className="rounded bg-[#3a3a3a] p-2">
            <div className="truncate text-white">{activeMesh?.name || 'No mesh selected'}</div>
            <div className="text-[#8c8c8c] mt-0.5">{weightedCount}/{activeMesh?.vertices.length || 0} weighted vertices</div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={!activeMesh || !bones.length}
              className={`adobe-control h-8 ${isBound ? 'is-active' : ''}`}
              title="Bind ON: anisotropic Gaussian weights from current bone layout"
              onClick={bindActiveMesh}
            ><Link className="w-3 h-3"/>Bind ON</button>
            <button
              type="button"
              disabled={!activeMesh}
              className={`adobe-control h-8 ${!isBound ? 'is-active' : ''}`}
              title="Bind OFF: mesh resets to original; bones stay editable"
              onClick={() => {
                if (!activeMesh) return;
                stopPoseTest();
                setMeshes((current) => current.map((mesh) => mesh.id === activeMesh.id ? unbindSkin(mesh) : mesh));
                setBones((b) => resetPoseToRest(b));
              }}
            ><Unlink className="w-3 h-3"/>Bind OFF</button>
            <button disabled={!activeMesh || !selected} className="adobe-control h-8" onClick={() => {
              if (!activeMesh || !selected) return;
              setMeshes((current) => current.map((mesh) => mesh.id === activeMesh.id ? bindMeshRigid(mesh, selected) : mesh));
            }}><Link className="w-3 h-3"/>Rigid Bind</button>
            <button disabled={!activeMesh || !bones.length} className="adobe-control h-8" onClick={() => {
              if (!activeMesh) return;
              setMeshes((current) => current.map((mesh) => mesh.id === activeMesh.id ? autoWeightMesh(mesh, bones) : mesh));
              setRigMode('skin');
            }}><Sparkles className="w-3 h-3"/>Re-bind</button>
          </div>
          <button className="adobe-control w-full h-8" onClick={() => {
            setRigMode('skin');
            if (easyRig) goEasyStep('paint');
          }}>
            <Paintbrush className="w-3 h-3"/> Open Weight Paint View
          </button>
        </section>

        <section className="cad-card p-2 space-y-2 border border-[#2d9d78]/35">
          <b className="uppercase tracking-wide text-[#2d9d78] flex items-center gap-1"><Play className="w-3 h-3"/>Pose Test</b>
          <div className="text-[#8c8c8c] text-[9px] leading-relaxed">
            Play a procedural motion to verify skin weights before keying animation.
          </div>
          <select
            className="cad-input h-7 w-full px-1"
            value={procAnimId}
            onChange={(e) => setProcAnimId(e.target.value as ProcAnimId)}
          >
            {(procOptions.length ? procOptions : PROC_ANIMATIONS).map((anim) => (
              <option key={anim.id} value={anim.id}>{anim.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[#8c8c8c] text-[9px]">
            Speed
            <input
              type="range" min={0.1} max={3} step={0.05} value={procSpeed}
              onChange={(e) => setProcSpeed(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-white w-8 text-right">{procSpeed.toFixed(1)}×</span>
          </label>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={!bones.length}
              className={`adobe-control h-8 ${poseTesting ? 'is-active' : ''}`}
              onClick={() => {
                if (poseTesting) {
                  stopPoseTest();
                  return;
                }
                setRigMode('pose');
                if (easyRig) setEasyStep('test');
                poseTRef.current = 0;
                setPoseTesting(true);
              }}
            >
              {poseTesting ? <><Pause className="w-3 h-3"/>Stop Test</> : <><Play className="w-3 h-3"/>Play Test</>}
            </button>
            <button
              type="button"
              disabled={!bones.length}
              className="adobe-control h-8"
              onClick={() => {
                stopPoseTest();
                poseTRef.current = 0;
                setProcPreviewT(0);
                setBones((b) => resetPoseToRest(b));
              }}
            ><RotateCw className="w-3 h-3"/>Reset Pose</button>
          </div>
          <button
            type="button"
            disabled={!bones.length}
            className="adobe-control w-full h-8"
            onClick={() => {
              stopPoseTest();
              const nextT = procPreviewT + 0.08;
              setProcPreviewT(nextT);
              setBones((current) => evaluateProceduralBoneAnim(current, procAnimId, nextT, procSpeed));
              setRigMode('pose');
            }}
          ><Sparkles className="w-3 h-3"/>Preview Step</button>
        </section>

        <section className="cad-card p-2 space-y-2">
          <b className="uppercase tracking-wide text-[#b3b3b3] flex items-center gap-1"><Film className="w-3 h-3"/>Animate</b>
          <button className="adobe-control is-active w-full h-8" onClick={() => {
            stopPoseTest();
            onKeyPoseToClip?.();
          }}>
            <Key className="w-3 h-3"/> Key Current Pose → Clip
          </button>
          <button className="adobe-control w-full h-8" onClick={() => {
            stopPoseTest();
            onOpenAnimation?.();
          }}>
            <Film className="w-3 h-3"/> Open Animation Workspace
          </button>
          <div className="text-[#8c8c8c] leading-relaxed">Pose in POSE mode, key it, then refine timing in ANIM cutscenes.</div>
        </section>

        <section className="cad-card p-2 space-y-1">
          <b className="uppercase tracking-wide text-[#b3b3b3] flex items-center gap-1">
            {diagnostics.valid ? <CheckCircle2 className="w-3 h-3 text-[#2d9d78]"/> : <ShieldAlert className="w-3 h-3 text-[#ec5b62]"/>}
            Rig diagnostics
          </b>
          <div className="grid grid-cols-2 gap-1 text-[#8c8c8c]">
            <span>Roots <b className="float-right text-white">{diagnostics.roots}</b></span>
            <span>Cycles <b className="float-right text-white">{diagnostics.cycles}</b></span>
            <span>Bad parents <b className="float-right text-white">{diagnostics.missingParents}</b></span>
            <span>Unweighted <b className="float-right text-white">{diagnostics.unweightedVertices}</b></span>
          </div>
          <button className="adobe-control w-full h-8 mt-2" disabled={!bones.length} onClick={() => {
            downloadFile('game-rig.picorig.json', exportGameRig(bones, meshes), 'application/json');
          }}><Download className="w-3.5 h-3.5"/>Export Game Rig</button>
        </section>
      </div>
    </div>
  );
};

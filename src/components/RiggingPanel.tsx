import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone, Box, CheckCircle2, ChevronRight, Copy, Film, GitBranch, Key, Link, Lock,
  Paintbrush, Pause, Play, RotateCw, ShieldAlert, Sparkles, Trash2, Unlock, Unlink, Wand2, Download,
  ChevronDown, Check,
} from 'lucide-react';
import type { CADBone, CADMesh, RigMode, ToolState, Vector3D } from '../types/cad';
import {
  autoWeightMesh, bindMeshRigid, bindSkinToSkeleton, clearSkin, createBone, createTailChainRig,
  resetPoseToRest, setRestToCurrentPose, exportGameRig, unbindSkin,
  createsCycle, deleteBoneBranch, getBoneDepths, pruneBoneReferences, validateRig, boneTailOffset,
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
  onKeyPoseToClip?: (opts?: { time?: number; selectedOnly?: boolean }) => void;
  onOpenAnimation?: () => void;
  /** Full Easy Rig workspace — guided pipeline + pose test. */
  easyRig?: boolean;
  /** Current animation playhead (seconds) for Key Pose. */
  keyPoseTime?: number;
}

type EasyStepId = 'skeleton' | 'rest' | 'bind' | 'paint' | 'test' | 'animate';

const EASY_STEPS: Array<{ id: EasyStepId; stepNum: number; label: string; hint: string; rigMode: RigMode }> = [
  { id: 'skeleton', stepNum: 1, label: 'Skeleton', hint: 'Pick a preset or build bones, then parent the hierarchy.', rigMode: 'edit' },
  { id: 'rest', stepNum: 2, label: 'Rest Pose', hint: 'Pose the bind skeleton, then lock in your rest pose.', rigMode: 'edit' },
  { id: 'bind', stepNum: 3, label: 'Skin Bind', hint: 'Auto-weight the active mesh vertices to the skeleton.', rigMode: 'skin' },
  { id: 'paint', stepNum: 4, label: 'Weight Paint', hint: 'Refine influence with paint brush. Red = high, Blue = zero.', rigMode: 'skin' },
  { id: 'test', stepNum: 5, label: 'Pose Test', hint: 'Play procedural motion tests to verify deformation.', rigMode: 'pose' },
  { id: 'animate', stepNum: 6, label: 'Animate', hint: 'Key the pose and export clips to the ANIM workspace.', rigMode: 'pose' },
];

const axes: Array<{ key: keyof Vector3D; label: string; color: string }> = [
  { key: 'x', label: 'X', color: '#e0556a' },
  { key: 'y', label: 'Y', color: '#34a87a' },
  { key: 'z', label: 'Z', color: '#4a90d9' },
];

const deg = (radians: number) => Math.round((radians * 180 / Math.PI) * 10) / 10;
const rad = (degrees: number) => degrees * Math.PI / 180;

const paintModes: Array<{ id: NonNullable<ToolState['weightPaintMode']>; label: string; hint: string }> = [
  { id: 'add', label: 'Add', hint: 'Paint influence onto the active bone' },
  { id: 'subtract', label: 'Sub', hint: 'Remove influence (hold Shift)' },
  { id: 'smooth', label: 'Smooth', hint: 'Average with neighbors (hold Alt)' },
  { id: 'replace', label: 'Replace', hint: 'Set weight directly to brush strength' },
];

export const RiggingPanel: React.FC<RiggingPanelProps> = ({
  bones, setBones, meshes, setMeshes, activeMeshId, selectedBoneId, setSelectedBoneId,
  toolState, setToolState, onKeyPoseToClip, onOpenAnimation, easyRig = false, keyPoseTime = 0,
}) => {
  const [newBoneName, setNewBoneName] = useState('Bone');
  const [procAnimId, setProcAnimId] = useState<ProcAnimId>('fish_swim_x');
  const [procSpeed, setProcSpeed] = useState(1);
  const [procPreviewT, setProcPreviewT] = useState(0);
  const [easyStep, setEasyStep] = useState<EasyStepId>('skeleton');
  const [poseTesting, setPoseTesting] = useState(false);
  const [localKeyTime, setLocalKeyTime] = useState(0);
  const [showPresets, setShowPresets] = useState(true);
  const [showConstraints, setShowConstraints] = useState(false);

  const poseTestRef = useRef<number | null>(null);
  const poseTRef = useRef(0);
  const poseSnapshotRef = useRef<CADBone[] | null>(null);

  const selected = bones.find((bone) => bone.id === selectedBoneId) || bones[0] || null;
  const activeMesh = meshes.find((mesh) => mesh.id === activeMeshId) || meshes[0] || null;
  const isBound = Boolean(activeMesh?.skinWeights && Object.keys(activeMesh.skinWeights).length);
  const diagnostics = useMemo(() => validateRig(bones, meshes), [bones, meshes]);
  // Root first, then each generation (Blender's outliner order). Depths come from
  // one pass so rendering the list does not re-walk the hierarchy per row.
  const orderedBones = useMemo(() => {
    const depths = getBoneDepths(bones);
    return [...bones]
      .map((bone) => ({ bone, depth: depths.get(bone.id) ?? 0 }))
      .sort((a, b) => a.depth - b.depth);
  }, [bones]);
  const procSpecies = useMemo(() => detectProcSpecies(bones), [bones]);
  const procOptions = useMemo(
    () => PROC_ANIMATIONS.filter((a) => procSpecies === 'other' || a.species === procSpecies),
    [procSpecies],
  );

  const stopPoseTest = (restore = false) => {
    if (poseTestRef.current != null) {
      cancelAnimationFrame(poseTestRef.current);
      poseTestRef.current = null;
    }
    setPoseTesting(false);
    if (restore && poseSnapshotRef.current) {
      setBones(poseSnapshotRef.current.map((bone) => ({
        ...bone,
        position: { ...bone.position },
        rotation: { ...bone.rotation },
        scale: { ...bone.scale },
      })));
      poseSnapshotRef.current = null;
    }
  };

  useEffect(() => () => stopPoseTest(false), []);

  useEffect(() => {
    if (!poseTesting) return;
    let alive = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!alive) return;
      // Wall-clock delta: the preview plays at the same speed on 60 Hz and 144 Hz.
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      poseTRef.current += dt * procSpeed;
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

  const startPoseTest = () => {
    poseSnapshotRef.current = bones.map((bone) => ({
      ...bone,
      position: { ...bone.position },
      rotation: { ...bone.rotation },
      scale: { ...bone.scale },
    }));
    setRigMode('pose');
    if (easyRig) setEasyStep('test');
    poseTRef.current = 0;
    setPoseTesting(true);
  };

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
    // Ignore non-finite input: a NaN would otherwise propagate into every child
    // bone's world matrix and blank the whole viewport.
    if (!selected || !Number.isFinite(value)) return;
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
    if (step !== 'test') stopPoseTest(true);
  };

  const addBone = (asChild: boolean) => {
    const parent = asChild ? selected : null;
    // A child sits at the parent's TIP, so use the parent's rotated length vector
    // instead of assuming the parent points straight up.
    const position = parent ? boneTailOffset(parent) : { x: 0, y: 0, z: 0 };
    const bone = createBone(newBoneName.trim() || `Bone ${bones.length + 1}`, parent?.id || null, position);
    setBones((current) => [...current, bone]);
    setSelectedBoneId(bone.id);
    setNewBoneName(`Bone ${bones.length + 2}`);
  };

  const addIkEffector = () => {
    if (!selected) return;
    // Effector is a sibling of the tip bone, so its position is the tip's own
    // head plus the tip's rotated length (it lands exactly on the bone tip).
    const offset = boneTailOffset(selected);
    const effector = createBone(`${selected.name}.IK`, selected.parentId, {
      x: selected.position.x + offset.x,
      y: selected.position.y + offset.y,
      z: selected.position.z + offset.z,
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
      color: selected.color,
      // Rest must match the copied pose, otherwise the duplicate snaps back to a
      // straight bind pose the moment the rig is deformed or re-evaluated.
      restPosition: { x: selected.position.x + 0.15, y: selected.position.y, z: selected.position.z },
      restRotation: { ...selected.rotation },
      restScale: { ...selected.scale },
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
    mirrored.color = selected.color;
    mirrored.deform = selected.deform;
    mirrored.inheritRotation = selected.inheritRotation;
    // Mirror the rest length so the twin deforms identically.
    mirrored.length = selected.length;
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
    setBones((current) => pruneBoneReferences(deleteBoneBranch(current, selected.id)));
    setMeshes((current) => current.map((mesh) => ({
      ...mesh,
      boneId: mesh.boneId && removed.has(mesh.boneId) ? null : mesh.boneId,
      skinWeights: mesh.skinWeights ? Object.fromEntries(
        Object.entries(mesh.skinWeights)
          .map(([vertexId, weights]) => [
            vertexId,
            weights.filter((weight) => !removed.has(weight.boneId)),
          ] as const)
          // Drop vertices that lost every influence instead of leaving empty arrays.
          .filter(([, weights]) => weights.length > 0),
      ) : undefined,
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
  // Legacy/imported bones may predate `length`; keep the inspector numeric.
  const selectedLength = selected && Number.isFinite(selected.length) ? selected.length : 0.8;
  const keyTime = Math.max(0, keyPoseTime || localKeyTime);
  const ikConstraint = selected?.constraints?.find((item) => item.type === 'ik');
  const currentEasy = EASY_STEPS.find((s) => s.id === easyStep) || EASY_STEPS[0];

  return (
    <div className="h-full flex flex-col bg-[#1c1f26] select-none text-[11.5px] text-[#bcc4d0] overflow-hidden">
      {/* ── Top Header ────────────────────────────────────────── */}
      <div className="h-10 shrink-0 px-3 bg-[#16191e] border-b border-[#1a1c22] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-[4px] bg-[#00b4c4]/15 flex items-center justify-center">
            <Bone className="w-3.5 h-3.5 text-[#00b4c4]" />
          </div>
          <span className="font-semibold text-[12px] text-[#e2e6ec] tracking-wide">
            {easyRig ? 'EASY RIG' : 'RIGGING'}
          </span>
        </div>
        <div
          title={
            diagnostics.emptyRig
              ? 'No skeleton yet. Add a root bone or load a preset.'
              : diagnostics.valid
                ? 'Rig is sound: no cycles, duplicate names or broken references'
                : `Issues: ${diagnostics.cycles} cycles, ${diagnostics.missingParents} broken parents, `
                  + `${diagnostics.duplicateNames} duplicate names, ${diagnostics.danglingReferences} dangling references`
          }
          className={`flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-medium border ${
            diagnostics.emptyRig
              ? 'bg-[#282c35]/60 text-[#8a9099] border-[#3a3f4a]'
              : diagnostics.valid
                ? 'bg-[#34a87a]/15 text-[#34a87a] border-[#34a87a]/30'
                : 'bg-[#e0556a]/15 text-[#e0556a] border-[#e0556a]/30'
          }`}
        >
          {diagnostics.emptyRig ? (
            <Bone className="w-3 h-3" />
          ) : diagnostics.valid ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <ShieldAlert className="w-3 h-3" />
          )}
          <span>{diagnostics.emptyRig ? 'NO RIG' : diagnostics.valid ? 'RIG OK' : 'CHECK RIG'}</span>
        </div>
      </div>

      {/* ── Easy Rig Guided Stepper ───────────────────────────── */}
      {easyRig && (
        <div className="shrink-0 bg-[#21242c] border-b border-[#1a1c22] p-2.5 space-y-2">
          {/* Step Pills Bar */}
          <div className="grid grid-cols-6 gap-1 bg-[#16191e] p-1 rounded-[6px] border border-[#1a1c22]">
            {EASY_STEPS.map((step) => {
              const isActive = easyStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  title={step.hint}
                  onClick={() => goEasyStep(step.id)}
                  className={`h-7 rounded-[4px] flex flex-col items-center justify-center transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#00b4c4] text-[#0a1114] font-semibold shadow-sm'
                      : 'text-[#6e7584] hover:text-[#e2e6ec] hover:bg-[#282c35]'
                  }`}
                >
                  <span className="text-[10px] font-mono leading-none">{step.stepNum}</span>
                  <span className="text-[10px] truncate max-w-[42px] leading-tight">{step.label}</span>
                </button>
              );
            })}
          </div>

          {/* Step Instruction Banner */}
          <div className="bg-[#16191e] border border-[#1a1c22] rounded-[6px] px-2.5 py-2 text-[11px] text-[#bcc4d0] leading-snug flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00b4c4] mt-1.5 shrink-0" />
            <p className="flex-1">{currentEasy.hint}</p>
          </div>

          {/* Stepper Navigation Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={easyStep === 'skeleton'}
              onClick={() => {
                const idx = EASY_STEPS.findIndex((s) => s.id === easyStep);
                if (idx > 0) goEasyStep(EASY_STEPS[idx - 1].id);
              }}
              className="flex-1 h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#bcc4d0] hover:text-[#e2e6ec] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              Back
            </button>
            <button
              type="button"
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
                onKeyPoseToClip?.({ time: keyTime });
                onOpenAnimation?.();
              }}
              className="flex-1 h-7 rounded-[6px] bg-[#00b4c4] hover:bg-[#00d4e2] text-[#0a1114] text-[11px] font-semibold transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
            >
              <span>
                {easyStep === 'animate'
                  ? 'Key → Open ANIM'
                  : easyStep === 'bind'
                    ? 'Bind & Next'
                    : easyStep === 'skeleton' && !bones.length
                      ? 'Add Human Preset'
                      : 'Next Step'}
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Mode Switcher Segmented Control ───────────────────── */}
      <div className="shrink-0 p-2.5 pb-0 bg-[#1c1f26]">
        <div className="grid grid-cols-3 bg-[#16191e] p-1 rounded-[6px] border border-[#1a1c22]">
          {([
            { id: 'edit' as const, label: 'EDIT', title: 'Edit Mode: Build & parent the bind skeleton (hotkey 5)' },
            { id: 'pose' as const, label: 'POSE', title: 'Pose Mode: Rotate, move & test IK constraints' },
            { id: 'skin' as const, label: 'PAINT', title: 'Weight Paint: Visual vertex influence painting' },
          ]).map((mode) => {
            const isActive = rigMode === mode.id;
            return (
              <button
                key={mode.id}
                title={mode.title}
                onClick={() => {
                  stopPoseTest(true);
                  setRigMode(mode.id);
                  if (easyRig) {
                    if (mode.id === 'edit') setEasyStep('skeleton');
                    else if (mode.id === 'skin') setEasyStep(isBound ? 'paint' : 'bind');
                    else setEasyStep('test');
                  }
                }}
                className={`h-7 rounded-[4px] text-[11px] font-semibold tracking-wide transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#282c35] text-[#e2e6ec] shadow-sm border border-[#3a3f4a]'
                    : 'text-[#6e7584] hover:text-[#bcc4d0] hover:bg-[#21242c]'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {!easyRig && (
        <div className="px-3 py-1.5 bg-[#1c1f26] text-[10.5px] text-[#6e7584] leading-snug">
          {rigMode === 'edit' && '1) Add bones · 2) Parent hierarchy · 3) Set Rest Pose'}
          {rigMode === 'pose' && 'Rotate bones to pose. IK resolves in real-time. Key when ready.'}
          {rigMode === 'skin' && 'Select bone, paint vertex influence. Shift=Sub · Alt=Smooth'}
        </div>
      )}

      {/* ── Scrollable Body ───────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5 space-y-2.5">
        {/* ── Weight Paint Tool Card (Visible in Skin Mode) ───── */}
        {(rigMode === 'skin' || easyStep === 'paint') && (
          <section className="bg-[#21242c] border border-[#00b4c4]/40 rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#00b4c4] uppercase tracking-wider">
                <Paintbrush className="w-3.5 h-3.5" /> Weight Paint Tools
              </span>
              <span className="text-[10px] font-mono text-[#6e7584]">Shift=Sub · Alt=Smooth</span>
            </div>

            {/* Paint Mode Switcher */}
            <div className="grid grid-cols-4 gap-1 bg-[#16191e] p-1 rounded-[6px] border border-[#1a1c22]">
              {paintModes.map((mode) => (
                <button
                  key={mode.id}
                  title={mode.hint}
                  onClick={() => setToolState((s) => ({ ...s, weightPaintMode: mode.id, editMode: 'bone', rigMode: 'skin' }))}
                  className={`h-6 rounded-[4px] text-[10.5px] font-medium transition-all cursor-pointer ${
                    paintMode === mode.id
                      ? 'bg-[#00b4c4] text-[#0a1114] font-semibold shadow-sm'
                      : 'text-[#6e7584] hover:text-[#e2e6ec] hover:bg-[#282c35]'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Sliders */}
            <div className="space-y-2 pt-1">
              <div>
                <div className="flex justify-between text-[11px] text-[#bcc4d0] mb-1">
                  <span>Brush Radius</span>
                  <span className="font-mono text-[#e2e6ec]">{(toolState.brushSize || 2).toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.1}
                  value={toolState.brushSize || 2}
                  onChange={(e) => setToolState((s) => ({ ...s, brushSize: Number(e.target.value) }))}
                  className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-[#bcc4d0] mb-1">
                  <span>Brush Strength</span>
                  <span className="font-mono text-[#e2e6ec]">{Math.round((toolState.paintOpacity ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={Math.min(1, toolState.paintOpacity ?? 1)}
                  onChange={(e) => setToolState((s) => ({ ...s, paintOpacity: Number(e.target.value) }))}
                  className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Active Bone Indicator */}
            <div className="rounded-[6px] bg-[#16191e] border border-[#1a1c22] px-2.5 py-1.5 flex items-center justify-between text-[11px]">
              <span className="text-[#6e7584]">Active Influence Bone:</span>
              <span className="font-mono font-semibold text-[#00b4c4] truncate max-w-[140px]">
                {selected?.name || 'None selected'}
              </span>
            </div>
          </section>
        )}

        {/* ── Skeleton Hierarchy Card ─────────────────────────── */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#e2e6ec] uppercase tracking-wider flex items-center gap-1.5">
              <Bone className="w-3.5 h-3.5 text-[#00b4c4]" /> Skeleton Hierarchy
            </span>
            <span className="px-1.5 py-0.5 rounded-[4px] bg-[#16191e] border border-[#1a1c22] text-[10px] font-mono text-[#6e7584]">
              {bones.length} {bones.length === 1 ? 'bone' : 'bones'}
            </span>
          </div>

          {/* Add Bone Controls */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newBoneName}
              onChange={(e) => setNewBoneName(e.target.value)}
              placeholder="Bone name"
              className="flex-1 h-7 px-2.5 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] text-[#e2e6ec] outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => addBone(false)}
              title="Add a new root bone at the scene origin"
              className="h-7 px-2.5 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium transition-colors cursor-pointer"
            >
              + Root
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => addBone(true)}
              title="Add a child bone attached to the selected bone tip"
              className="h-7 px-2.5 rounded-[6px] bg-[#00b4c4] hover:bg-[#00d4e2] text-[#0a1114] text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              + Child
            </button>
          </div>

          {/* Bones Outliner List */}
          <div className="space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar rounded-[6px] bg-[#16191e] border border-[#1a1c22] p-1">
            {orderedBones.map(({ bone, depth }) => {
              const isSelected = bone.id === selected?.id;
              return (
                <button
                  key={bone.id}
                  type="button"
                  onClick={() => setSelectedBoneId(bone.id)}
                  className={`w-full h-7 rounded-[4px] flex items-center gap-1.5 pr-2 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[rgba(230,180,34,0.14)] border border-[#e6b422]/60 text-[#e2e6ec]'
                      : 'border border-transparent hover:bg-[#282c35] text-[#bcc4d0]'
                  }`}
                  style={{ paddingLeft: 6 + depth * 14 }}
                >
                  {depth > 0 && <ChevronRight className="w-3 h-3 text-[#6e7584] shrink-0" />}
                  <Bone className="w-3.5 h-3.5 shrink-0" style={{ color: bone.color || (isSelected ? '#e6b422' : '#00b4c4') }} />
                  <span className="truncate flex-1 font-mono text-[11px]">{bone.name}</span>
                  {bone.locked && <Lock className="w-3 h-3 text-[#6e7584] shrink-0" />}
                  {bone.deform === false && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-[#00b4c4]/15 text-[#00b4c4] font-mono shrink-0">
                      IK
                    </span>
                  )}
                </button>
              );
            })}
            {!bones.length && (
              <div className="p-4 text-center text-[#6e7584] text-[11px]">
                No bones in skeleton. Use presets below or create a root bone.
              </div>
            )}
          </div>

          {/* Skeleton Presets Collapsible */}
          <div className="pt-1 space-y-2 border-t border-[#1a1c22]">
            <div
              onClick={() => setShowPresets((v) => !v)}
              className="flex items-center justify-between cursor-pointer text-[10.5px] font-semibold text-[#6e7584] uppercase tracking-wider hover:text-[#bcc4d0]"
            >
              <span>Skeleton Presets</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPresets ? '' : '-rotate-90'}`} />
            </div>

            {showPresets && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {SKELETON_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.description}
                      onClick={() => applyPreset(preset.id)}
                      className="h-7 px-2 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Wand2 className="w-3 h-3 text-[#00b4c4] shrink-0" />
                      <span className="truncate">{preset.label}</span>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (bones.length && !window.confirm('Replace current skeleton with Tail Chain?')) return;
                      const preset = createTailChainRig(5);
                      setBones(preset);
                      setSelectedBoneId(preset[0].id);
                      if (easyRig) goEasyStep('rest');
                    }}
                    className="h-7 px-1.5 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <Wand2 className="w-3 h-3 text-[#34a87a]" /> Tail
                  </button>
                  <button
                    type="button"
                    disabled={!bones.length}
                    onClick={() => {
                      stopPoseTest();
                      setBones((b) => resetPoseToRest(b));
                    }}
                    className="h-7 px-1.5 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <RotateCw className="w-3 h-3 text-[#00b4c4]" /> Reset
                  </button>
                  <button
                    type="button"
                    disabled={!bones.length}
                    onClick={() => {
                      if (!window.confirm('Remove entire skeleton? Mesh geometry is kept.')) return;
                      stopPoseTest();
                      setBones([]);
                      setSelectedBoneId('');
                      if (activeMesh) setMeshes((c) => c.map((m) => m.id === activeMesh.id ? clearSkin(m) : m));
                    }}
                    className="h-7 px-1.5 rounded-[6px] bg-[#282c35] hover:bg-[#e0556a]/20 border border-[#3a3f4a] hover:border-[#e0556a]/50 text-[#e0556a] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!bones.length}
                  onClick={() => {
                    setBones((b) => setRestToCurrentPose(b));
                    if (easyRig) goEasyStep('bind');
                  }}
                  className="w-full h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#34a87a]" /> Set Current as Rest Pose
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Selected Bone Properties Card ───────────────────── */}
        {selected && (
          <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
            {/* Bone Name & Lock Toggle */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={selected.name}
                onChange={(e) => patchSelected({ name: e.target.value })}
                className="flex-1 h-7 px-2.5 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11.5px] font-mono font-semibold text-[#e2e6ec] outline-none transition-colors"
              />
              <button
                type="button"
                title={selected.locked ? 'Unlock bone transforms' : 'Lock bone transforms'}
                onClick={() => patchSelected({ locked: !selected.locked })}
                className="w-7 h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] flex items-center justify-center text-[#bcc4d0] hover:text-[#e2e6ec] transition-colors cursor-pointer"
              >
                {selected.locked ? <Lock className="w-3.5 h-3.5 text-[#e6b422]" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Parent Dropdown */}
            <div>
              <label className="block text-[10.5px] font-semibold text-[#6e7584] uppercase tracking-wider mb-1">
                Parent Bone
              </label>
              <select
                value={selected.parentId || ''}
                onChange={(e) => {
                  const parentId = e.target.value || null;
                  if (!createsCycle(bones, selected.id, parentId)) patchSelected({ parentId });
                }}
                className="w-full h-7 px-2 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-[#e2e6ec] outline-none transition-colors cursor-pointer"
              >
                <option value="">— Root (No Parent) —</option>
                {bones
                  .filter((bone) => bone.id !== selected.id && !createsCycle(bones, selected.id, bone.id))
                  .map((bone) => (
                    <option key={bone.id} value={bone.id}>
                      {bone.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Transform Matrix: Position, Rotation, Scale */}
            {(['position', 'rotation', 'scale'] as const).map((field) => (
              <div key={field} className="space-y-1">
                <span className="text-[10px] font-semibold text-[#6e7584] uppercase tracking-wider">
                  {field} {field === 'rotation' ? '(deg)' : ''}
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {axes.map(({ key, label, color }) => (
                    <div
                      key={key}
                      className="h-7 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus-within:border-[#00b4c4] flex items-center px-1.5 gap-1 transition-colors"
                    >
                      <span className="text-[10px] font-mono font-bold shrink-0" style={{ color }}>
                        {label}
                      </span>
                      <input
                        type="number"
                        step={field === 'rotation' ? 1 : 0.05}
                        value={field === 'rotation' ? deg(selected[field][key]) : selected[field][key]}
                        onChange={(e) => patchVector(field, key, Number(e.target.value))}
                        className="w-full min-w-0 bg-transparent text-right font-mono text-[11px] text-[#e2e6ec] outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Length */}
            <div>
              <div className="flex justify-between text-[10.5px] font-semibold text-[#6e7584] uppercase tracking-wider mb-1">
                <span>Bone Length</span>
                <span className="font-mono text-[#e2e6ec]">{selectedLength.toFixed(2)}</span>
              </div>
              <div className="h-7 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus-within:border-[#00b4c4] flex items-center px-2 transition-colors">
                <input
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={selectedLength}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    patchSelected({ length: Math.max(0.05, next) });
                  }}
                  className="w-full bg-transparent font-mono text-[11px] text-[#e2e6ec] outline-none text-right"
                />
              </div>
            </div>

            {/* Deform & Inherit Rotation Toggles */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => patchSelected({ deform: selected.deform === false })}
                className={`h-7 px-2 rounded-[6px] border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  selected.deform !== false
                    ? 'bg-[#00b4c4]/15 border-[#00b4c4] text-[#00b4c4]'
                    : 'bg-[#282c35] border-[#3a3f4a] text-[#6e7584]'
                }`}
              >
                {selected.deform !== false && <Check className="w-3 h-3" />}
                <span>Deform Mesh</span>
              </button>
              <button
                type="button"
                onClick={() => patchSelected({ inheritRotation: selected.inheritRotation === false })}
                className={`h-7 px-2 rounded-[6px] border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  selected.inheritRotation !== false
                    ? 'bg-[#00b4c4]/15 border-[#00b4c4] text-[#00b4c4]'
                    : 'bg-[#282c35] border-[#3a3f4a] text-[#6e7584]'
                }`}
              >
                {selected.inheritRotation !== false && <Check className="w-3 h-3" />}
                <span>Inherit Rot.</span>
              </button>
            </div>

            {/* Bone Action Buttons: Copy, Mirror, Delete */}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={duplicateSelected}
                className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-3 h-3 text-[#bcc4d0]" /> Copy
              </button>
              <button
                type="button"
                onClick={mirrorSelected}
                className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <GitBranch className="w-3 h-3 text-[#bcc4d0]" /> Mirror
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#e0556a]/20 border border-[#3a3f4a] hover:border-[#e0556a]/50 text-[#e0556a] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>

            {/* IK & Constraints Sub-Section */}
            <div className="border-t border-[#1a1c22] pt-2 space-y-2">
              <div
                onClick={() => setShowConstraints((v) => !v)}
                className="flex items-center justify-between cursor-pointer text-[10.5px] font-semibold text-[#6e7584] uppercase tracking-wider hover:text-[#bcc4d0]"
              >
                <span>IK & Constraints</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showConstraints ? '' : '-rotate-90'}`} />
              </div>

              {showConstraints && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      const existing = selected.constraints || [];
                      const limit = existing.find((item) => item.type === 'limit-rotation');
                      patchSelected({
                        constraints: limit
                          ? existing.map((item) => (item === limit ? { ...item, enabled: !item.enabled } : item))
                          : [
                              ...existing,
                              {
                                type: 'limit-rotation',
                                enabled: true,
                                min: { x: -Math.PI, y: -Math.PI, z: -Math.PI },
                                max: { x: Math.PI, y: Math.PI, z: Math.PI },
                              },
                            ],
                      });
                    }}
                    className={`w-full h-7 rounded-[6px] border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      selected.constraints?.some((item) => item.type === 'limit-rotation' && item.enabled)
                        ? 'bg-[#00b4c4]/15 border-[#00b4c4] text-[#00b4c4]'
                        : 'bg-[#282c35] border-[#3a3f4a] text-[#bcc4d0]'
                    }`}
                  >
                    Rotation Limits Constraint
                  </button>

                  <div className="grid grid-cols-[1fr_80px] gap-1.5">
                    <select
                      value={ikConstraint?.targetBoneId || ''}
                      onChange={(e) => {
                        const existing = (selected.constraints || []).filter((item) => item.type !== 'ik');
                        patchSelected({
                          constraints: e.target.value
                            ? [
                                ...existing,
                                {
                                  type: 'ik',
                                  enabled: true,
                                  targetBoneId: e.target.value,
                                  influence: 1,
                                  chainLength: 2,
                                },
                              ]
                            : existing,
                        });
                      }}
                      className="h-7 px-2 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-[#e2e6ec] outline-none transition-colors cursor-pointer"
                    >
                      <option value="">No IK Target</option>
                      {bones
                        .filter((bone) => bone.id !== selected.id)
                        .map((bone) => (
                          <option key={bone.id} value={bone.id}>
                            Target: {bone.name}
                          </option>
                        ))}
                    </select>
                    <div className="h-7 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] flex items-center px-2 gap-1">
                      <span className="text-[10px] text-[#6e7584]">Chain</span>
                      <input
                        type="number"
                        min="1"
                        max="16"
                        value={ikConstraint?.chainLength || 2}
                        onChange={(e) =>
                          patchSelected({
                            constraints: (selected.constraints || []).map((item) =>
                              item.type === 'ik' ? { ...item, chainLength: Math.max(1, Number(e.target.value)) } : item,
                            ),
                          })
                        }
                        className="w-full bg-transparent font-mono text-[11px] text-[#e2e6ec] outline-none text-right"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={addIkEffector}
                      className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[10.5px] font-medium transition-colors cursor-pointer truncate px-2"
                    >
                      + IK Effector Bone
                    </button>
                    <button
                      type="button"
                      onClick={() => setBones((prev) => evaluateConstraints(prev))}
                      className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[10.5px] font-medium transition-colors cursor-pointer truncate px-2"
                    >
                      Solve Constraints
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Skin Binding Card ───────────────────────────────── */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#e2e6ec] uppercase tracking-wider flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-[#00b4c4]" /> Skin Binding
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono border ${
                isBound
                  ? 'bg-[#34a87a]/15 text-[#34a87a] border-[#34a87a]/30'
                  : 'bg-[#16191e] text-[#6e7584] border-[#1a1c22]'
              }`}
            >
              {isBound ? 'Bound' : 'Not Bound'}
            </span>
          </div>

          <div className="rounded-[6px] bg-[#16191e] border border-[#1a1c22] p-2 space-y-0.5">
            <div className="font-medium text-[#e2e6ec] truncate">{activeMesh?.name || 'No mesh active'}</div>
            <div className="text-[10.5px] text-[#6e7584] font-mono">
              {weightedCount} / {activeMesh?.vertices.length || 0} vertices weighted
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!activeMesh || !bones.length}
              onClick={bindActiveMesh}
              className={`h-7 px-2 rounded-[6px] border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
                isBound
                  ? 'bg-[#00b4c4] text-[#0a1114] font-semibold border-[#00b4c4]'
                  : 'bg-[#282c35] border-[#3a3f4a] text-[#e2e6ec] hover:bg-[#2f3340]'
              }`}
            >
              <Link className="w-3.5 h-3.5" /> Bind ON
            </button>
            <button
              type="button"
              disabled={!activeMesh}
              onClick={() => {
                if (!activeMesh) return;
                stopPoseTest();
                setMeshes((current) => current.map((mesh) => (mesh.id === activeMesh.id ? unbindSkin(mesh) : mesh)));
                setBones((b) => resetPoseToRest(b));
              }}
              className="h-7 px-2 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#bcc4d0] hover:text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Unlink className="w-3.5 h-3.5" /> Bind OFF
            </button>
            <button
              type="button"
              disabled={!activeMesh || !selected}
              onClick={() => {
                if (!activeMesh || !selected) return;
                setMeshes((current) => current.map((mesh) => (mesh.id === activeMesh.id ? bindMeshRigid(mesh, selected) : mesh)));
              }}
              className="h-7 px-2 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Link className="w-3.5 h-3.5" /> Rigid Bind
            </button>
            <button
              type="button"
              disabled={!activeMesh || !bones.length}
              onClick={() => {
                if (!activeMesh) return;
                setMeshes((current) => current.map((mesh) => (mesh.id === activeMesh.id ? autoWeightMesh(mesh, bones) : mesh)));
                setRigMode('skin');
              }}
              className="h-7 px-2 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#00b4c4]" /> Re-bind
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setRigMode('skin');
              if (easyRig) goEasyStep('paint');
            }}
            className="w-full h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Paintbrush className="w-3.5 h-3.5 text-[#00b4c4]" /> Open Weight Paint View
          </button>
        </section>

        {/* ── Pose Test Card ──────────────────────────────────── */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#e2e6ec] uppercase tracking-wider flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5 text-[#34a87a]" /> Pose Test Motion
            </span>
            <span className="text-[10px] text-[#6e7584] font-mono capitalize">
              {procSpecies !== 'other' ? `${procSpecies}` : 'Generic'}
            </span>
          </div>

          <select
            value={procAnimId}
            onChange={(e) => setProcAnimId(e.target.value as ProcAnimId)}
            className="w-full h-7 px-2 rounded-[6px] bg-[#16191e] border border-[#3a3f4a] focus:border-[#00b4c4] text-[11px] font-mono text-[#e2e6ec] outline-none transition-colors cursor-pointer"
          >
            {(procOptions.length ? procOptions : PROC_ANIMATIONS).map((anim) => (
              <option key={anim.id} value={anim.id}>
                {anim.label}
              </option>
            ))}
          </select>

          <div>
            <div className="flex justify-between text-[10.5px] text-[#bcc4d0] mb-1">
              <span>Playback Speed</span>
              <span className="font-mono text-[#e2e6ec]">{procSpeed.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={procSpeed}
              onChange={(e) => setProcSpeed(Number(e.target.value))}
              className="w-full accent-[#00b4c4] h-1.5 bg-[#16191e] rounded-lg cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!bones.length}
              onClick={() => {
                if (poseTesting) {
                  stopPoseTest(true);
                  return;
                }
                startPoseTest();
              }}
              className={`h-7 rounded-[6px] border text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
                poseTesting
                  ? 'bg-[#e0556a] text-white border-[#e0556a]'
                  : 'bg-[#00b4c4] text-[#0a1114] border-[#00b4c4] hover:bg-[#00d4e2]'
              }`}
            >
              {poseTesting ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> Stop Test
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Play Motion
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!bones.length}
              onClick={() => {
                stopPoseTest(false);
                poseSnapshotRef.current = null;
                poseTRef.current = 0;
                setProcPreviewT(0);
                setBones((b) => resetPoseToRest(b));
              }}
              className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <RotateCw className="w-3.5 h-3.5 text-[#00b4c4]" /> Reset Pose
            </button>
          </div>

          <button
            type="button"
            disabled={!bones.length}
            onClick={() => {
              stopPoseTest(false);
              const nextT = procPreviewT + 0.08;
              setProcPreviewT(nextT);
              setBones((current) => evaluateProceduralBoneAnim(current, procAnimId, nextT, procSpeed));
              setRigMode('pose');
            }}
            className="w-full h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#00b4c4]" /> Step Frame (+0.08s)
          </button>
        </section>

        {/* ── Ready for Animation Card ────────────────────────── */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#e2e6ec] uppercase tracking-wider flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-[#00b4c4]" /> Animation Pipeline
            </span>
          </div>

          <div className="rounded-[6px] bg-[#16191e] border border-[#1a1c22] p-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Skeleton Size</span>
              <span className="font-mono text-[#e2e6ec]">{bones.length} bones</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Binding Status</span>
              <span className={`font-mono ${isBound ? 'text-[#34a87a]' : 'text-[#e0556a]'}`}>
                {isBound ? `${weightedCount} verts bound` : 'Not bound'}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-[#1a1c22]">
              <span className="text-[#6e7584]">Keyframe Time</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number(keyTime.toFixed(2))}
                  onChange={(e) => setLocalKeyTime(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 h-6 rounded-[4px] bg-[#21242c] border border-[#3a3f4a] focus:border-[#00b4c4] px-1.5 text-right font-mono text-[11px] text-[#e2e6ec] outline-none"
                />
                <span className="text-[#6e7584] font-mono text-[10px]">s</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              disabled={!bones.length}
              onClick={() => {
                stopPoseTest(true);
                onKeyPoseToClip?.({ time: keyTime });
              }}
              className="w-full h-7 rounded-[6px] bg-[#00b4c4] hover:bg-[#00d4e2] text-[#0a1114] text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm disabled:opacity-35 disabled:pointer-events-none"
            >
              <Key className="w-3.5 h-3.5" /> Key All Bones @ {keyTime.toFixed(2)}s
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                stopPoseTest(true);
                onKeyPoseToClip?.({ time: keyTime, selectedOnly: true });
              }}
              className="w-full h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Key className="w-3.5 h-3.5 text-[#00b4c4]" /> Key Selected Bone Only
            </button>
            <button
              type="button"
              onClick={() => {
                stopPoseTest(true);
                onKeyPoseToClip?.({ time: keyTime });
                onOpenAnimation?.();
              }}
              className="w-full h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Film className="w-3.5 h-3.5 text-[#00b4c4]" /> Key & Open ANIM Workspace
            </button>
          </div>
        </section>

        {/* ── Diagnostics & Export Card ───────────────────────── */}
        <section className="bg-[#21242c] border border-[#1a1c22] rounded-[6px] p-2.5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#e2e6ec] uppercase tracking-wider flex items-center gap-1.5">
              {diagnostics.valid ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#34a87a]" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-[#e0556a]" />
              )}
              Rig Diagnostics
            </span>
            <span
              className={`text-[10px] font-mono ${diagnostics.valid ? 'text-[#34a87a]' : 'text-[#e0556a]'}`}
            >
              {diagnostics.valid ? 'Passed' : 'Issues Found'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 rounded-[6px] bg-[#16191e] border border-[#1a1c22] p-2 text-[10.5px]">
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Roots</span>
              <span className="font-mono text-[#e2e6ec]">{diagnostics.roots}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Cycles</span>
              <span className={`font-mono ${diagnostics.cycles > 0 ? 'text-[#e0556a]' : 'text-[#e2e6ec]'}`}>
                {diagnostics.cycles}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Bad Parents</span>
              <span className={`font-mono ${diagnostics.missingParents > 0 ? 'text-[#e0556a]' : 'text-[#e2e6ec]'}`}>
                {diagnostics.missingParents}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Duplicate Names</span>
              <span className={`font-mono ${diagnostics.duplicateNames > 0 ? 'text-[#e0556a]' : 'text-[#e2e6ec]'}`}>
                {diagnostics.duplicateNames}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Broken Refs</span>
              <span className={`font-mono ${diagnostics.danglingReferences > 0 ? 'text-[#e0556a]' : 'text-[#e2e6ec]'}`}>
                {diagnostics.danglingReferences}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6e7584]">Unweighted</span>
              <span className="font-mono text-[#e2e6ec]">{diagnostics.unweightedVertices}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!bones.length || diagnostics.danglingReferences === 0}
              onClick={() => setBones((current) => pruneBoneReferences(current))}
              title="Drop mirror links, constraints and parents that point at deleted bones"
              className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Wand2 className="w-3.5 h-3.5 text-[#34a87a]" /> Clean Refs
            </button>
            <button
              type="button"
              disabled={!bones.length}
              onClick={() => {
                downloadFile('game-rig.picorig.json', exportGameRig(bones, meshes), 'application/json');
              }}
              className="h-7 rounded-[6px] bg-[#282c35] hover:bg-[#2f3340] border border-[#3a3f4a] text-[#e2e6ec] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            >
              <Download className="w-3.5 h-3.5 text-[#00b4c4]" /> Export Rig
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

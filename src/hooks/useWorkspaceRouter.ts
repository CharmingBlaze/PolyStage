import { useState } from 'react';
import type { WorkspaceMode } from '../types/cad';

type HeaderWorkspace = {
  id: WorkspaceMode;
  label: string;
  icon: string;
  shortLabel: string;
};

export function useWorkspaceRouter() {
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceMode>('model');
  const headerWorkspaces: HeaderWorkspace[] = [
    { id: 'model', label: 'Model', icon: 'Cube', shortLabel: 'MOD' },
    { id: 'paint', label: 'Paint', icon: 'Paintbrush', shortLabel: 'PNT' },
    { id: 'rig', label: 'Rig', icon: 'Bone', shortLabel: 'RIG' },
    { id: 'animate', label: 'Animate', icon: 'Film', shortLabel: 'ANM' },
    { id: 'cutscene', label: 'Cutscene', icon: 'Clapperboard', shortLabel: 'CUT' },
  ];

  // Handle workspace change logic
  const changeWorkspace = (mode: WorkspaceMode) => {
    if (currentWorkspace === mode) return;
    setCurrentWorkspace(mode);
  };

  return {
    currentWorkspace,
    headerWorkspaces,
    changeWorkspace,
  } as const;
}


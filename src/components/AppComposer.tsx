import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { Toolbar } from './Toolbar';
import { Viewport3D } from './Viewport3D';
import { QuadViewport } from './QuadViewport';
import { UVEditor } from './UVEditor';
import { UVEditorModal } from './UVEditorModal';
import { PropertiesPanel } from './PropertiesPanel';
import { RenderExportPanel } from './RenderExportPanel';
import { OutlinerPanel } from './OutlinerPanel';
import { RiggingPanel } from './RiggingPanel';
import { MaterialPanel } from './MaterialPanel';
import { FloatingToolWindow } from './FloatingToolWindow';
import { FloatingOutliner } from './FloatingOutliner';
import type { AppState } from '../hooks/useAppState';
import type { useWorkspaceRouter } from '../hooks/useWorkspaceRouter';


type WorkspaceRouter = ReturnType<typeof useWorkspaceRouter>;

interface AppComposerProps {
  state: AppState;
  router: WorkspaceRouter;
  children: React.ReactNode;
}

export function AppComposer({ state, router, children }: AppComposerProps) {
  return (
    <ErrorBoundary>
      <div className="app-container">
        <Header workspaces={router.headerWorkspaces} onChangeWorkspace={(mode) => router.changeWorkspace(mode)} />
        <Toolbar />
        <div className="main-content">
          {router.currentWorkspace === 'model' && (
            <>
              <Viewport3D />
              <QuadViewport />
              <UVEditor />
              <PropertiesPanel />
              <RenderExportPanel />
              <OutlinerPanel />
            </>
          )}
          {children}
        </div>
      </div>
    </ErrorBoundary>
  );
}
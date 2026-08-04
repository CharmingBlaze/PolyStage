import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('PolyStage ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center p-6 bg-[#1a1b1e] text-[#d1d5db] border border-[#3b3f46] rounded-md gap-4">
          <div className="p-3 bg-[#e5484d]/10 border border-[#e5484d]/30 rounded-full text-[#e5484d]">
            <AlertTriangle size={32} />
          </div>
          <div className="text-center max-w-md">
            <h3 className="text-base font-semibold text-[#f3f4f6] mb-1">
              {this.props.fallbackTitle || 'Workspace Encountered an Error'}
            </h3>
            <p className="text-xs text-[#9ca3af] mb-3 leading-relaxed">
              {this.state.error?.message || 'An unexpected error occurred during rendering or 3D processing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-[#ed7300] hover:bg-[#ff8412] text-white font-medium text-xs rounded shadow transition-colors"
          >
            <RefreshCw size={14} />
            Recover Workspace
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

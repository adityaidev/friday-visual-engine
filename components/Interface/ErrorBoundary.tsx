import React from 'react';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }

  reset = (): void => this.setState({ error: null });

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="absolute inset-0 flex items-center justify-center bg-[#030712]/90 backdrop-blur-xl z-50 p-8"
      >
        <div className="max-w-md bg-red-950/40 border border-red-500/40 rounded-xl p-6 text-red-100 font-mono">
          <h2 className="text-lg font-bold text-red-400 mb-2">Subsystem Failure</h2>
          <p className="text-xs opacity-80 mb-4 break-words">{this.state.error.message}</p>
          <button
            onClick={this.reset}
            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded text-xs font-bold tracking-wider uppercase"
          >
            Recover
          </button>
        </div>
      </div>
    );
  }
}

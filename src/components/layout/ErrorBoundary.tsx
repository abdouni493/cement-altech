import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in a page so that one crashing interface does not
 * blank out the whole application. The boundary is keyed by route in AppLayout,
 * so navigating to another page automatically remounts and clears the error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the error in the console for debugging.
    console.error('Page render error:', error, info);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-2xl bg-rose-deep/10 flex items-center justify-center mb-4 text-rose-deep">
            <AlertTriangle size={32} />
          </div>
          <h2 className="font-display text-xl font-semibold text-text-primary mb-2">
            Une erreur est survenue
          </h2>
          <p className="text-sm text-text-muted max-w-md mb-1">
            Cette page n'a pas pu s'afficher. Vous pouvez réessayer ou changer d'interface.
          </p>
          {this.state.error && (
            <p className="text-xs text-text-muted/70 font-mono mb-5 max-w-lg break-words">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-button text-white text-sm font-medium shadow-gold hover:brightness-105 transition"
          >
            <RotateCcw size={16} /> Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorScreen';
import { recordError } from '../lib/errorLog';

/**
 * Catches render/lifecycle crashes and shows them on-screen via ErrorScreen —
 * including in RELEASE builds, where there's no red-box and an uncaught render
 * error otherwise leaves a blank page. Also persists the error (recordError) so
 * it's retrievable after a relaunch. Async/uncaught errors that never reach a
 * boundary are handled by the global handler installed in App (see errorLog).
 */
interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
  componentStack?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[inkread] uncaught render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? undefined });
    void recordError(error, 'render');
  }

  private reset = (): void => this.setState({ error: undefined, componentStack: undefined });

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorScreen
        context="render"
        message={error.message || String(error)}
        stack={error.stack}
        componentStack={componentStack}
        onReset={this.reset}
      />
    );
  }
}

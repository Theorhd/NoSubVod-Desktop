import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  public constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  public static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  public override componentDidCatch(error: unknown) {
    console.error('Portal runtime error:', error);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: '#f7f8ff', background: '#07080f', minHeight: '100vh' }}>
          <h2 style={{ marginTop: 0 }}>Portal error</h2>
          <p style={{ marginBottom: 0 }}>{this.state.message || 'Unknown runtime error'}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

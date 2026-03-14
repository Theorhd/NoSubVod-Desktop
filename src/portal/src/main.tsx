import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';

function safeStorageGet(storage: Storage, key: string): string {
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeStorageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode / restricted contexts).
  }
}

function createDeviceId(): string {
  const api = globalThis.crypto as Crypto | undefined;
  if (api?.randomUUID) {
    return `dev_${api.randomUUID().replaceAll('-', '')}`;
  }
  return `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

(function initDeviceId() {
  const existing = safeStorageGet(localStorage, 'nsv_device_id');
  if (!existing) {
    safeStorageSet(localStorage, 'nsv_device_id', createDeviceId());
  }
})();

// ── Extract and store server auth token from URL ─────────────────────────────
// The QR code URL includes ?t=<token>. We extract it on first load, store it
// in sessionStorage (survives navigations but not tab close), and strip it from
// the URL to avoid leaking it in referrer headers or browser history.
(function initAuthToken() {
  const params = new URLSearchParams(globalThis.location.search);
  const token = params.get('t');
  if (token) {
    safeStorageSet(sessionStorage, 'nsv_token', token);
    // Clean the URL without reloading
    params.delete('t');
    const clean = params.toString();
    const newUrl =
      globalThis.location.pathname + (clean ? `?${clean}` : '') + globalThis.location.hash;
    globalThis.history.replaceState({}, '', newUrl);
  }
})();

// ── Patch global fetch to auto-inject auth token on API calls ────────────────
(function patchFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }
    // Only inject token on our own API calls
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      const token = safeStorageGet(sessionStorage, 'nsv_token');
      const deviceId = safeStorageGet(localStorage, 'nsv_device_id');
      const headers = new Headers(init?.headers);
      if (token) {
        if (!headers.has('x-nsv-token')) {
          headers.set('x-nsv-token', token);
        }
      }
      if (deviceId && !headers.has('x-nsv-device-id')) {
        headers.set('x-nsv-device-id', deviceId);
      }
      init = { ...init, headers };
    }
    return originalFetch.call(globalThis, input, init);
  };
})();

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
        <div
          style={{ padding: '20px', color: '#f7f8ff', background: '#07080f', minHeight: '100vh' }}
        >
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

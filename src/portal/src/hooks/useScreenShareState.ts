import { useState, useEffect } from 'react';
import type { ScreenShareSessionState } from '../../shared/types';

const defaultState: ScreenShareSessionState = {
  active: false,
  sessionId: null,
  sourceLabel: null,
  sourceType: null,
  streamReady: false,
  streamMessage: null,
  interactive: false,
  currentViewers: 0,
  maxViewers: 0,
  startedAt: null,
};

export function useScreenShareState() {
  const [state, setState] = useState<ScreenShareSessionState>(defaultState);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const response = await fetch('/api/screenshare/state');
        if (!response.ok) return;
        const payload = (await response.json()) as ScreenShareSessionState;
        if (mounted) {
          setState(payload);
        }
      } catch {
        // Keep current state if endpoint is not reachable.
      }
    };

    void load();
    const timer = globalThis.setInterval(() => {
      void load();
    }, 3000);

    return () => {
      mounted = false;
      globalThis.clearInterval(timer);
    };
  }, []);

  return { state, setState };
}

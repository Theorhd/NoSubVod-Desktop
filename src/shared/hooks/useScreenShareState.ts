import { useState, useCallback, useEffect } from 'react';
import { ScreenShareSessionState } from '../types';
import { useInterval } from './useInterval';

export const DEFAULT_SCREEN_SHARE_STATE: ScreenShareSessionState = {
  active: false,
  sessionId: null,
  sourceType: null,
  sourceLabel: null,
  startedAt: null,
  interactive: true,
  maxViewers: 5,
  currentViewers: 0,
  streamReady: false,
  streamMessage: null,
};

export function useScreenShareState(
  fetcher: () => Promise<ScreenShareSessionState>,
  pollingInterval = 3000
) {
  const [state, setState] = useState<ScreenShareSessionState>(DEFAULT_SCREEN_SHARE_STATE);
  const [loading, setLoading] = useState(true);

  const updateState = useCallback(async () => {
    try {
      const newState = await fetcher();
      setState(newState);
    } catch {
      // In production, we might want to be less noisy or handle specific errors
      // console.warn('[useScreenShareState] Update failed:', err);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void updateState();
  }, [updateState]);

  useInterval(updateState, pollingInterval);

  return { state, setState, loading, refresh: updateState };
}

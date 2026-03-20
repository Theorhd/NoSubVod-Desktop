import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenShareSessionState } from '../../shared/types';
import { TopBar } from './components/TopBar';

const defaultState: ScreenShareSessionState = {
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

function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return 'Not started';
  const date = new Date(startedAt);
  return date.toLocaleString();
}

type JoinRole = 'host' | 'viewer';

type SignalPayload = {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type RemoteInputPayload = {
  kind: 'pointer' | 'keyboard';
  action: 'move' | 'down' | 'up' | 'wheel';
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  key?: string;
  deltaX?: number;
  deltaY?: number;
};

type WsMessage = {
  type?: string;
  state?: ScreenShareSessionState;
  message?: string;
  clientId?: string;
  hostClientId?: string | null;
  role?: string;
  from?: string;
  target?: string;
  payload?: SignalPayload;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export default function ScreenShare() {
  const [state, setState] = useState<ScreenShareSessionState>(defaultState);
  const [isStopping, setIsStopping] = useState(false);
  const [signalStatus, setSignalStatus] = useState('Disconnected');
  const [rtcStatus, setRtcStatus] = useState('Idle');
  const [isHostMode, setIsHostMode] = useState(false);
  const [hostStreaming, setHostStreaming] = useState(false);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [snapshotAvailable, setSnapshotAvailable] = useState(true);
  const [streamError, setStreamError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const roleRef = useRef<JoinRole>('viewer');
  const clientIdRef = useRef<string | null>(null);
  const hostClientIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const waitingViewerIdsRef = useRef<Set<string>>(new Set());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLButtonElement | null>(null);
  const lastPointerMoveRef = useRef(0);

  const getAuthQuery = () => {
    const token =
      globalThis.sessionStorage.getItem('nsv_token') || globalThis.localStorage.getItem('nsv_token');
    const deviceId = globalThis.localStorage.getItem('nsv_device_id');
    const params = new URLSearchParams();
    if (token) {
      params.set('t', token);
    }
    if (deviceId) {
      params.set('d', deviceId);
    }
    return params.toString();
  };

  const sendWs = (payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(payload));
  };

  const sendRemoteInput = (payload: RemoteInputPayload) => {
    if (isHostMode || !hasRemoteStream || !state.interactive) {
      return;
    }

    sendWs({
      type: 'input',
      payload,
    });
  };

  const pointerButtonFromMouseEvent = (button: number): 'left' | 'middle' | 'right' => {
    if (button === 1) return 'middle';
    if (button === 2) return 'right';
    return 'left';
  };

  const normalizedPointerPosition = (event: React.MouseEvent<HTMLButtonElement>) => {
    const surface = viewerSurfaceRef.current;
    if (!surface) {
      return { x: 0.5, y: 0.5 };
    }

    const rect = surface.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));

    return {
      x: Number.isFinite(x) ? x : 0.5,
      y: Number.isFinite(y) ? y : 0.5,
    };
  };

  const cleanupViewerPeer = () => {
    const peer = viewerPeerRef.current;
    if (peer) {
      peer.close();
      viewerPeerRef.current = null;
    }
  };

  const cleanupHostPeer = (viewerId: string) => {
    const peer = hostPeersRef.current.get(viewerId);
    if (!peer) return;
    peer.close();
    hostPeersRef.current.delete(viewerId);
  };

  const stopLocalStream = () => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setHostStreaming(false);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    for (const viewerId of hostPeersRef.current.keys()) {
      cleanupHostPeer(viewerId);
    }
  };

  const ensureViewerPeer = async (hostId: string): Promise<RTCPeerConnection> => {
    const existing = viewerPeerRef.current;
    if (existing) return existing;

    const peer = new RTCPeerConnection(rtcConfig);
    viewerPeerRef.current = peer;

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      
      setHasRemoteStream(true);
      setStreamError('');

      // Mount may not have happened yet, so we wait for remoteVideoRef
      let retries = 0;
      const attachStream = () => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        } else if (retries < 20) {
          retries++;
          setTimeout(attachStream, 50);
        }
      };
      attachStream();
    };

    peer.onconnectionstatechange = () => {
      console.log('Viewer connection state:', peer.connectionState);
      if (peer.connectionState === 'connected') {
        setRtcStatus('WebRTC live (viewer)');
      } else if (peer.connectionState === 'failed') {
        setStreamError('WebRTC connection failed');
      }
    };

    peer.onicecandidateerror = (event: Event) => {
      console.error('Viewer ICE error:', event);
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendWs({
        type: 'signal',
        target: hostId,
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    return peer;
  };

  const createHostPeer = async (viewerId: string): Promise<RTCPeerConnection | null> => {
    const stream = localStreamRef.current;
    if (!stream) {
      waitingViewerIdsRef.current.add(viewerId);
      return null;
    }

    const existing = hostPeersRef.current.get(viewerId);
    if (existing) return existing;

    const peer = new RTCPeerConnection(rtcConfig);
    hostPeersRef.current.set(viewerId, peer);

    for (const track of stream.getTracks()) {
      peer.addTrack(track, stream);
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendWs({
        type: 'signal',
        target: viewerId,
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        cleanupHostPeer(viewerId);
      }
    };

    const offer = await peer.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await peer.setLocalDescription(offer);
    sendWs({
      type: 'signal',
      target: viewerId,
      payload: { sdp: offer },
    });

    return peer;
  };

  const handleSignalSdp = async (from: string, sdp: RTCSessionDescriptionInit) => {
    if (roleRef.current === 'host') {
      const peer = hostPeersRef.current.get(from);
      if (!peer) return;
      if (sdp.type === 'answer') {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(sdp));
          setRtcStatus('WebRTC live (host)');
        } catch (error: any) {
          console.error('Failed to set remote description on host:', error);
          setStreamError(`Host WebRTC error: ${error.message}`);
        }
      }
      return;
    }

    const peer = await ensureViewerPeer(from);
    if (sdp.type !== 'offer') return;

    try {
      await peer.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendWs({
        type: 'signal',
        target: from,
        payload: { sdp: answer },
      });
      setRtcStatus('WebRTC negotiating (viewer)');
    } catch (error: any) {
      console.error('Failed to handle offer on viewer:', error);
      setStreamError(`Viewer WebRTC error: ${error.message}`);
    }
  };

  const handleSignalCandidate = async (from: string, candidate: RTCIceCandidateInit) => {
    if (roleRef.current === 'host') {
      const peer = hostPeersRef.current.get(from);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
      return;
    }

    const hostId = hostClientIdRef.current;
    if (!hostId || from !== hostId) return;
    const peer = await ensureViewerPeer(from);
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  };

  const handleSignalMessage = async (message: WsMessage) => {
    const target = message.target;
    const me = clientIdRef.current;
    if (target && me && target !== me) {
      console.warn('Signal routed to wrong target', { target, me });
      return;
    }

    const from = message.from;
    const payload = message.payload;
    if (!from || !payload) {
      console.warn('Incomplete signal message dropped', message);
      return;
    }

    if (payload.sdp) {
      await handleSignalSdp(from, payload.sdp);
      return;
    }

    if (payload.candidate) {
      await handleSignalCandidate(from, payload.candidate);
    }
  };

  const handleWelcomeMessage = (message: WsMessage) => {
    if (message.state) {
      setState(message.state);
    }
    clientIdRef.current = message.clientId || null;
    hostClientIdRef.current = message.hostClientId || null;

    const hostIntentSession = localStorage.getItem('nsv_screenshare_host_session');
    const shouldJoinAsHost = !!(
      hostIntentSession && message.state?.sessionId && hostIntentSession === message.state.sessionId
    );
    const role: JoinRole = shouldJoinAsHost ? 'host' : 'viewer';
    roleRef.current = role;
    setIsHostMode(role === 'host');
    sendWs({ type: 'join', role });
  };

  const handlePeerJoinedMessage = (message: WsMessage) => {
    if (!message.clientId) return;

    if (message.role === 'viewer') {
      if (roleRef.current === 'host') {
        void createHostPeer(message.clientId);
      }
      return;
    }

    if (message.role === 'host') {
      hostClientIdRef.current = message.clientId;
    }
  };

  const handlePeerLeftMessage = (message: WsMessage) => {
    if (!message.clientId) return;

    if (message.role === 'host') {
      hostClientIdRef.current = null;
      cleanupViewerPeer();
      setHasRemoteStream(false);
      setRtcStatus('Host disconnected');
      return;
    }

    if (message.role === 'viewer') {
      cleanupHostPeer(message.clientId);
      waitingViewerIdsRef.current.delete(message.clientId);
    }
  };

  const applyWsMessage = (message: WsMessage) => {
    switch (message.type) {
      case 'welcome':
        handleWelcomeMessage(message);
        return;
      case 'session-state':
        if (message.state) {
          setState(message.state);
        }
        return;
      case 'peer-joined':
        handlePeerJoinedMessage(message);
        return;
      case 'peer-left':
        handlePeerLeftMessage(message);
        return;
      case 'system':
        if (message.message) {
          setState((current) => ({ ...current, streamMessage: message.message ?? null }));
        }
        return;
      case 'signal':
        void handleSignalMessage(message);
        return;
      case 'error':
        if (message.message) {
          setStreamError(message.message);
        }
        return;
      default:
        return;
    }
  };

  const startHostWebRtc = async () => {
    setStreamError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      });

      localStreamRef.current = stream;
      setHostStreaming(true);
      setRtcStatus('WebRTC capturing (host)');

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const viewers = Array.from(waitingViewerIdsRef.current.values());
      waitingViewerIdsRef.current.clear();
      for (const viewerId of viewers) {
        await createHostPeer(viewerId);
      }

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopLocalStream();
          setRtcStatus('Host capture stopped');
        });
      }
    } catch (error: any) {
      setStreamError(error?.message || 'Unable to start WebRTC capture.');
      setRtcStatus('Host capture failed');
    }
  };

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

  useEffect(() => {
    if (!state.active) {
      setSnapshotAvailable(true);
      setStreamError('');
    }
  }, [state.active]);

  useEffect(() => {
    if (!state.active || state.sourceType !== 'browser') {
      return;
    }

    if (hasRemoteStream || !snapshotAvailable) {
      return;
    }

    const timer = globalThis.setInterval(() => {
      setSnapshotTick((tick) => tick + 1);
    }, 450);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [state.active, state.sourceType, hasRemoteStream, snapshotAvailable]);

  useEffect(() => {
    const host = globalThis.location.host;
    const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';

    let disposed = false;
    let pingTimer: ReturnType<typeof globalThis.setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const connect = () => {
      if (disposed) {
        return;
      }

      const authQuery = getAuthQuery();
      const wsPath = authQuery ? `/api/screenshare/ws?${authQuery}` : '/api/screenshare/ws';
      const wsUrl = `${protocol}://${host}${wsPath}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setSignalStatus('Connected');
        setRtcStatus('Signaling connected');
      });

      ws.addEventListener('close', () => {
        setSignalStatus('Disconnected');
        setRtcStatus('Signaling disconnected');
        cleanupViewerPeer();
        setHasRemoteStream(false);

        if (!disposed) {
          reconnectTimer = globalThis.setTimeout(connect, 1500);
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;
          applyWsMessage(message);
        } catch {
          // Ignore malformed realtime payloads.
        }
      });
    };

    connect();

    pingTimer = globalThis.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    return () => {
      disposed = true;
      if (pingTimer !== undefined) {
        globalThis.clearInterval(pingTimer);
      }
      if (reconnectTimer !== undefined) {
        globalThis.clearTimeout(reconnectTimer);
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.close();
      }
      cleanupViewerPeer();
      for (const viewerId of hostPeersRef.current.keys()) {
        cleanupHostPeer(viewerId);
      }
      stopLocalStream();
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (!state.active) return 'Offline';
    return state.streamReady ? 'Live' : 'Preparing';
  }, [state.active, state.streamReady]);

  const handleStop = async () => {
    setIsStopping(true);
    try {
      const response = await fetch('/api/screenshare/stop', { method: 'POST' });
      if (!response.ok) return;
      const payload = (await response.json()) as ScreenShareSessionState;
      setState(payload);
      const hostIntentSession = localStorage.getItem('nsv_screenshare_host_session');
      if (hostIntentSession && hostIntentSession === state.sessionId) {
        localStorage.removeItem('nsv_screenshare_host_session');
      }
      stopLocalStream();
      cleanupViewerPeer();
      setHasRemoteStream(false);
      setRtcStatus('Session stopped');
    } catch {
      // Keep current state on network failure.
    } finally {
      setIsStopping(false);
    }
  };

  const handleViewerMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    const now = performance.now();
    if (now - lastPointerMoveRef.current < 8) {
      return;
    }
    lastPointerMoveRef.current = now;

    const pos = normalizedPointerPosition(event);
    sendRemoteInput({
      kind: 'pointer',
      action: 'move',
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    const pos = normalizedPointerPosition(event);
    sendRemoteInput({
      kind: 'pointer',
      action: 'down',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    const pos = normalizedPointerPosition(event);
    sendRemoteInput({
      kind: 'pointer',
      action: 'up',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerWheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const surface = viewerSurfaceRef.current;
    const rect = surface?.getBoundingClientRect();
    const x = rect
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
      : 0.5;
    const y = rect
      ? Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))
      : 0.5;
    sendRemoteInput({
      kind: 'pointer',
      action: 'wheel',
      x,
      y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) {
      return;
    }
    sendRemoteInput({
      kind: 'keyboard',
      action: 'down',
      key: event.key,
    });
  };

  const handleViewerKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    sendRemoteInput({
      kind: 'keyboard',
      action: 'up',
      key: event.key,
    });
  };

  let feedContent: React.ReactNode;
  if (isHostMode) {
    feedContent = (
      <video ref={localVideoRef} className="screen-share-video" autoPlay muted playsInline>
        <track kind="captions" />
      </video>
    );
  } else if (hasRemoteStream) {
    feedContent = (
      <button
        ref={viewerSurfaceRef}
        type="button"
        className="screen-share-remote-surface"
        aria-label="Interactive remote stream"
        onMouseMove={handleViewerMouseMove}
        onMouseDown={handleViewerMouseDown}
        onMouseUp={handleViewerMouseUp}
        onWheel={handleViewerWheel}
        onKeyDown={handleViewerKeyDown}
        onKeyUp={handleViewerKeyUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <video ref={remoteVideoRef} className="screen-share-video" autoPlay playsInline>
          <track kind="captions" />
        </video>
      </button>
    );
  } else if (state.active && state.sourceType === 'browser' && snapshotAvailable) {
    const authQuery = getAuthQuery();
    feedContent = (
      <img
        key={snapshotTick}
        className="screen-share-preview"
        src={
          authQuery
            ? `/api/screenshare/snapshot.jpg?tick=${snapshotTick}&${authQuery}`
            : `/api/screenshare/snapshot.jpg?tick=${snapshotTick}`
        }
        alt="Screen share browser preview"
        onError={() => {
          setSnapshotAvailable(false);
          if (!hasRemoteStream) {
            setStreamError('Snapshot fallback unavailable. Waiting for host WebRTC stream.');
          }
        }}
      />
    );
  } else {
    feedContent = <div className="screen-share-placeholder">Live preview coming next.</div>;
  }

  return (
    <>
      <TopBar title="Screen Share" mode="home" />
      <div className="container">
        <div className="card">
          <h2>Screen Share Session</h2>
          <p className="card-subtitle">State of the host broadcast for all devices.</p>

          <div className="kv-grid">
            <div>
              <strong>Status</strong>
              <div>{statusLabel}</div>
            </div>
            <div>
              <strong>Source</strong>
              <div>{state.sourceLabel || 'No source selected'}</div>
            </div>
            <div>
              <strong>Type</strong>
              <div>{state.sourceType || 'n/a'}</div>
            </div>
            <div>
              <strong>Interactive</strong>
              <div>{state.interactive ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div>
              <strong>Viewers</strong>
              <div>{state.currentViewers}/{state.maxViewers}</div>
            </div>
            <div>
              <strong>Signal</strong>
              <div>{signalStatus}</div>
            </div>
            <div>
              <strong>WebRTC</strong>
              <div>{rtcStatus}</div>
            </div>
            <div>
              <strong>Started At</strong>
              <div>{formatStartedAt(state.startedAt)}</div>
            </div>
          </div>

          <div className="status-line" style={{ marginTop: 14 }}>
            {state.streamMessage || 'Waiting for a host to start a screen share session.'}
          </div>

          {state.active && (
            <div className="btn-row">
              <button
                className="action-btn cancel"
                disabled={isStopping}
                onClick={() => void handleStop()}
                type="button"
              >
                {isStopping ? 'Stopping...' : 'Stop session'}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Viewer Feed</h3>
          <p className="card-subtitle">
            WebRTC direct stream (optimized latency/performance) with HD capture.
          </p>
          {streamError && <div className="error-text">{streamError}</div>}

          {isHostMode && state.active && state.sourceType === 'browser' && (
            <div className="screen-share-host-actions">
              <button
                className="action-btn"
                disabled={hostStreaming}
                onClick={() => void startHostWebRtc()}
                type="button"
              >
                {hostStreaming ? 'WebRTC HD active' : 'Activer flux WebRTC HD (60 fps)'}
              </button>
              {hostStreaming && (
                <button className="action-btn cancel" onClick={stopLocalStream} type="button">
                  Stop host capture
                </button>
              )}
            </div>
          )}

          {feedContent}
        </div>
      </div>
    </>
  );
}

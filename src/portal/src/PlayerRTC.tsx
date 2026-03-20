import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ScreenShareSessionState } from '../../shared/types';

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

function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return 'Not started';
  const date = new Date(startedAt);
  return date.toLocaleString();
}

export default function PlayerRTC() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const [state, setState] = useState<ScreenShareSessionState>(defaultState);
  const [signalStatus, setSignalStatus] = useState('Disconnected');
  const [rtcStatus, setRtcStatus] = useState('Idle');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [streamError, setStreamError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const hostClientIdRef = useRef<string | null>(null);
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLButtonElement | null>(null);
  const lastPointerMoveRef = useRef(0);

  const getAuthQuery = () => {
    const token =
      globalThis.sessionStorage.getItem('nsv_token') ||
      globalThis.localStorage.getItem('nsv_token');
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
    if (!hasRemoteStream || !state.interactive) {
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
      if (peer.connectionState === 'connected') {
        setRtcStatus('WebRTC live (viewer)');
      } else if (peer.connectionState === 'failed') {
        setStreamError('WebRTC connection failed');
      }
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const hostIdCurrent = hostClientIdRef.current;
      if (!hostIdCurrent) return;
      sendWs({
        type: 'signal',
        target: hostIdCurrent,
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    peer.onicecandidateerror = (event: Event) => {
      console.error('Viewer ICE error:', event);
    };

    return peer;
  };

  const handleSignalSdp = async (from: string, sdp: RTCSessionDescriptionInit) => {
    const hostId = hostClientIdRef.current;
    if (!hostId || from !== hostId) return;
    if (sdp.type !== 'offer') return;

    try {
      const peer = await ensureViewerPeer(hostId);
      await peer.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendWs({
        type: 'signal',
        target: hostId,
        payload: { sdp: answer },
      });
      setRtcStatus('WebRTC negotiating (viewer)');
    } catch (error: any) {
      console.error('Failed to handle offer on viewer:', error);
      setStreamError(`Viewer WebRTC error: ${error.message}`);
    }
  };

  const handleSignalCandidate = async (from: string, candidate: RTCIceCandidateInit) => {
    const hostId = hostClientIdRef.current;
    if (!hostId || from !== hostId) return;
    const peer = await ensureViewerPeer(hostId);
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  };

  const handleSignalMessage = async (message: WsMessage) => {
    const target = message.target;
    const me = clientIdRef.current;
    if (target && me && target !== me) {
      return;
    }

    const from = message.from;
    const payload = message.payload;
    if (!from || !payload) {
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

    const joinPayload: Record<string, unknown> = { type: 'join', role: 'viewer' };
    if (sessionIdParam) {
      joinPayload.sessionId = sessionIdParam;
    }
    sendWs(joinPayload);
  };

  const handlePeerJoinedMessage = (message: WsMessage) => {
    if (message.role === 'host') {
      hostClientIdRef.current = message.clientId || null;
    }
  };

  const handlePeerLeftMessage = (message: WsMessage) => {
    if (message.role === 'host') {
      hostClientIdRef.current = null;
      cleanupViewerPeer();
      setHasRemoteStream(false);
      setRtcStatus('Host disconnected');
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
      case 'signal':
        void handleSignalMessage(message);
        return;
      case 'system':
        if (message.message) {
          setState((current) => ({ ...current, streamMessage: message.message ?? null }));
        }
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
    const host = globalThis.location.host;
    const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';

    let disposed = false;
    let pingTimer: ReturnType<typeof globalThis.setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const connect = () => {
      if (disposed) {
        return;
      }

      const wsParams = new URLSearchParams(getAuthQuery());
      if (sessionIdParam) {
        wsParams.set('sessionId', sessionIdParam);
      }
      const wsPath = wsParams.toString()
        ? `/api/screenshare/ws?${wsParams.toString()}`
        : '/api/screenshare/ws';
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
    };
  }, [sessionIdParam]);

  useEffect(() => {
    if (hasRemoteStream && viewerSurfaceRef.current) {
      viewerSurfaceRef.current.focus();
    }
  }, [hasRemoteStream]);

  const statusLabel = useMemo(() => {
    if (!state.active) return 'Offline';
    return state.streamReady ? 'Live' : 'Preparing';
  }, [state.active, state.streamReady]);

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

  const handleBack = () => {
    if (globalThis.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/screen-share');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100dvh',
        backgroundColor: '#07080f',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          backgroundColor: '#18181b',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #3a3a3d',
          zIndex: 10,
          flexShrink: 0,
          gap: '10px',
        }}
      >
        <button
          onClick={handleBack}
          style={{
            color: '#efeff1',
            fontSize: '14px',
            fontWeight: 'bold',
            padding: '5px 10px',
            backgroundColor: '#3a3a3d',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
          }}
          type="button"
        >
          Back
        </button>

        <h2
          style={{
            color: 'white',
            fontSize: '14px',
            margin: 0,
            flexGrow: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Screen Share
        </h2>

        <span style={{ color: '#efeff1', fontSize: '12px' }}>
          {statusLabel} · {signalStatus} · {rtcStatus}
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
            position: 'relative',
          }}
        >
          {hasRemoteStream ? (
            <button
              ref={viewerSurfaceRef}
              type="button"
              className="screen-share-remote-surface"
              style={{
                touchAction: 'none',
                border: 'none',
                padding: 0,
                background: 'transparent',
                width: '100%',
                height: '100%',
              }}
              aria-label="Interactive remote stream"
              onMouseMove={handleViewerMouseMove}
              onMouseDown={handleViewerMouseDown}
              onMouseUp={handleViewerMouseUp}
              onWheelCapture={handleViewerWheel}
              onKeyDown={handleViewerKeyDown}
              onKeyUp={handleViewerKeyUp}
              onContextMenu={(event) => event.preventDefault()}
              onClick={() => viewerSurfaceRef.current?.focus()}
            >
              <video
                ref={remoteVideoRef}
                className="screen-share-video"
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              >
                <track kind="captions" />
              </video>
            </button>
          ) : (
            <div
              style={{
                color: '#efeff1',
                textAlign: 'center',
                padding: '24px',
              }}
            >
              <div style={{ fontSize: '18px', marginBottom: '8px' }}>Waiting for host stream...</div>
              <div style={{ color: '#a1a1aa', fontSize: '14px' }}>
                {state.streamMessage || 'When the host starts sharing, the WebRTC feed will appear here.'}
              </div>
            </div>
          )}

          {streamError && (
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '8px 12px',
                borderRadius: '6px',
                color: '#ff9c9c',
                fontSize: '13px',
              }}
            >
              {streamError}
            </div>
          )}
        </div>

        <div
          style={{
            width: '320px',
            backgroundColor: '#0e0e10',
            borderLeft: '1px solid #3a3a3d',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Session</div>
            <div style={{ color: '#efeff1', fontSize: '14px', fontWeight: 'bold' }}>
              {state.sessionId || 'Not started'}
            </div>
          </div>

          <div>
            <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Source</div>
            <div style={{ color: '#efeff1', fontSize: '14px', fontWeight: 'bold' }}>
              {state.sourceLabel || 'No source'} ({state.sourceType || 'n/a'})
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Status</div>
              <div style={{ color: '#efeff1', fontSize: '14px' }}>{statusLabel}</div>
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Viewers</div>
              <div style={{ color: '#efeff1', fontSize: '14px' }}>
                {state.currentViewers}/{state.maxViewers}
              </div>
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Signal</div>
              <div style={{ color: '#efeff1', fontSize: '14px' }}>{signalStatus}</div>
            </div>
            <div>
              <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>WebRTC</div>
              <div style={{ color: '#efeff1', fontSize: '14px' }}>{rtcStatus}</div>
            </div>
          </div>

          <div>
            <div style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>Started</div>
            <div style={{ color: '#efeff1', fontSize: '14px' }}>{formatStartedAt(state.startedAt)}</div>
          </div>

          <div style={{ color: '#a1a1aa', fontSize: '12px', marginTop: '8px' }}>
            {state.interactive
              ? 'Pointer/keyboard input forwarded to host.'
              : 'Remote control disabled by host.'}
          </div>
        </div>
      </div>
    </div>
  );
}

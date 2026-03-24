import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShareSessionState, WsMessage, RemoteInputPayload } from '../../shared/types';
import { TopBar } from './components/TopBar';
import { useScreenShareState } from '../../shared/hooks/useScreenShareState';
import { useInterval } from '../../shared/hooks/useInterval';
import {
  formatStartedAt,
  pointerButtonFromMouseEvent,
  normalizedPointerPosition,
} from '../../shared/utils/player';

export default function ScreenShare() {
  const navigate = useNavigate();

  const fetchScreenShareState = useCallback(async () => {
    const response = await fetch('/api/screenshare/state');
    if (!response.ok) throw new Error('Failed to fetch state');
    return (await response.json()) as ScreenShareSessionState;
  }, []);

  const { state, setState } = useScreenShareState(fetchScreenShareState, 3000);

  const [isStopping, setIsStopping] = useState(false);
  const [signalStatus, setSignalStatus] = useState('Disconnected');
  const [rtcStatus, setRtcStatus] = useState('Idle');
  const [isHostMode, setIsHostMode] = useState(false);
  const [hostStreaming, setHostStreaming] = useState(false);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
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

  const getAuthQuery = useCallback(() => {
    const token =
      globalThis.sessionStorage.getItem('nsv_token') ||
      globalThis.localStorage.getItem('nsv_token');
    const deviceId = globalThis.localStorage.getItem('nsv_device_id');
    const params = new URLSearchParams();
    if (token) params.set('t', token);
    if (deviceId) params.set('d', deviceId);
    return params.toString();
  }, []);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const sendRemoteInput = useCallback(
    (payload: RemoteInputPayload) => {
      if (isHostMode || !hasRemoteStream || !state.interactive) return;
      sendWs({ type: 'input', payload });
    },
    [hasRemoteStream, isHostMode, sendWs, state.interactive]
  );

  const cleanupViewerPeer = useCallback(() => {
    const peer = viewerPeerRef.current;
    if (peer) {
      peer.close();
      viewerPeerRef.current = null;
    }
  }, []);

  const cleanupHostPeer = useCallback((viewerId: string) => {
    const peer = hostPeersRef.current.get(viewerId);
    if (!peer) return;
    peer.close();
    hostPeersRef.current.delete(viewerId);
  }, []);

  const stopLocalStream = useCallback(() => {
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
  }, [cleanupHostPeer]);

  const ensureViewerPeer = useCallback(
    async (hostId: string): Promise<RTCPeerConnection> => {
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
        sendWs({
          type: 'signal',
          target: hostId,
          payload: { candidate: event.candidate.toJSON() },
        });
      };

      return peer;
    },
    [sendWs]
  );

  const createHostPeer = useCallback(
    async (viewerId: string): Promise<RTCPeerConnection | null> => {
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

      const offer = await peer.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await peer.setLocalDescription(offer);
      sendWs({ type: 'signal', target: viewerId, payload: { sdp: offer } });

      return peer;
    },
    [cleanupHostPeer, sendWs]
  );

  const handleSignalSdp = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      if (roleRef.current === 'host') {
        const peer = hostPeersRef.current.get(from);
        if (!peer) return;
        if (sdp.type === 'answer') {
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(sdp));
            setRtcStatus('WebRTC live (host)');
          } catch (error: any) {
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
        sendWs({ type: 'signal', target: from, payload: { sdp: answer } });
        setRtcStatus('WebRTC negotiating (viewer)');
      } catch (error: any) {
        setStreamError(`Viewer WebRTC error: ${error.message}`);
      }
    },
    [ensureViewerPeer, sendWs]
  );

  const handleSignalCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      if (roleRef.current === 'host') {
        const peer = hostPeersRef.current.get(from);
        if (peer) await peer.addIceCandidate(new RTCIceCandidate(candidate));
        return;
      }

      const hostId = hostClientIdRef.current;
      if (!hostId || from !== hostId) return;
      const peer = await ensureViewerPeer(from);
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    },
    [ensureViewerPeer]
  );

  const handleSignalMessage = useCallback(
    async (message: WsMessage) => {
      const target = message.target;
      const me = clientIdRef.current;
      if (target && me && target !== me) return;

      const from = message.from;
      const payload = message.payload;
      if (!from || !payload) return;

      if (payload.sdp) {
        await handleSignalSdp(from, payload.sdp);
      } else if (payload.candidate) {
        await handleSignalCandidate(from, payload.candidate);
      }
    },
    [handleSignalCandidate, handleSignalSdp]
  );

  const handleWelcomeMessage = useCallback(
    (message: WsMessage) => {
      if (message.state) setState(message.state);
      clientIdRef.current = message.clientId || null;
      hostClientIdRef.current = message.hostClientId || null;

      const hostIntentSession = localStorage.getItem('nsv_screenshare_host_session');
      const shouldJoinAsHost = !!(
        hostIntentSession &&
        message.state?.sessionId &&
        hostIntentSession === message.state.sessionId
      );
      const role: JoinRole = shouldJoinAsHost ? 'host' : 'viewer';
      roleRef.current = role;
      setIsHostMode(role === 'host');
      sendWs({ type: 'join', role });
    },
    [sendWs, setState]
  );

  const handlePeerJoinedMessage = useCallback(
    (message: WsMessage) => {
      if (!message.clientId) return;
      if (message.role === 'viewer') {
        if (roleRef.current === 'host') createHostPeer(message.clientId);
      } else if (message.role === 'host') {
        hostClientIdRef.current = message.clientId;
      }
    },
    [createHostPeer]
  );

  const handlePeerLeftMessage = useCallback(
    (message: WsMessage) => {
      if (!message.clientId) return;
      if (message.role === 'host') {
        hostClientIdRef.current = null;
        cleanupViewerPeer();
        setHasRemoteStream(false);
        setRtcStatus('Host disconnected');
      } else if (message.role === 'viewer') {
        cleanupHostPeer(message.clientId);
        waitingViewerIdsRef.current.delete(message.clientId);
      }
    },
    [cleanupHostPeer, cleanupViewerPeer]
  );

  const handleControlMessage = useCallback((message: WsMessage) => {
    if (roleRef.current !== 'host') return;
    const payload = message.payload as unknown as { command: string; value?: number };
    if (!payload) return;

    const cmd = payload.command;
    const val = payload.value ?? 0;

    document.querySelectorAll('video').forEach((v) => {
      try {
        switch (cmd) {
          case 'play':
            v.play().catch(() => {});
            break;
          case 'pause':
            v.pause();
            break;
          case 'seek':
            v.currentTime += val;
            break;
          case 'volume':
            v.volume = val;
            break;
          case 'mute':
            v.muted = !v.muted;
            break;
        }
      } catch {
        /* Ignore */
      }
    });
  }, []);

  const handleWsMessage = useCallback(
    (message: WsMessage) => {
      switch (message.type) {
        case 'welcome':
          handleWelcomeMessage(message);
          break;
        case 'session-state':
          if (message.state) setState(message.state);
          break;
        case 'peer-joined':
          handlePeerJoinedMessage(message);
          break;
        case 'peer-left':
          handlePeerLeftMessage(message);
          break;
        case 'system':
          if (message.message)
            setState((current) => ({ ...current, streamMessage: message.message ?? null }));
          break;
        case 'signal':
          handleSignalMessage(message);
          break;
        case 'control':
          handleControlMessage(message);
          break;
        case 'error':
          if (message.message) setStreamError(message.message);
          break;
      }
    },
    [
      handleControlMessage,
      handlePeerJoinedMessage,
      handlePeerLeftMessage,
      handleSignalMessage,
      handleWelcomeMessage,
      setState,
    ]
  );

  const startHostWebRtc = useCallback(async () => {
    setStreamError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          systemAudio: 'include' as any,
        },
      });

      if (stream.getAudioTracks().length === 0) {
        setStreamError(
          'Attention : Le flux n\'a pas de son ! Il faut choisir "Ecran complet" ou "Onglet" et COCHER LA CASE "Partager l\'audio du système" !'
        );
      }

      localStreamRef.current = stream;
      setHostStreaming(true);
      setRtcStatus('WebRTC capturing (host)');

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const viewers = Array.from(waitingViewerIdsRef.current.values());
      waitingViewerIdsRef.current.clear();
      for (const viewerId of viewers) await createHostPeer(viewerId);

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
  }, [createHostPeer, stopLocalStream]);

  useEffect(() => {
    if (!state.active) {
      setSnapshotAvailable(true);
      setSnapshotUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      setStreamError('');
    }
  }, [state.active]);

  const loadSnapshot = useCallback(async () => {
    if (!state.active || state.sourceType !== 'browser' || hasRemoteStream || !snapshotAvailable)
      return;
    const authQuery = getAuthQuery();
    const src = authQuery
      ? `/api/screenshare/snapshot.jpg?tick=${Date.now()}&${authQuery}`
      : `/api/screenshare/snapshot.jpg?tick=${Date.now()}`;
    try {
      const response = await fetch(src, { cache: 'no-store', headers: { Accept: 'image/*' } });
      if (!response.ok) throw new Error(`snapshot-http-${response.status}`);
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setSnapshotUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    } catch {
      setSnapshotAvailable(false);
      if (!hasRemoteStream)
        setStreamError('Snapshot fallback unavailable. Waiting for host WebRTC stream.');
    }
  }, [getAuthQuery, hasRemoteStream, snapshotAvailable, state.active, state.sourceType]);

  useInterval(loadSnapshot, 450);

  useEffect(() => {
    const host = globalThis.location.host;
    const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';
    let disposed = false;
    let reconnectTimer: any;

    const connect = () => {
      if (disposed) return;
      const authQueryString = authQuery ? `?${authQuery}` : '';
      const wsUrl = `${protocol}://${host}/api/screenshare/ws${authQueryString}`;
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
        if (!disposed) reconnectTimer = setTimeout(connect, 1500);
      });

      ws.addEventListener('message', (event) => {
        try {
          handleWsMessage(JSON.parse(event.data));
        } catch {
          /* Ignore */
        }
      });
    };

    connect();

    const pingTimer = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) sendWs({ type: 'ping' });
    }, 15000);

    const currentWs = wsRef.current;
    const currentHostPeers = hostPeersRef.current;
    const currentWaitingViewerIds = waitingViewerIdsRef.current;

    return () => {
      disposed = true;
      clearInterval(pingTimer);
      clearTimeout(reconnectTimer);
      if (currentWs?.readyState === WebSocket.OPEN) currentWs.close();
      cleanupViewerPeer();
      currentHostPeers.forEach((p) => p.close());
      currentHostPeers.clear();
      currentWaitingViewerIds.clear();
      stopLocalStream();
    };
  }, [cleanupViewerPeer, getAuthQuery, handleWsMessage, sendWs, stopLocalStream]);

  const statusLabel = useMemo(() => {
    if (!state.active) return 'Offline';
    return state.streamReady ? 'Live' : 'Preparing';
  }, [state.active, state.streamReady]);

  const handleStop = useCallback(async () => {
    setIsStopping(true);
    try {
      const response = await fetch('/api/screenshare/stop', { method: 'POST' });
      if (!response.ok) return;
      const payload = (await response.json()) as ScreenShareSessionState;
      setState(payload);
      const hostIntentSession = localStorage.getItem('nsv_screenshare_host_session');
      if (hostIntentSession === state.sessionId)
        localStorage.removeItem('nsv_screenshare_host_session');
      stopLocalStream();
      cleanupViewerPeer();
      setHasRemoteStream(false);
      setRtcStatus('Session stopped');
    } catch {
      /* Ignore */
    } finally {
      setIsStopping(false);
    }
  }, [cleanupViewerPeer, setState, state.sessionId, stopLocalStream]);

  const handleViewerMouseMove = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const now = performance.now();
      if (now - lastPointerMoveRef.current < 8) return;
      lastPointerMoveRef.current = now;
      const pos = normalizedPointerPosition(event);
      sendRemoteInput({ kind: 'pointer', action: 'move', x: pos.x, y: pos.y });
    },
    [sendRemoteInput]
  );

  const handleViewerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const pos = normalizedPointerPosition(event);
      sendRemoteInput({
        kind: 'pointer',
        action: 'down',
        button: pointerButtonFromMouseEvent(event.button),
        x: pos.x,
        y: pos.y,
      });
    },
    [sendRemoteInput]
  );

  const handleViewerMouseUp = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const pos = normalizedPointerPosition(event);
      sendRemoteInput({
        kind: 'pointer',
        action: 'up',
        button: pointerButtonFromMouseEvent(event.button),
        x: pos.x,
        y: pos.y,
      });
    },
    [sendRemoteInput]
  );

  const handleViewerWheel = useCallback(
    (event: React.WheelEvent<HTMLButtonElement>) => {
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
    },
    [sendRemoteInput]
  );

  const handleViewerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.repeat) return;
      sendRemoteInput({ kind: 'keyboard', action: 'down', key: event.key });
    },
    [sendRemoteInput]
  );

  const handleViewerKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      sendRemoteInput({ kind: 'keyboard', action: 'up', key: event.key });
    },
    [sendRemoteInput]
  );

  const feedContent = useMemo(() => {
    if (isHostMode) {
      return (
        <video ref={localVideoRef} className="screen-share-video" autoPlay muted playsInline>
          <track kind="captions" />
        </video>
      );
    } else if (hasRemoteStream) {
      return (
        <button
          ref={viewerSurfaceRef}
          type="button"
          className="screen-share-remote-surface"
          style={{ touchAction: 'none' }}
          aria-label="Interactive remote stream"
          onMouseMove={handleViewerMouseMove}
          onMouseDown={handleViewerMouseDown}
          onMouseUp={handleViewerMouseUp}
          onWheelCapture={handleViewerWheel}
          onKeyDown={handleViewerKeyDown}
          onKeyUp={handleViewerKeyUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <video ref={remoteVideoRef} className="screen-share-video" autoPlay playsInline>
            <track kind="captions" />
          </video>
        </button>
      );
    } else if (state.active && state.sourceType === 'browser' && snapshotAvailable && snapshotUrl) {
      return (
        <img
          className="screen-share-preview"
          src={snapshotUrl}
          alt="Screen share browser preview"
        />
      );
    } else if (state.active && state.sourceType === 'browser' && snapshotAvailable) {
      return <div className="screen-share-placeholder">Preparing preview…</div>;
    } else {
      return <div className="screen-share-placeholder">Live preview coming next.</div>;
    }
  }, [
    hasRemoteStream,
    handleViewerKeyDown,
    handleViewerKeyUp,
    handleViewerMouseDown,
    handleViewerMouseMove,
    handleViewerMouseUp,
    handleViewerWheel,
    isHostMode,
    snapshotAvailable,
    snapshotUrl,
    state.active,
    state.sourceType,
  ]);

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
              <div>
                {state.currentViewers}/{state.maxViewers}
              </div>
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
                onClick={handleStop}
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

          {state.active && (
            <div className="screen-share-host-actions">
              <button
                className="action-btn"
                type="button"
                onClick={() => {
                  const suffix = state.sessionId
                    ? `?screenshare=true&sessionId=${encodeURIComponent(state.sessionId)}`
                    : '?screenshare=true';
                  navigate(`/player${suffix}`);
                }}
              >
                Ouvrir dans le lecteur
              </button>
            </div>
          )}

          {isHostMode && state.active && state.sourceType === 'browser' && (
            <div className="screen-share-host-actions">
              <button
                className="action-btn"
                disabled={hostStreaming}
                onClick={startHostWebRtc}
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

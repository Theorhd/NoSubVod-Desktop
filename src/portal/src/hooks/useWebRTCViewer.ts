import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import type {
  ScreenShareSessionState,
  RemoteInputPayload,
  RemoteControlPayload,
  WsMessage,
} from '../../../shared/types';

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function useWebRTCViewer(
  sessionIdParam: string | null,
  state: ScreenShareSessionState,
  setState: Dispatch<SetStateAction<ScreenShareSessionState>>,
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>
) {
  const [signalStatus, setSignalStatus] = useState('Disconnected');
  const [rtcStatus, setRtcStatus] = useState('Idle');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [streamError, setStreamError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const hostClientIdRef = useRef<string | null>(null);
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const remoteInboundStreamRef = useRef<MediaStream | null>(null);

  const getAuthQuery = useCallback(() => {
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
  }, []);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(payload));
  }, []);

  const sendRemoteInput = useCallback(
    (payload: RemoteInputPayload) => {
      if (!hasRemoteStream || !state.interactive) {
        return;
      }

      sendWs({
        type: 'input',
        payload,
      });
    },
    [hasRemoteStream, state.interactive, sendWs]
  );

  const sendRemoteControl = useCallback(
    (payload: RemoteControlPayload) => {
      if (!hasRemoteStream) {
        return;
      }

      sendWs({
        type: 'control',
        payload,
      });
    },
    [hasRemoteStream, sendWs]
  );

  const cleanupViewerPeer = useCallback(() => {
    const peer = viewerPeerRef.current;
    if (peer) {
      peer.close();
      viewerPeerRef.current = null;
    }
    remoteInboundStreamRef.current = null;
  }, []);

  const ensureViewerPeer = useCallback(async (): Promise<RTCPeerConnection> => {
    const existing = viewerPeerRef.current;
    if (existing) return existing;

    const peer = new RTCPeerConnection(rtcConfig);
    viewerPeerRef.current = peer;

    peer.ontrack = (event) => {
      const inbound = remoteInboundStreamRef.current ?? new MediaStream();
      remoteInboundStreamRef.current = inbound;

      const incomingTrack = event.track;
      const hasTrack = inbound.getTracks().some((track) => track.id === incomingTrack.id);
      if (!hasTrack) {
        inbound.addTrack(incomingTrack);
      }

      setHasRemoteStream(true);
      const audioTracks = inbound.getAudioTracks();
      if (audioTracks.length === 0) {
        setStreamError("Flux recu sans piste audio depuis l'hote.");
      } else {
        setStreamError('');
      }

      let retries = 0;
      const attachStream = () => {
        if (!remoteVideoRef.current) {
          if (retries < 20) {
            retries++;
            setTimeout(attachStream, 50);
          }
          return;
        }

        // Re-assign a new MediaStream instance so the video element picks up newly added tracks (like audio after video).
        const newStream = event.streams?.[0] ?? new MediaStream(inbound.getTracks());
        if (remoteVideoRef.current.srcObject !== newStream) {
          remoteVideoRef.current.srcObject = newStream;
        }

        remoteVideoRef.current.play()?.catch(console.warn);
      };
      // Give the browser a microtask to settle tracks before attaching.
      setTimeout(attachStream, 10);
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
  }, [remoteVideoRef, sendWs]);

  const handleSignalSdp = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      const hostId = hostClientIdRef.current;
      if (!hostId || from !== hostId) return;
      if (sdp.type !== 'offer') return;

      try {
        const peer = await ensureViewerPeer();
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
    },
    [ensureViewerPeer, sendWs]
  );

  const handleSignalCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const hostId = hostClientIdRef.current;
      if (!hostId || from !== hostId) return;
      const peer = await ensureViewerPeer();
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    },
    [ensureViewerPeer]
  );

  const handleSignalMessage = useCallback(
    async (message: WsMessage) => {
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
    },
    [handleSignalCandidate, handleSignalSdp]
  );

  const handleWelcomeMessage = useCallback(
    (message: WsMessage) => {
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
    },
    [sessionIdParam, sendWs, setState]
  );

  const handlePeerJoinedMessage = useCallback((message: WsMessage) => {
    if (message.role === 'host') {
      hostClientIdRef.current = message.clientId || null;
    }
  }, []);

  const handlePeerLeftMessage = useCallback(
    (message: WsMessage) => {
      if (message.role === 'host') {
        hostClientIdRef.current = null;
        cleanupViewerPeer();
        setHasRemoteStream(false);
        setRtcStatus('Host disconnected');
      }
    },
    [cleanupViewerPeer]
  );

  const applyWsMessage = useCallback(
    (message: WsMessage) => {
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
            setState((current: ScreenShareSessionState) => ({
              ...current,
              streamMessage: message.message ?? null,
            }));
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
    },
    [
      handlePeerJoinedMessage,
      handlePeerLeftMessage,
      handleSignalMessage,
      handleWelcomeMessage,
      setState,
    ]
  );

  const applyWsMessageRef = useRef(applyWsMessage);
  useEffect(() => {
    applyWsMessageRef.current = applyWsMessage;
  }, [applyWsMessage]);

  useEffect(() => {
    const host = globalThis.location.host;
    const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';

    let disposed = false;
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
          applyWsMessageRef.current(message);
        } catch {
          // Ignore malformed realtime payloads.
        }
      });
    };

    connect();

    const pingTimer = globalThis.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    return () => {
      disposed = true;
      globalThis.clearInterval(pingTimer);
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
  }, [sessionIdParam, getAuthQuery, cleanupViewerPeer]);

  return {
    signalStatus,
    rtcStatus,
    hasRemoteStream,
    setHasRemoteStream,
    streamError,
    sendRemoteInput,
    sendRemoteControl,
  };
}

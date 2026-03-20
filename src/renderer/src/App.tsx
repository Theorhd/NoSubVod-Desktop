import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScreenShareSessionState, ServerInfo } from '../../shared/types';

const defaultScreenShareState: ScreenShareSessionState = {
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

export default function App() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [screenShare, setScreenShare] =
    useState<ScreenShareSessionState>(defaultScreenShareState);
  const [isBusy, setIsBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [hostRtcStatus, setHostRtcStatus] = useState('Idle');

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const waitingViewerIdsRef = useRef<Set<string>>(new Set());

  const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  type HostWsMessage = {
    type?: string;
    clientId?: string;
    role?: string;
    peers?: Array<{ clientId?: string; role?: string }>;
    from?: string;
    target?: string;
    payload?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    message?: string;
  };

  useEffect(() => {
    invoke<ServerInfo>('get_server_info')
      .then(setServerInfo)
      .catch((err) => {
        console.error('Failed to get server info:', err);
        // Fallback for browser-only development
        setServerInfo({
          ip: '127.0.0.1',
          port: 23455,
          url: 'https://127.0.0.1:5173',
          qrcode: '',
        });
      });
  }, []);

  useEffect(() => {
    const loadState = () => {
      invoke<ScreenShareSessionState>('get_screen_share_state')
        .then(setScreenShare)
        .catch((err) => {
          console.error('Failed to load screen share state:', err);
        });
    };

    loadState();
    const timer = globalThis.setInterval(loadState, 2000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const closeHostPeer = (viewerId: string) => {
    const peer = hostPeersRef.current.get(viewerId);
    if (!peer) return;
    peer.close();
    hostPeersRef.current.delete(viewerId);
  };

  const stopHostCapture = () => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    for (const viewerId of hostPeersRef.current.keys()) {
      closeHostPeer(viewerId);
    }
    setHostRtcStatus('Idle');
  };

  const sendWs = (payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  const createHostPeer = async (viewerId: string) => {
    const stream = localStreamRef.current;
    if (!stream) {
      waitingViewerIdsRef.current.add(viewerId);
      return;
    }

    const existing = hostPeersRef.current.get(viewerId);
    if (existing) return;

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
        closeHostPeer(viewerId);
      }
    };

    const offer = await peer.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: true });
    await peer.setLocalDescription(offer);
    sendWs({
      type: 'signal',
      target: viewerId,
      payload: { sdp: offer },
    });
  };

  const startHostCapture = async (sourceType: 'browser' | 'application') => {
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
      setHostRtcStatus('WebRTC capturing');
      setActionMessage(
        sourceType === 'browser'
          ? 'Selectionne la fenetre "NoSubVOD - Screen Share Browser" dans le picker Windows.'
          : 'Selectionne la fenetre de l application a diffuser dans le picker Windows.',
      );

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopHostCapture();
          setActionMessage('Capture arretee par l utilisateur.');
        });
      }

      const queuedViewers = Array.from(waitingViewerIdsRef.current.values());
      waitingViewerIdsRef.current.clear();
      for (const viewerId of queuedViewers) {
        await createHostPeer(viewerId);
      }
    } catch (err: any) {
      setHostRtcStatus('Capture failed');
      throw new Error(err?.message || 'Impossible de demarrer la capture ecran/fenetre.');
    }
  };

  const connectHostSignaling = async () => {
    if (!serverInfo) {
      throw new Error('Server info is not ready.');
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const portalUrl = new URL(serverInfo.url);
    const token = portalUrl.searchParams.get('t') || '';
    const wsUrl = `ws://127.0.0.1:${serverInfo.port}/api/screenshare/ws${
      token ? `?t=${encodeURIComponent(token)}` : ''
    }`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const openTimer = globalThis.setTimeout(() => {
        reject(new Error('WebSocket timeout while connecting host signaling.'));
      }, 8000);

      ws.addEventListener('open', () => {
        globalThis.clearTimeout(openTimer);
        setHostRtcStatus('Signaling connected');
        sendWs({ type: 'join', role: 'host' });
        resolve();
      });

      const handleHostSignal = (message: HostWsMessage) => {
        const target = message.target;
        const me = clientIdRef.current;
        if (target && me && target !== me) {
          return;
        }

        if (!message.from || !message.payload) {
          return;
        }

        const peer = hostPeersRef.current.get(message.from);
        if (!peer) {
          return;
        }

        if (message.payload.sdp?.type === 'answer') {
          void peer.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
          setHostRtcStatus('WebRTC live');
        }

        if (message.payload.candidate) {
          void peer.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
        }
      };

      const handleHostWsMessage = (message: HostWsMessage) => {
        switch (message.type) {
          case 'welcome':
            clientIdRef.current = message.clientId || null;
            return;
          case 'peer-joined':
            if (message.role === 'viewer' && message.clientId) {
              void createHostPeer(message.clientId);
            }
            return;
          case 'peers':
            for (const peer of message.peers || []) {
              if (peer.role === 'viewer' && peer.clientId) {
                void createHostPeer(peer.clientId);
              }
            }
            return;
          case 'peer-left':
            if (message.role === 'viewer' && message.clientId) {
              closeHostPeer(message.clientId);
              waitingViewerIdsRef.current.delete(message.clientId);
            }
            return;
          case 'signal':
            handleHostSignal(message);
            return;
          case 'error':
            if (message.message) {
              setActionMessage(message.message);
            }
            return;
          default:
            return;
        }
      };

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data) as HostWsMessage;
          handleHostWsMessage(message);
        } catch {
          // Ignore malformed WS messages.
        }
      });

      ws.addEventListener('close', () => {
        setHostRtcStatus('Signaling disconnected');
      });

      ws.addEventListener('error', () => {
        reject(new Error('Unable to establish host signaling WebSocket.'));
      });
    });
  };

  const startShare = async (sourceType: 'browser' | 'application') => {
    setIsBusy(true);
    setActionMessage('');
    try {
      if (sourceType === 'application') {
        // Application mode needs the picker before we touch signaling to keep user activation.
        await startHostCapture(sourceType);
      }

      const state = await invoke<ScreenShareSessionState>('start_screen_share', {
        sourceType,
        sourceLabel: sourceType === 'application' ? 'Selected application window' : null,
      });
      setScreenShare(state);

      // Always join signaling so viewers can negotiate WebRTC in both modes.
      await connectHostSignaling();

      if (sourceType === 'browser') {
        setActionMessage(
          'Selectionne la fenetre "NoSubVOD - Screen Share Browser" dans le picker Windows.',
        );
        await startHostCapture('browser');
      } else {
        setActionMessage('Mode application: capture active et signalisation connectee.');
      }
    } catch (err: any) {
      stopHostCapture();
      setActionMessage(err?.toString?.() || 'Impossible de lancer la diffusion.');
    } finally {
      setIsBusy(false);
    }
  };

  const stopShare = async () => {
    setIsBusy(true);
    setActionMessage('');
    try {
      const state = await invoke<ScreenShareSessionState>('stop_screen_share');
      setScreenShare(state);
      stopHostCapture();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setActionMessage('Diffusion arretee.');
    } catch (err: any) {
      setActionMessage(err?.toString?.() || 'Impossible d arreter la diffusion.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.h1}>NoSubVod Portal</h1>
        <div style={styles.status}>Server is running</div>
        <p>Access the portal on your phone:</p>
        <div style={styles.urlBox}>{serverInfo ? serverInfo.url : 'Waiting...'}</div>
        {serverInfo?.qrcode && <img style={styles.qrcode} src={serverInfo.qrcode} alt="QR Code" />}

        <div style={styles.screenShareCard}>
          <h2 style={styles.sectionTitle}>Screen Share Host Control</h2>
          <p style={styles.screenShareState}>
            Etat: {screenShare.active ? 'Live' : 'Offline'}
            {screenShare.sourceType ? ` (${screenShare.sourceType})` : ''}
          </p>
          <p style={styles.screenShareState}>Host WebRTC: {hostRtcStatus}</p>
          <div style={styles.buttonRow}>
            <button
              style={styles.primaryButton}
              disabled={isBusy || screenShare.active}
              onClick={() => void startShare('browser')}
              type="button"
            >
              Solution 1: Lancer navigateur
            </button>
            <button
              style={styles.primaryButton}
              disabled={isBusy || screenShare.active}
              onClick={() => void startShare('application')}
              type="button"
            >
              Solution 2: Choisir une fenetre (picker Windows)
            </button>
            <button
              style={styles.dangerButton}
              disabled={isBusy || !screenShare.active}
              onClick={() => void stopShare()}
              type="button"
            >
              Stop diffusion
            </button>
          </div>
          {actionMessage && <div style={styles.actionMessage}>{actionMessage}</div>}
        </div>

        <p style={styles.info}>
          Make sure your phone is connected to the same Wi-Fi network. Scan the QR code or type the
          address directly into Safari.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    textAlign: 'center',
    backgroundColor: '#18181b',
    color: '#efeff1',
    padding: '2rem',
    margin: 0,
    minHeight: '100vh',
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  container: {
    width: '100%',
    maxWidth: '500px',
    margin: '0 auto',
    backgroundColor: '#0e0e10',
    padding: '2rem',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  },
  h1: {
    color: '#a970ff',
    fontSize: '1.5rem',
    marginTop: 0,
  },
  status: {
    fontWeight: 'bold',
    color: '#2ecc71',
    marginBottom: '1rem',
  },
  urlBox: {
    backgroundColor: '#1f1f23',
    border: '1px solid #3a3a3d',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '1.2rem',
    marginBottom: '1.5rem',
    userSelect: 'all',
  },
  qrcode: {
    backgroundColor: 'white',
    padding: '10px',
    borderRadius: '4px',
    width: '250px',
    height: '250px',
    objectFit: 'contain',
    marginTop: '1rem',
    display: 'inline-block',
  },
  info: {
    color: '#adadb8',
    fontSize: '0.9rem',
    marginTop: '2rem',
  },
  screenShareCard: {
    marginTop: '1.5rem',
    backgroundColor: '#16161f',
    border: '1px solid #2c2d3a',
    borderRadius: '8px',
    padding: '1rem',
    textAlign: 'left',
  },
  sectionTitle: {
    margin: 0,
    marginBottom: '0.6rem',
    color: '#fff',
    fontSize: '1rem',
  },
  screenShareState: {
    margin: 0,
    marginBottom: '0.8rem',
    color: '#d0d3dd',
    fontSize: '0.92rem',
  },
  buttonRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  primaryButton: {
    border: '1px solid #3f4780',
    background: '#2b3263',
    color: '#fff',
    borderRadius: '6px',
    padding: '0.55rem 0.7rem',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  dangerButton: {
    border: '1px solid #7a3044',
    background: '#5a2533',
    color: '#fff',
    borderRadius: '6px',
    padding: '0.55rem 0.7rem',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  actionMessage: {
    marginTop: '0.7rem',
    color: '#9fb0ff',
    fontSize: '0.86rem',
    minHeight: '1.2rem',
  },
};

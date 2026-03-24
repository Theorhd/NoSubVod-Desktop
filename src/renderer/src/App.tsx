import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScreenShareSessionState, ServerInfo } from '../../shared/types';
import { useScreenShareState } from '../../shared/hooks/useScreenShareState';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';

export default function App() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [hostRtcStatus, setHostRtcStatus] = useState('Idle');

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const waitingViewerIdsRef = useRef<Set<string>>(new Set());

  const rtcConfig = useMemo<RTCConfiguration>(
    () => ({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    }),
    []
  );

  const fetchScreenShareState = useCallback(async () => {
    return await invoke<ScreenShareSessionState>('get_screen_share_state');
  }, []);

  const { state: screenShare, setState: setScreenShare } = useScreenShareState(
    fetchScreenShareState,
    2000
  );

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

  const openWebSocketWithTimeout = useCallback(
    async (url: string, timeoutMs = 8000): Promise<WebSocket> => {
      return await new Promise<WebSocket>((resolve, reject) => {
        let settled = false;
        let ws: WebSocket;

        try {
          ws = new WebSocket(url);
        } catch (error) {
          reject(error);
          return;
        }

        const settleAndClearTimer = () => {
          if (settled) return false;
          settled = true;
          globalThis.clearTimeout(openTimer);
          return true;
        };

        const openTimer = globalThis.setTimeout(() => {
          if (!settleAndClearTimer()) return;
          try {
            ws.close();
          } catch {
            /* Ignore */
          }
          reject(new Error(`WebSocket timeout while connecting host signaling: ${url}`));
        }, timeoutMs);

        ws.addEventListener('open', () => {
          if (!settleAndClearTimer()) return;
          resolve(ws);
        });

        ws.addEventListener('error', () => {
          if (!settleAndClearTimer()) return;
          reject(new Error(`Unable to establish host signaling WebSocket: ${url}`));
        });

        ws.addEventListener('close', () => {
          if (!settleAndClearTimer()) return;
          reject(new Error(`Host signaling socket closed before open: ${url}`));
        });
      });
    },
    []
  );

  useEffect(() => {
    invoke<ServerInfo>('get_server_info')
      .then(setServerInfo)
      .catch((err) => {
        console.error('Failed to get server info:', err);
        setServerInfo({
          ip: '127.0.0.1',
          port: 23455,
          url: 'https://127.0.0.1:5173',
          qrcode: '',
        });
      });
  }, []);

  const closeHostPeer = useCallback((viewerId: string) => {
    const peer = hostPeersRef.current.get(viewerId);
    if (!peer) return;
    peer.close();
    hostPeersRef.current.delete(viewerId);
  }, []);

  const stopHostCapture = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    for (const viewerId of hostPeersRef.current.keys()) {
      closeHostPeer(viewerId);
    }
    setHostRtcStatus('Idle');
  }, [closeHostPeer]);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const createHostPeer = useCallback(
    async (viewerId: string) => {
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

      const offer = await peer.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: true,
      });
      await peer.setLocalDescription(offer);
      sendWs({
        type: 'signal',
        target: viewerId,
        payload: { sdp: offer },
      });
    },
    [closeHostPeer, rtcConfig, sendWs]
  );

  const startHostCapture = useCallback(
    async (_sourceType: 'browser' | 'application') => {
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
            // @ts-expect-error - systemAudio is not in standard DOM typings yet
            systemAudio: 'include',
          },
        });

        if (stream.getAudioTracks().length === 0) {
          setActionMessage(
            'Le flux n\'a pas de son ! Partagez l\'"Ecran complet" (Entire Screen) et cochez "Partager l\'audio du système". Les fenêtres ne partagent pas le son !'
          );
        }

        localStreamRef.current = stream;
        setHostRtcStatus('WebRTC capturing');

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
    },
    [createHostPeer, stopHostCapture]
  );

  const connectHostSignaling = useCallback(async () => {
    if (!serverInfo) throw new Error('Server info is not ready.');
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const portalUrl = new URL(serverInfo.url);
    const token = portalUrl.searchParams.get('t') || '';
    const authQuery = token ? `?t=${encodeURIComponent(token)}` : '';
    const httpsPort = portalUrl.port || '23456';
    const candidateHosts = Array.from(new Set(['127.0.0.1', 'localhost', portalUrl.hostname]));
    const wsCandidates = [
      ...candidateHosts.map(
        (host) => `ws://${host}:${serverInfo.port}/api/screenshare/ws${authQuery}`
      ),
      ...candidateHosts.map((host) => `wss://${host}:${httpsPort}/api/screenshare/ws${authQuery}`),
    ];

    const handleHostSignal = (message: HostWsMessage) => {
      const target = message.target;
      const me = clientIdRef.current;
      if (target && me && target !== me) return;
      if (!message.from || !message.payload) return;

      const peer = hostPeersRef.current.get(message.from);
      if (!peer) return;

      if (message.payload.sdp?.type === 'answer') {
        peer.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
        setHostRtcStatus('WebRTC live');
      }

      if (message.payload.candidate) {
        peer.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
      }
    };

    const handleHostWsMessage = (message: HostWsMessage) => {
      switch (message.type) {
        case 'welcome':
          clientIdRef.current = message.clientId || null;
          return;
        case 'peer-joined':
          if (message.role === 'viewer' && message.clientId) createHostPeer(message.clientId);
          return;
        case 'peers':
          for (const peer of message.peers || []) {
            if (peer.role === 'viewer' && peer.clientId) createHostPeer(peer.clientId);
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
          if (message.message) setActionMessage(message.message);
          return;
        default:
          return;
      }
    };

    let lastError: unknown = null;
    for (const candidate of wsCandidates) {
      try {
        const ws = await openWebSocketWithTimeout(candidate);
        wsRef.current = ws;

        ws.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data) as HostWsMessage;
            handleHostWsMessage(message);
          } catch {
            /* Ignore */
          }
        });

        ws.addEventListener('close', () => setHostRtcStatus('Signaling disconnected'));
        setHostRtcStatus('Signaling connected');
        sendWs({ type: 'join', role: 'host' });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Unable to establish host signaling WebSocket: ${String(lastError)}`);
  }, [closeHostPeer, createHostPeer, openWebSocketWithTimeout, sendWs, serverInfo]);

  const startShare = useCallback(
    async (sourceType: 'browser' | 'application') => {
      setIsBusy(true);
      setActionMessage('');
      let sessionStarted = false;
      try {
        if (sourceType === 'application') await startHostCapture(sourceType);

        const state = await invoke<ScreenShareSessionState>('start_screen_share', {
          sourceType,
          sourceLabel: sourceType === 'application' ? 'Selected application window' : null,
        });
        setScreenShare(state);
        sessionStarted = true;

        await connectHostSignaling();

        if (sourceType === 'browser') {
          setActionMessage(
            'Selectionne la fenetre "NoSubVOD - Screen Share Browser" dans le picker Windows.'
          );
          await startHostCapture('browser');
        } else {
          setActionMessage('Mode application: capture active et signalisation connectee.');
        }
      } catch (err: any) {
        stopHostCapture();
        if (sessionStarted) {
          try {
            const resetState = await invoke<ScreenShareSessionState>('stop_screen_share');
            setScreenShare(resetState);
          } catch {
            /* Ignore */
          }
        }
        setActionMessage(err?.toString?.() || 'Impossible de lancer la diffusion.');
      } finally {
        setIsBusy(false);
      }
    },
    [connectHostSignaling, setScreenShare, startHostCapture, stopHostCapture]
  );

  const stopShare = useCallback(async () => {
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
  }, [setScreenShare, stopHostCapture]);

  const sourceTypeLabel = useMemo(() => {
    if (screenShare.sourceType === 'browser') return 'Navigateur';
    if (screenShare.sourceType === 'application') return 'Fenetre';
    return 'Non definie';
  }, [screenShare.sourceType]);

  const memoStyles = useMemo<Record<string, React.CSSProperties>>(
    () => ({
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
      h1: { color: '#a970ff', fontSize: '1.5rem', marginTop: 0 },
      status: { fontWeight: 'bold', color: '#2ecc71', marginBottom: '1rem' },
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
      info: { color: '#adadb8', fontSize: '0.9rem', marginTop: '2rem' },
      screenShareCard: {
        marginTop: '1.5rem',
        background: 'linear-gradient(180deg, #16161f 0%, #13131b 100%)',
        border: '1px solid #2c2d3a',
        borderRadius: '12px',
        padding: '1rem 1rem 1.1rem',
        textAlign: 'left',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
      },
      screenShareHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        marginBottom: '0.75rem',
      },
      statusBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '999px',
        fontSize: '0.76rem',
        fontWeight: 700,
        padding: '0.25rem 0.6rem',
        border: '1px solid transparent',
        letterSpacing: '0.02em',
      },
      statusBadgeLive: { color: '#9ff0ba', borderColor: '#235f3d', backgroundColor: '#143322' },
      statusBadgeOffline: { color: '#c8cbd8', borderColor: '#3a3f59', backgroundColor: '#1f2337' },
      screenShareMetaGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '0.55rem',
        marginBottom: '0.75rem',
      },
      metaItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        backgroundColor: '#1a1b28',
        border: '1px solid #2e324a',
        borderRadius: '8px',
        padding: '0.55rem 0.65rem',
      },
      metaLabel: {
        color: '#9aa0bc',
        fontSize: '0.72rem',
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      },
      metaValue: { color: '#e9ecf8', fontSize: '0.87rem', fontWeight: 600 },
      sectionTitle: { margin: 0, color: '#fff', fontSize: '1.03rem' },
      screenShareHint: {
        margin: 0,
        marginBottom: '0.8rem',
        color: '#b7bfdc',
        fontSize: '0.82rem',
        lineHeight: 1.45,
      },
      buttonRow: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
      primaryButton: {
        border: '1px solid #3f4f95',
        background: 'linear-gradient(180deg, #34408a 0%, #2b346f 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        color: '#fff',
        borderRadius: '8px',
        padding: '0.6rem 0.75rem',
        fontSize: '0.88rem',
        fontWeight: 600,
        letterSpacing: '0.01em',
        cursor: 'pointer',
      },
      secondaryButton: {
        border: '1px solid #36506f',
        background: 'linear-gradient(180deg, #264d72 0%, #1f3f5e 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        color: '#fff',
        borderRadius: '8px',
        padding: '0.6rem 0.75rem',
        fontSize: '0.88rem',
        fontWeight: 600,
        letterSpacing: '0.01em',
        cursor: 'pointer',
      },
      dangerButton: {
        border: '1px solid #7d3348',
        background: 'linear-gradient(180deg, #6b2d3f 0%, #572234 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        color: '#fff',
        borderRadius: '8px',
        padding: '0.6rem 0.75rem',
        fontSize: '0.88rem',
        fontWeight: 600,
        letterSpacing: '0.01em',
        cursor: 'pointer',
      },
      disabledButton: { opacity: 0.55, cursor: 'not-allowed' },
      actionMessage: {
        marginTop: '0.75rem',
        color: '#9fb0ff',
        fontSize: '0.84rem',
        lineHeight: 1.45,
        minHeight: '1.2rem',
      },
    }),
    []
  );

  return (
    <ErrorBoundary>
      <div style={memoStyles.body}>
        <div style={memoStyles.container}>
          <h1 style={memoStyles.h1}>NoSubVod Portal</h1>
          <div style={memoStyles.status}>Server is running</div>
          <p>Access the portal on your phone:</p>
          <div style={memoStyles.urlBox}>{serverInfo ? serverInfo.url : 'Waiting...'}</div>
          {serverInfo?.qrcode && (
            <img style={memoStyles.qrcode} src={serverInfo.qrcode} alt="QR Code" />
          )}

          <div style={memoStyles.screenShareCard}>
            <div style={memoStyles.screenShareHeader}>
              <h2 style={memoStyles.sectionTitle}>Screen Share Host Control</h2>
              <span
                style={{
                  ...memoStyles.statusBadge,
                  ...(screenShare.active
                    ? memoStyles.statusBadgeLive
                    : memoStyles.statusBadgeOffline),
                }}
              >
                {screenShare.active ? 'Live' : 'Offline'}
              </span>
            </div>

            <div style={memoStyles.screenShareMetaGrid}>
              <div style={memoStyles.metaItem}>
                <span style={memoStyles.metaLabel}>Etat</span>
                <span style={memoStyles.metaValue}>
                  {screenShare.active ? 'Diffusion active' : 'Aucune diffusion'}
                </span>
              </div>
              <div style={memoStyles.metaItem}>
                <span style={memoStyles.metaLabel}>Source</span>
                <span style={memoStyles.metaValue}>{sourceTypeLabel}</span>
              </div>
              <div style={memoStyles.metaItem}>
                <span style={memoStyles.metaLabel}>WebRTC</span>
                <span style={memoStyles.metaValue}>{hostRtcStatus}</span>
              </div>
            </div>

            <p style={memoStyles.screenShareHint}>
              Conseil: demarre d abord le mode navigateur. Si le partage echoue, utilise le mode
              fenetre.
            </p>

            <div style={memoStyles.buttonRow}>
              <button
                style={{
                  ...memoStyles.primaryButton,
                  ...(isBusy || screenShare.active ? memoStyles.disabledButton : {}),
                }}
                disabled={isBusy || screenShare.active}
                onClick={() => startShare('browser')}
                type="button"
              >
                Ouvrir le navigateur
              </button>
              <button
                style={{
                  ...memoStyles.secondaryButton,
                  ...(isBusy || screenShare.active ? memoStyles.disabledButton : {}),
                }}
                disabled={isBusy || screenShare.active}
                onClick={() => startShare('application')}
                type="button"
              >
                Streamer une fenetre
              </button>
              <button
                style={{
                  ...memoStyles.dangerButton,
                  ...(isBusy || !screenShare.active ? memoStyles.disabledButton : {}),
                }}
                disabled={isBusy || !screenShare.active}
                onClick={() => stopShare()}
                type="button"
              >
                Stop diffusion
              </button>
            </div>
            {actionMessage && <div style={memoStyles.actionMessage}>{actionMessage}</div>}
          </div>

          <p style={memoStyles.info}>
            Make sure your phone is connected to the same Wi-Fi network. Scan the QR code or type
            the address directly into Safari.
          </p>
        </div>
      </div>
    </ErrorBoundary>
  );
}

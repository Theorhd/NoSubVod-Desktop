import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Settings, 
  Users as UsersIcon, 
  Activity, 
  Smartphone,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useResponsive } from './hooks/useResponsive';
import { useScreenShareState } from './hooks/useScreenShareState';
import { useWebRTCViewer } from './hooks/useWebRTCViewer';
import { usePlayerControls } from './hooks/usePlayerControls';
import { RemoteControlPayload } from '../../shared/types';

function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return 'Not started';
  const date = new Date(startedAt);
  return date.toLocaleString();
}

const pointerButtonFromMouseEvent = (button: number): 'left' | 'middle' | 'right' => {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
};

const normalizedPointerPosition = (
  event: React.MouseEvent<HTMLButtonElement>,
  surface: HTMLButtonElement | null
) => {
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

export default function PlayerRTC() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const { isMobileLayout, isTouchDevice } = useResponsive();
  const { state, setState } = useScreenShareState();

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLButtonElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const lastPointerMoveRef = useRef(0);

  const [activeTab, setActiveTab] = useState<'info' | 'remote'>(isTouchDevice ? 'remote' : 'info');

  const { signalStatus, rtcStatus, hasRemoteStream, streamError, sendRemoteInput, sendRemoteControl } =
    useWebRTCViewer(sessionIdParam, state, setState, remoteVideoRef);

  const {
    isFullscreen,
    volume,
    isMuted,
    controlsVisible,
    toggleFullscreen,
    toggleMute,
    handleVolumeChange,
    revealControls,
  } = usePlayerControls(hasRemoteStream, remoteVideoRef, playerFrameRef);

  // Synchronisation lecture/pause avec l'hôte
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !hasRemoteStream) return;

    let lastSentCommand = '';

    const onPlay = () => {
      if (lastSentCommand === 'play') return;
      lastSentCommand = 'play';
      sendRemoteControl({ command: 'play' });
    };
    const onPause = () => {
      if (lastSentCommand === 'pause') return;
      lastSentCommand = 'pause';
      sendRemoteControl({ command: 'pause' });
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [hasRemoteStream, sendRemoteControl]);

  useEffect(() => {
    if (hasRemoteStream && viewerSurfaceRef.current) {
      viewerSurfaceRef.current.focus();
    }
  }, [hasRemoteStream]);

  const statusLabel = useMemo(() => {
    if (!state.active) return 'Offline';
    return state.streamReady ? 'Live' : 'Preparing';
  }, [state.active, state.streamReady]);

  const useNativeMobilePlayer = isMobileLayout || isTouchDevice;

  const handleViewerMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const now = performance.now();
    if (now - lastPointerMoveRef.current < 8) {
      return;
    }
    lastPointerMoveRef.current = now;

    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'move',
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'down',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    revealControls();
    const pos = normalizedPointerPosition(event, viewerSurfaceRef.current);
    sendRemoteInput({
      kind: 'pointer',
      action: 'up',
      button: pointerButtonFromMouseEvent(event.button),
      x: pos.x,
      y: pos.y,
    });
  };

  const handleViewerWheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    revealControls();
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
    revealControls();
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
    revealControls();
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
    <div className="player-container">
      <div className="top-bar glass">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
          <button onClick={handleBack} className="secondary-btn" style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}>
            <ArrowLeft size={20} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Screen Share</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: state.active ? 'var(--success)' : 'var(--text-muted)' }} />
                {statusLabel}
              </span>
              <span>•</span>
              <span>{rtcStatus}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: isMobileLayout ? 'column' : 'row' }}>
        <div 
          ref={playerFrameRef}
          style={{ 
            flex: 1, 
            backgroundColor: '#000', 
            position: 'relative', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            overflow: 'hidden'
          }}
        >
          {hasRemoteStream ? (
            useNativeMobilePlayer ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted={isMuted}
                controls
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <button
                ref={viewerSurfaceRef}
                type="button"
                style={{ touchAction: 'none', border: 'none', padding: 0, background: 'transparent', width: '100%', height: '100%', display: 'block' }}
                onMouseMove={handleViewerMouseMove}
                onMouseDown={handleViewerMouseDown}
                onMouseUp={handleViewerMouseUp}
                onWheelCapture={handleViewerWheel}
                onKeyDown={handleViewerKeyDown}
                onKeyUp={handleViewerKeyUp}
                onTouchStart={revealControls}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => viewerSurfaceRef.current?.focus()}
              >
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </button>
            )
          ) : (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Activity size={48} className="spinning" style={{ color: 'var(--primary)', marginBottom: '16px', opacity: 0.5 }} />
              <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>Waiting for host stream...</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {state.streamMessage || 'The host WebRTC feed will appear here soon.'}
              </div>
            </div>
          )}

          {hasRemoteStream && controlsVisible && !useNativeMobilePlayer && (
            <div style={{ 
              position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: '12px', padding: '12px', borderRadius: 'var(--radius-lg)',
              background: 'rgba(7, 8, 15, 0.8)', backdropFilter: 'blur(12px)', border: '1px solid var(--border)',
              zIndex: 100
            }}>
              <button onClick={toggleMute} className="secondary-btn" style={{ width: '40px', height: '40px', padding: 0 }}>
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input 
                type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} 
                onChange={handleVolumeChange} style={{ width: '120px' }} 
              />
              <button onClick={() => void toggleFullscreen()} className="action-btn" style={{ fontSize: '0.85rem' }}>
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
            </div>
          )}

          {streamError && (
            <div className="glass" style={{ position: 'absolute', bottom: '20px', padding: '12px 20px', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontWeight: 600 }}>
              {streamError}
            </div>
          )}
        </div>

        <div className="glass" style={{ width: isMobileLayout ? '100%' : '360px', display: 'flex', flexDirection: 'column', borderLeft: isMobileLayout ? 'none' : '1px solid var(--border)', borderTop: isMobileLayout ? '1px solid var(--border)' : 'none' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <button 
              onClick={() => setActiveTab('info')}
              style={{ 
                flex: 1, padding: '16px', border: 'none', background: activeTab === 'info' ? 'rgba(143, 87, 255, 0.1)' : 'transparent',
                color: activeTab === 'info' ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer',
                borderBottom: activeTab === 'info' ? '2px solid var(--primary)' : 'none'
              }}
            >
              Session Info
            </button>
            <button 
              onClick={() => setActiveTab('remote')}
              style={{ 
                flex: 1, padding: '16px', border: 'none', background: activeTab === 'remote' ? 'rgba(143, 87, 255, 0.1)' : 'transparent',
                color: activeTab === 'remote' ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer',
                borderBottom: activeTab === 'remote' ? '2px solid var(--primary)' : 'none'
              }}
            >
              Remote Control
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {activeTab === 'info' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <section>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800 }}>Host Device</div>
                  <div style={{ fontWeight: 700 }}>{state.sourceLabel || 'N/A'}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{state.sourceType} session</div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <section>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800 }}>Viewers</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{state.currentViewers} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {state.maxViewers}</span></div>
                  </section>
                  <section>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800 }}>Signaling</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--success)', fontWeight: 600 }}>{signalStatus}</div>
                  </section>
                </div>

                <section>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800 }}>Started At</div>
                  <div style={{ fontSize: '0.9rem' }}>{formatStartedAt(state.startedAt)}</div>
                </section>

                <div className="card glass" style={{ marginTop: 'auto', padding: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <Activity size={14} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                  {state.interactive ? 'Inputs are forwarded to host window.' : 'Remote interaction is disabled.'}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px' }}>
                <Smartphone size={40} style={{ color: 'var(--primary)', opacity: 0.5, marginBottom: '8px' }} />
                
                <div style={{ display: 'flex', gap: '16px' }}>
                  <button 
                    className="secondary-btn" 
                    style={{ width: '64px', height: '64px', borderRadius: '50%' }}
                    onClick={() => sendRemoteControl({ command: 'seek', value: -10 })}
                  >
                    <RotateCcw size={24} />
                  </button>
                  <button 
                    className="action-btn" 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--primary)' }}
                    onClick={() => sendRemoteControl({ command: 'play' })}
                  >
                    <Play size={32} fill="currentColor" />
                  </button>
                  <button 
                    className="action-btn" 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--surface-elevated)' }}
                    onClick={() => sendRemoteControl({ command: 'pause' })}
                  >
                    <Pause size={32} fill="currentColor" />
                  </button>
                  <button 
                    className="secondary-btn" 
                    style={{ width: '64px', height: '64px', borderRadius: '50%' }}
                    onClick={() => sendRemoteControl({ command: 'seek', value: 10 })}
                  >
                    <RotateCw size={24} />
                  </button>
                </div>

                <div style={{ width: '100%', padding: '0 20px', marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <Volume2 size={18} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Host Volume</span>
                  </div>
                  <input 
                    type="range" min={0} max={1} step={0.1} defaultValue={1} 
                    style={{ width: '100%' }}
                    onChange={(e) => sendRemoteControl({ command: 'volume', value: parseFloat(e.target.value) })}
                  />
                </div>

                <button 
                  className="secondary-btn" 
                  style={{ width: '100%', padding: '14px', borderRadius: 'var(--radius-md)', fontWeight: 700 }}
                  onClick={() => sendRemoteControl({ command: 'mute' })}
                >
                  Mute / Unmute Host
                </button>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: '1.4' }}>
                  Ces commandes contrôlent directement le lecteur vidéo sur la machine hôte.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

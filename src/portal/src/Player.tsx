import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download as DownloadIcon } from 'lucide-react';
import { ChatMessage, ExperienceSettings, LiveStream, VideoMarker, VOD } from '../../shared/types';
import DownloadMenu from './components/DownloadMenu';
import NSVPlayer from './components/NSVPlayer';

const DEFAULT_SETTINGS: ExperienceSettings = {
  oneSync: false,
  minVideoQuality: 'none',
  preferredVideoQuality: 'auto',
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function resolvePlayerTitle(vodId: string | null, liveId: string | null): string {
  if (vodId) return `VOD: ${vodId}`;
  if (liveId) return `Live: ${liveId}`;
  return 'Player';
}

const Uptime = ({ startedAt }: { startedAt: string }) => {
  const [uptime, setUptime] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      if (diff < 0) return setUptime('');
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setUptime(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };

    update();
    const int = setInterval(update, 60000);
    return () => clearInterval(int);
  }, [startedAt]);

  return <span>{uptime}</span>;
};

const LiveChat = ({
  liveId,
  chatScrollRef,
}: {
  liveId: string;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [twitchLinked, setTwitchLinked] = useState(false);
  const [twitchDisplayName, setTwitchDisplayName] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    fetch('/api/auth/twitch/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.linked) {
          setTwitchLinked(true);
          setTwitchDisplayName(data.userDisplayName || data.userLogin || '');
        }
      })
      .catch(() => {});
  }, []);

  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || sending) return;

    setSending(true);
    setSendError('');
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(liveId)}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });

      if (res.ok) {
        setChatInput('');
      } else {
        const payload = await res.json().catch(() => null);
        setSendError(payload?.error || 'Message send failed.');
      }
    } catch (e) {
      console.error('Failed to send chat message', e);
      setSendError('Network error while sending message.');
    } finally {
      setSending(false);
    }
  };

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clear_chat') {
          setMessages([]);
        } else if (data.type === 'clear_msg') {
          setMessages((prev) => prev.filter((m) => m.id !== data.id));
        } else if (data.id) {
          setMessages((prev) => {
            const next = [...prev, data];
            if (next.length > 150) return next.slice(-150);
            return next;
          });

          if (chatScrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
            if (scrollHeight - scrollTop - clientHeight < 150) {
              setTimeout(() => {
                if (chatScrollRef.current) {
                  chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                }
              }, 50);
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse chat message', e);
      }
    },
    [chatScrollRef]
  );

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = globalThis.location.host;
      const token = sessionStorage.getItem('nsv_token') || '';
      const wsUrl = `${protocol}//${host}/api/live/${encodeURIComponent(liveId)}/chat/ws?t=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = handleWsMessage;
      ws.onclose = () => {
        if (!disposed) reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [liveId, handleWsMessage]);

  return (
    <>
      <div
        style={{
          padding: '15px',
          borderBottom: '1px solid #3a3a3d',
          fontWeight: 'bold',
          color: '#efeff1',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>LIVE CHAT</span>
        <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>Connected</span>
      </div>

      <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {messages.map((message, idx) => (
          <div
            key={message.id || idx}
            style={{
              marginBottom: '8px',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              wordWrap: 'break-word',
            }}
          >
            <span style={{ fontWeight: 'bold', color: message.color || '#bf94ff' }}>
              {message.displayName}:{' '}
            </span>
            <span style={{ color: '#efeff1' }}>{message.message}</span>
          </div>
        ))}
      </div>

      {twitchLinked && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid #3a3a3d',
            display: 'flex',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              if (sendError) setSendError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendMessage();
            }}
            placeholder={`Message as ${twitchDisplayName}`}
            maxLength={500}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#1f1f23',
              border: '1px solid #3a3a3d',
              borderRadius: '4px',
              color: '#efeff1',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!chatInput.trim() || sending}
            style={{
              padding: '6px 12px',
              background: '#9146ff',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.85rem',
              opacity: !chatInput.trim() || sending ? 0.5 : 1,
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}

      {sendError && (
        <div
          style={{
            padding: '8px 10px',
            color: '#f87171',
            fontSize: '0.8rem',
            borderTop: '1px solid #3a3a3d',
            background: '#140f12',
          }}
        >
          {sendError}
        </div>
      )}
    </>
  );
};

export default function Player() {
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get('vod');
  const liveId = searchParams.get('live');
  const downloadMode = searchParams.get('downloadMode') === 'true';
  const navigate = useNavigate();

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastChatOffsetRef = useRef(-1);

  const [showChat, setShowChat] = useState(window.innerWidth > 1024);
  const [showMarkers, setShowMarkers] = useState(false);
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [vodInfo, setVodInfo] = useState<VOD | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveStream | null>(null);
  const [initialTime, setInitialTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [settings, setSettings] = useState<ExperienceSettings>(DEFAULT_SETTINGS);

  const playerTitle = useMemo(() => resolvePlayerTitle(vodId, liveId), [vodId, liveId]);

  const source = useMemo(() => {
    if (vodId) {
      return {
        src: `/api/vod/${vodId}/master.m3u8`,
        type: 'application/x-mpegurl',
        streamType: 'on-demand' as const,
      };
    }

    if (liveId) {
      return {
        src: `/api/live/${encodeURIComponent(liveId)}/master.m3u8`,
        type: 'application/x-mpegurl',
        streamType: 'live' as const,
      };
    }

    return null;
  }, [vodId, liveId]);

  const visibleChat = useMemo(() => {
    return chatMessages.filter(
      (message) =>
        message.contentOffsetSeconds <= currentTime &&
        message.contentOffsetSeconds > currentTime - 60
    );
  }, [chatMessages, currentTime]);

  const fetchVodChatChunk = useCallback(
    async (offset: number) => {
      if (!vodId) return;
      if (offset === lastChatOffsetRef.current) return;

      try {
        const res = await fetch(`/api/vod/${vodId}/chat?offset=${offset}`);
        if (!res.ok) return;

        const data = await res.json();
        setChatMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const incoming = (data.messages || []).filter((m: ChatMessage) => !known.has(m.id));
          if (incoming.length === 0) return prev;
          return [...prev, ...incoming].sort(
            (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds
          );
        });

        lastChatOffsetRef.current = offset;
      } catch (error) {
        console.error('Failed to fetch chat', error);
      }
    },
    [vodId]
  );

  useEffect(() => {
    if (!vodId) return;
    const offset = Math.floor(currentTime / 60) * 60;
    void fetchVodChatChunk(offset);
  }, [currentTime, fetchVodChatChunk, vodId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [visibleChat]);

  useEffect(() => {
    const onFullScreenChanged = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullScreenChanged);
    return () => document.removeEventListener('fullscreenchange', onFullScreenChanged);
  }, []);

  useEffect(() => {
    setPlayerError(null);
    setChatMessages([]);
    setMarkers([]);
    setVodInfo(null);
    setLiveInfo(null);
    setCurrentTime(0);
    setDuration(0);
    setInitialTime(0);
    setClipStart(null);
    setClipEnd(null);
    setShowDownloadMenu(false);
    lastChatOffsetRef.current = -1;
  }, [vodId, liveId]);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (!vodId) return;

      try {
        const [historyRes, markersRes, infoRes, settingsRes] = await Promise.all([
          fetch(`/api/history/${vodId}`),
          fetch(`/api/vod/${vodId}/markers`),
          fetch(`/api/vod/${vodId}/info`),
          fetch('/api/settings'),
        ]);

        if (!disposed && historyRes.ok) {
          const hist = await historyRes.json();
          const resumeTime = Math.max(0, Number(hist?.timecode || 0) - 5);
          setInitialTime(resumeTime);
        }

        if (!disposed && markersRes.ok) {
          setMarkers(await markersRes.json());
        }

        if (!disposed && infoRes.ok) {
          setVodInfo(await infoRes.json());
        }

        if (!disposed && settingsRes.ok) {
          const remoteSettings = (await settingsRes.json()) as ExperienceSettings;
          setSettings((prev) => ({ ...prev, ...remoteSettings }));
        }
      } catch (error) {
        console.error('Failed to fetch VOD player data', error);
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [vodId]);

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      if (!liveId) return;

      try {
        const [infoRes, settingsRes] = await Promise.all([
          fetch(`/api/user/${encodeURIComponent(liveId)}/live`),
          fetch('/api/settings'),
        ]);

        if (!disposed && infoRes.ok) {
          setLiveInfo(await infoRes.json());
        }

        if (!disposed && settingsRes.ok) {
          const remoteSettings = (await settingsRes.json()) as ExperienceSettings;
          setSettings((prev) => ({ ...prev, ...remoteSettings }));
        }
      } catch (error) {
        console.error('Failed to fetch live player data', error);
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [liveId]);

  useEffect(() => {
    if (!vodId) return;

    const saveProgress = () => {
      if (currentTime <= 0) return;
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId,
          timecode: currentTime,
          duration: duration || 0,
        }),
      }).catch((error) => {
        console.error('Failed to save history', error);
      });
    };

    const intervalId = setInterval(() => {
      if (isPlaying) saveProgress();
    }, 10000);

    return () => {
      clearInterval(intervalId);
      saveProgress();
    };
  }, [vodId, currentTime, duration, isPlaying]);

  if (!source) {
    return (
      <div
        style={{
          padding: '24px',
          color: '#efeff1',
          backgroundColor: '#07080f',
          minHeight: '100vh',
        }}
      >
        Missing player source. Please provide vod or live query parameter.
      </div>
    );
  }

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
        overscrollBehavior: 'none',
      }}
    >
      {!isFullscreen && (
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
            onClick={() => navigate(-1)}
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
            {playerTitle}
          </h2>

          {!liveId && (
            <button
              onClick={() => setShowMarkers((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                color: '#9146ff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Chapters ({markers.length})
            </button>
          )}

          <button
            onClick={() => setShowChat((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#9146ff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            {showChat ? 'Hide Chat' : 'Show Chat'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: isFullscreen ? 'hidden' : 'auto',
          }}
        >
          <div
            style={{
              width: '100%',
              backgroundColor: '#000',
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flexShrink: 0,
              aspectRatio: isFullscreen ? 'auto' : '16 / 9',
              maxHeight: isFullscreen ? 'none' : 'calc(100vh - 140px)',
            }}
          >
            <NSVPlayer
              source={{ src: source.src, type: source.type }}
              streamType={source.streamType}
              title={vodInfo?.title || liveInfo?.title || playerTitle}
              startTime={initialTime}
              seekTo={seekTo}
              preferredQuality={settings.preferredVideoQuality}
              minQuality={settings.minVideoQuality}
              autoPlay
              className="nsv-main-player"
              onTimeUpdate={(time) => setCurrentTime(time)}
              onDurationChange={(nextDuration) => setDuration(nextDuration)}
              onPlayStateChange={(playing) => setIsPlaying(playing)}
              onError={(message) => setPlayerError(message)}
            />

            {!liveId && showMarkers && markers.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  padding: '15px',
                  borderRadius: '8px',
                  zIndex: 20,
                  maxHeight: '80%',
                  overflowY: 'auto',
                  border: '1px solid #3a3a3d',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1rem', color: '#fff' }}>Chapters</h3>
                {markers.map((marker) => (
                  <button
                    key={marker.id}
                    onClick={() => {
                      setSeekTo(marker.displayTime);
                      setShowMarkers(false);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      color: '#adadb8',
                      padding: '8px 0',
                      cursor: 'pointer',
                      borderBottom: '1px solid #222',
                    }}
                  >
                    <span style={{ color: '#9146ff', fontWeight: 'bold', marginRight: '10px' }}>
                      {formatClock(marker.displayTime)}
                    </span>
                    {marker.description}
                  </button>
                ))}
              </div>
            )}
          </div>

          {downloadMode && vodId && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
                margin: '12px 16px',
                background: 'rgba(0,0,0,0.35)',
                padding: '10px',
                borderRadius: '10px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '0.9rem' }}>
                Clip Mode
              </span>
              <button
                type="button"
                onClick={() => setClipStart(currentTime)}
                className="action-btn"
                style={{ padding: '5px 10px', fontSize: '0.8rem' }}
              >
                Set Start
              </button>
              <span style={{ fontSize: '0.85rem', color: '#adadb8' }}>
                {formatClock(clipStart || 0)}
              </span>
              <button
                type="button"
                onClick={() => setClipEnd(currentTime)}
                className="action-btn"
                style={{ padding: '5px 10px', fontSize: '0.8rem' }}
              >
                Set End
              </button>
              <span style={{ fontSize: '0.85rem', color: '#adadb8' }}>
                {formatClock(clipEnd ?? duration)}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/download/start', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        vodId,
                        title: vodInfo?.title || `Clip ${vodId}`,
                        quality: 'best',
                        startTime: clipStart || 0,
                        endTime: clipEnd ?? duration,
                        duration,
                      }),
                    });
                    if (res.ok) {
                      alert('Clip download started in background.');
                    } else {
                      throw new Error('Failed to start clip download');
                    }
                  } catch (e) {
                    alert(`Error: ${e}`);
                  }
                }}
                className="action-btn"
                style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: '0.8rem' }}
              >
                Download Selection
              </button>
            </div>
          )}

          {!isFullscreen && (vodInfo || liveInfo) && (
            <div style={{ padding: '20px', backgroundColor: '#07080f', color: '#efeff1', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
                <img
                  src={
                    liveInfo
                      ? liveInfo.broadcaster?.profileImageURL
                      : vodInfo?.owner?.profileImageURL || ''
                  }
                  alt="Profile"
                  style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '2px solid #3a3a3d',
                  }}
                />

                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <h1 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', lineHeight: '1.3' }}>
                      {liveInfo ? liveInfo.title : vodInfo?.title}
                    </h1>

                    {vodInfo && (
                      <div style={{ position: 'relative' }}>
                        <button
                          className="action-btn"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            background: '#9146ff',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                          }}
                          onClick={() => setShowDownloadMenu((v) => !v)}
                        >
                          <DownloadIcon size={18} />
                          Download
                        </button>
                        {showDownloadMenu && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              right: 0,
                              marginBottom: '8px',
                            }}
                          >
                            <DownloadMenu
                              vodId={vodInfo.id}
                              title={vodInfo.title}
                              duration={duration}
                              onClose={() => setShowDownloadMenu(false)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      fontWeight: 'bold',
                      fontSize: '1.1rem',
                      marginBottom: '10px',
                      color: '#bf94ff',
                    }}
                  >
                    {liveInfo
                      ? liveInfo.broadcaster?.displayName
                      : vodInfo?.owner?.displayName || 'Unknown Streamer'}
                  </div>

                  <div
                    style={{
                      color: '#adadb8',
                      fontSize: '0.95rem',
                      display: 'flex',
                      gap: '20px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        backgroundColor: '#18181b',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontWeight: 'bold',
                      }}
                    >
                      {liveInfo ? liveInfo.game?.name : vodInfo?.game?.name || 'No Category'}
                    </span>

                    {liveInfo && (
                      <>
                        <span
                          style={{
                            color: '#eb0400',
                            fontWeight: 'bold',
                            backgroundColor: '#18181b',
                            padding: '4px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {liveInfo.viewerCount.toLocaleString()} viewers
                        </span>
                        <span
                          style={{
                            backgroundColor: '#18181b',
                            padding: '4px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          <Uptime startedAt={liveInfo.startedAt} />
                        </span>
                      </>
                    )}

                    {vodInfo && (
                      <>
                        <span
                          style={{
                            backgroundColor: '#18181b',
                            padding: '4px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {(vodInfo.viewCount || 0).toLocaleString()} views
                        </span>
                        <span
                          style={{
                            backgroundColor: '#18181b',
                            padding: '4px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {new Date(vodInfo.createdAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {playerError && (
            <div style={{ margin: '0 16px 16px', color: '#ff9c9c', fontSize: '0.9rem' }}>
              {playerError}
            </div>
          )}
        </div>

        {showChat && (
          <div
            style={{
              width: '340px',
              backgroundColor: '#0e0e10',
              borderLeft: '1px solid #3a3a3d',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
            }}
          >
            {liveId ? (
              <LiveChat liveId={liveId} chatScrollRef={chatScrollRef} />
            ) : (
              <>
                <div
                  style={{
                    padding: '15px',
                    borderBottom: '1px solid #3a3a3d',
                    fontWeight: 'bold',
                    color: '#efeff1',
                    fontSize: '0.9rem',
                  }}
                >
                  STREAM CHAT REPLAY
                </div>

                <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                  {visibleChat.map((message) => (
                    <div
                      key={message.id}
                      style={{ marginBottom: '8px', fontSize: '0.85rem', lineHeight: '1.4' }}
                    >
                      <span style={{ color: '#adadb8', marginRight: '8px', fontSize: '0.75rem' }}>
                        {formatClock(message.contentOffsetSeconds)}
                      </span>
                      <span style={{ fontWeight: 'bold', color: '#efeff1' }}>
                        {message.commenter?.displayName || 'Unknown'}:{' '}
                      </span>
                      <span style={{ color: '#efeff1' }}>
                        {message.message?.fragments?.map((fragment) => fragment.text).join('') ||
                          ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

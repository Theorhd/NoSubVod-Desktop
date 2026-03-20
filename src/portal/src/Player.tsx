import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatMessage, ExperienceSettings, LiveStream, VideoMarker, VOD } from '../../shared/types';
import NSVPlayer from './components/NSVPlayer';
import LiveChatComponent from './components/player/LiveChatComponent';
import MarkerPanel from './components/player/MarkerPanel';
import ClipMode from './components/player/ClipMode';
import PlayerInfo from './components/player/PlayerInfo';
import { formatSafeClock as formatClock } from './utils/formatters.ts';
import PlayerRTC from './PlayerRTC';

const DEFAULT_SETTINGS: ExperienceSettings = {
  oneSync: false,
  minVideoQuality: 'none',
  preferredVideoQuality: 'auto',
};

function resolvePlayerTitle(vodId: string | null, liveId: string | null): string {
  if (vodId) return `VOD: ${vodId}`;
  if (liveId) return `Live: ${liveId}`;
  return 'Player';
}

export default function Player() {
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get('vod');
  const liveId = searchParams.get('live');
  const downloadMode = searchParams.get('downloadMode') === 'true';
  const screenShareParam = searchParams.get('screenshare') ?? searchParams.get('screenShare');
  const screenShareMode = screenShareParam === 'true' || screenShareParam === '1';

  if (screenShareMode) {
    return <PlayerRTC />;
  }

  return <VodLivePlayer vodId={vodId} liveId={liveId} downloadMode={downloadMode} />;
}

type VodLivePlayerProps = {
  readonly vodId: string | null;
  readonly liveId: string | null;
  readonly downloadMode: boolean;
};

function VodLivePlayer({ vodId, liveId, downloadMode }: VodLivePlayerProps) {
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

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Sync refs when states change
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

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

  const handlePlayerTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time);
      if (!vodId) return;
      const offset = Math.floor(time / 60) * 60;
      void fetchVodChatChunk(offset);
    },
    [fetchVodChatChunk, vodId]
  );

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
    const timeoutId = globalThis.setTimeout(() => {
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
    }, 0);
    lastChatOffsetRef.current = -1;
    return () => globalThis.clearTimeout(timeoutId);
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
      const current = currentTimeRef.current;
      const dur = durationRef.current;
      if (current <= 0) return;
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId,
          timecode: current,
          duration: dur || 0,
        }),
      }).catch((error) => {
        console.error('Failed to save history', error);
      });
    };

    const intervalId = setInterval(() => {
      if (isPlayingRef.current) saveProgress();
    }, 10000);

    return () => {
      clearInterval(intervalId);
      saveProgress();
    };
  }, [vodId]);

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
              onTimeUpdate={handlePlayerTimeUpdate}
              onDurationChange={(nextDuration) => setDuration(nextDuration)}
              onPlayStateChange={(playing) => setIsPlaying(playing)}
              onError={(message) => setPlayerError(message)}
            />

            {!liveId && showMarkers && markers.length > 0 && (
              <MarkerPanel
                markers={markers}
                onSeek={(time) => {
                  setSeekTo(time);
                  setShowMarkers(false);
                }}
                onClose={() => setShowMarkers(false)}
              />
            )}
          </div>

          {downloadMode && vodId && (
            <ClipMode
              duration={duration}
              clipStart={clipStart}
              clipEnd={clipEnd}
              vodId={vodId}
              vodInfo={vodInfo}
              onSetStart={() => setClipStart(currentTime)}
              onSetEnd={() => setClipEnd(currentTime)}
              onDownloadStart={() => {
                setClipStart(null);
                setClipEnd(null);
              }}
            />
          )}

          {!isFullscreen && (vodInfo || liveInfo) && (
            <PlayerInfo
              vodInfo={vodInfo}
              liveInfo={liveInfo}
              duration={duration}
              showDownloadMenu={showDownloadMenu}
              onDownloadMenuToggle={(show) => setShowDownloadMenu(show)}
            />
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
              <LiveChatComponent liveId={liveId} chatScrollRef={chatScrollRef} />
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

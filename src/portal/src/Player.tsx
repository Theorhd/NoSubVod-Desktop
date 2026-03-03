import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatMessage, VideoMarker, ExperienceSettings, VOD, LiveStream } from '../../shared/types';

const HLS_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/hls.js@latest';

let hlsScriptPromise: Promise<any> | null = null;

function loadHlsLibrary(): Promise<any> {
  const Hls = (globalThis as any).Hls;
  if (Hls) return Promise.resolve(Hls);

  if (hlsScriptPromise) return hlsScriptPromise;

  hlsScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${HLS_SCRIPT_URL}"]`);

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve((globalThis as any).Hls), {
        once: true,
      });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load hls.js')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = HLS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve((globalThis as any).Hls);
    script.onerror = () => reject(new Error('Failed to load hls.js'));
    document.body.appendChild(script);
  });

  return hlsScriptPromise;
}

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

type QualityOption = {
  id: number;
  label: string;
  url?: string; // Used for native HLS quality forcing
  height?: number; // Used for filtering
};

function resolvePlayerTitle(vodId: string | null, liveId: string | null): string {
  if (vodId) return `VOD: ${vodId}`;
  if (liveId) return `Live: ${liveId}`;
  return 'Error';
}

function parseNativeHlsManifest(text: string, baseOrigin: string): QualityOption[] {
  const options: QualityOption[] = [];
  let currentRes = 0;
  let currentName = '';

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const resMatch = /RESOLUTION=\d+x(\d+)/.exec(line);
      const nameMatch = /VIDEO="([^"]+)"/.exec(line);
      if (resMatch) currentRes = Number.parseInt(resMatch[1], 10);
      if (nameMatch) currentName = nameMatch[1];
      return;
    }

    if (!line || line.startsWith('#')) return;

    const label = currentName || (currentRes ? `${currentRes}p` : `Quality ${options.length + 1}`);
    const isAbs = line.startsWith('http') || line.startsWith('/');

    options.push({
      id: options.length,
      label,
      url: isAbs ? line : new URL(line, baseOrigin).href,
      height: currentRes,
    });

    currentRes = 0;
    currentName = '';
  });

  return options;
}

function filterQualityOptions(options: QualityOption[], minVideoQuality?: string): QualityOption[] {
  const minQ = Number.parseInt(minVideoQuality || 'none', 10);
  if (Number.isNaN(minQ)) return options;
  return options.filter((opt) => !opt.height || opt.height >= minQ);
}

function getPreferredLevelIndex(
  options: { height?: number }[],
  preferredVideoQuality?: string
): number {
  if (!preferredVideoQuality || preferredVideoQuality === 'auto') return -1;
  const preferredHeight = Number.parseInt(preferredVideoQuality, 10);
  const foundIndex = options.findIndex((o) => o.height === preferredHeight);
  return foundIndex === -1 ? 0 : foundIndex;
}

function handlePlayerKeyDown(
  e: KeyboardEvent,
  video: HTMLVideoElement,
  canSeek: boolean,
  viewport: HTMLDivElement | null
) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;

  switch (e.key.toLowerCase()) {
    case ' ':
    case 'k':
      e.preventDefault();
      if (video.paused) void video.play().catch(() => {});
      else video.pause();
      break;
    case 'f':
      e.preventDefault();
      if (!viewport) break;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else viewport.requestFullscreen().catch(() => {});
      break;
    case 'm':
      e.preventDefault();
      video.muted = !video.muted;
      break;
    case 'arrowup':
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.05);
      break;
    case 'arrowdown':
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.05);
      break;
    case 'arrowleft':
      e.preventDefault();
      if (canSeek) video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'arrowright':
      e.preventDefault();
      if (canSeek && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(video.duration, video.currentTime + 5);
      }
      break;
  }
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
  return <span>⏱️ {uptime}</span>;
};

interface PlayerHeaderProps {
  navigate: ReturnType<typeof useNavigate>;
  playerTitle: string;
  qualityOptions: QualityOption[];
  currentQuality: number;
  changeQuality: (val: number) => void;
  activeQualityLabel: string;
  liveId: string | null;
  markers: VideoMarker[];
  showMarkers: boolean;
  setShowMarkers: (v: boolean) => void;
  showChat: boolean;
  setShowChat: (v: boolean) => void;
}

const PlayerHeader = ({
  navigate,
  playerTitle,
  qualityOptions,
  currentQuality,
  changeQuality,
  activeQualityLabel,
  liveId,
  markers,
  showMarkers,
  setShowMarkers,
  showChat,
  setShowChat,
}: PlayerHeaderProps) => (
  <div
    style={{
      backgroundColor: '#18181b',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      borderBottom: '1px solid #3a3a3d',
      zIndex: 10,
      flexShrink: 0,
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
        marginRight: '15px',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      &larr; Back
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

    {qualityOptions.length > 0 && (
      <select
        value={currentQuality}
        onChange={(event) => changeQuality(Number(event.target.value))}
        style={{
          color: '#efeff1',
          fontSize: '13px',
          fontWeight: 700,
          padding: '4px 8px',
          borderRadius: '8px',
          backgroundColor: '#242a43',
          marginRight: '10px',
          border: 'none',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value={-1}>Auto</option>
        {qualityOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    )}

    {qualityOptions.length === 0 && activeQualityLabel && (
      <span
        style={{
          color: '#efeff1',
          fontSize: '13px',
          fontWeight: 700,
          padding: '4px 8px',
          borderRadius: '8px',
          backgroundColor: '#242a43',
          marginRight: '10px',
        }}
      >
        {activeQualityLabel}
      </span>
    )}

    {!liveId && (
      <button
        onClick={() => setShowMarkers(!showMarkers)}
        style={{
          background: 'none',
          border: 'none',
          color: '#9146ff',
          cursor: 'pointer',
          fontWeight: 'bold',
          marginRight: '10px',
        }}
      >
        Chapters ({markers.length})
      </button>
    )}

    <button
      onClick={() => setShowChat(!showChat)}
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
);

const InfoEncart = ({
  liveInfo,
  vodInfo,
  isFullscreen,
}: {
  liveInfo: LiveStream | null;
  vodInfo: VOD | null;
  isFullscreen: boolean;
}) => {
  if (isFullscreen || (!vodInfo && !liveInfo)) return null;

  return (
    <div style={{ padding: '20px', backgroundColor: '#07080f', color: '#efeff1', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
        <img
          src={
            liveInfo ? liveInfo.broadcaster?.profileImageURL : vodInfo?.owner?.profileImageURL || ''
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
          <h1 style={{ margin: '0 0 8px 0', fontSize: '1.4rem', lineHeight: '1.3' }}>
            {liveInfo ? liveInfo.title : vodInfo?.title}
          </h1>
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
              🎮 {liveInfo ? liveInfo.game?.name : vodInfo?.game?.name || 'No Category'}
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
                  🔴 {(liveInfo.viewerCount || 0).toLocaleString()} viewers
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
                  👁️ {(vodInfo.viewCount || 0).toLocaleString()} vues
                </span>
                <span
                  style={{
                    backgroundColor: '#18181b',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                >
                  📅 {new Date(vodInfo.createdAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ChatSidebar = ({
  liveId,
  showChat,
  visibleChat,
  chatScrollRef,
}: {
  liveId: string | null;
  showChat: boolean;
  visibleChat: ChatMessage[];
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
}) => {
  if (!showChat) return null;

  return (
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {globalThis.location.hostname === 'localhost' ||
          globalThis.location.hostname === '127.0.0.1' ||
          globalThis.location.hostname === 'tauri.localhost' ? (
            <iframe
              src={`https://www.twitch.tv/embed/${encodeURIComponent(liveId)}/chat?parent=${globalThis.location.hostname}&darkpopout=true`}
              width="100%"
              height="100%"
              style={{ border: 'none' }}
              title="Twitch Chat"
            />
          ) : (
            <iframe
              src={`/api/live/${encodeURIComponent(liveId)}/chat.html`}
              width="100%"
              height="100%"
              style={{ border: 'none' }}
              title="Twitch Chat Proxy"
            />
          )}
        </div>
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

          <div
            ref={chatScrollRef}
            style={{ flex: 1, overflowY: 'auto', padding: '10px' }}
            className="chat-container"
          >
            {visibleChat.map((message) => (
              <div key={message.id} style={{ marginBottom: '8px', fontSize: '0.85rem', lineHeight: '1.4' }}>
                <span style={{ color: '#adadb8', marginRight: '8px', fontSize: '0.75rem' }}>
                  {Math.floor(message.contentOffsetSeconds / 3600)}:
                  {Math.floor((message.contentOffsetSeconds % 3600) / 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
                <span style={{ fontWeight: 'bold', color: '#efeff1' }}>
                  {message.commenter?.displayName || 'Unknown'}:{' '}
                </span>
                <span style={{ color: '#efeff1' }}>
                  {(message as any).message?.fragments?.map((fragment: any) => fragment.text).join('')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default function Player() {
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get('vod');
  const liveId = searchParams.get('live');
  const navigate = useNavigate();

  const playerViewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const lastChatOffsetRef = useRef(-1);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [activeQualityLabel, setActiveQualityLabel] = useState('');

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showChat, setShowChat] = useState(window.innerWidth > 1024);
  const [isFetchingChat, setIsFetchingChat] = useState(false);

  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showMarkers, setShowMarkers] = useState(false);

  const [vodInfo, setVodInfo] = useState<VOD | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveStream | null>(null);

  const useDesktopEnhancedPlayer = useMemo(() => {
    if (typeof navigator === 'undefined') return true;

    const userAgent = navigator.userAgent || '';
    const isIPadOS = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
    const isMobileDevice =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || isIPadOS;

    return !isMobileDevice;
  }, []);

  const canSeek = Boolean(vodId) && Number.isFinite(duration) && duration > 0;

  const playerTitle = useMemo(() => resolvePlayerTitle(vodId, liveId), [liveId, vodId]);

  const visibleChat = useMemo(() => {
    return chatMessages.filter(
      (message) =>
        message.contentOffsetSeconds <= currentTime &&
        message.contentOffsetSeconds > currentTime - 60
    );
  }, [chatMessages, currentTime]);

  const destroyPlaybackResources = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setQualityOptions([]);
    setCurrentQuality(-1);
    setActiveQualityLabel('');
  }, []);

  const clearControlsHideTimer = useCallback(() => {
    if (hideControlsTimeoutRef.current !== null) {
      globalThis.clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    if (!useDesktopEnhancedPlayer) return;

    clearControlsHideTimer();
    if (!isPlaying) {
      setControlsVisible(true);
      return;
    }

    hideControlsTimeoutRef.current = globalThis.setTimeout(() => {
      setControlsVisible(false);
    }, 3000);
  }, [clearControlsHideTimer, isPlaying, useDesktopEnhancedPlayer]);

  const revealControls = useCallback(() => {
    if (!useDesktopEnhancedPlayer) return;
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide, useDesktopEnhancedPlayer]);

  const fetchChat = useCallback(
    async (offset: number) => {
      if (!vodId) return;
      if (isFetchingChat || offset === lastChatOffsetRef.current) return;

      setIsFetchingChat(true);
      try {
        const res = await fetch(`/api/vod/${vodId}/chat?offset=${offset}`);
        if (!res.ok) return;

        const data = await res.json();
        setChatMessages((prev) => {
          const existingIds = new Set(prev.map((message) => message.id));
          const newMsgs = data.messages.filter((message: any) => !existingIds.has(message.id));
          if (newMsgs.length === 0) return prev;

          return [...prev, ...newMsgs].sort(
            (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds
          );
        });

        lastChatOffsetRef.current = offset;
      } catch (error) {
        console.error('Failed to fetch chat', error);
      } finally {
        setIsFetchingChat(false);
      }
    },
    [isFetchingChat, vodId]
  );

  const initializeStream = useCallback(
    async (
      video: HTMLVideoElement,
      streamUrl: string,
      initialTime: number,
      settings?: ExperienceSettings
    ) => {
      video.controls = !useDesktopEnhancedPlayer;

      const playVideo = () => {
        if (initialTime > 0) video.currentTime = initialTime;
        void Promise.resolve(video.play()).catch((err) => console.log('Auto-play blocked', err));
      };

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        try {
          const resp = await fetch(streamUrl);
          if (resp.ok) {
            const text = await resp.text();
            const allOptions = parseNativeHlsManifest(text, globalThis.location.origin);
            const filtered = filterQualityOptions(allOptions, settings?.minVideoQuality);
            setQualityOptions(filtered);

            const targetIdx = getPreferredLevelIndex(filtered, settings?.preferredVideoQuality);
            if (targetIdx === -1) {
              video.src = streamUrl;
              setActiveQualityLabel('');
              setCurrentQuality(-1);
            } else {
              const opt = filtered.find((o) => o.id === targetIdx) || filtered[0];
              video.src = opt?.url || streamUrl;
              setActiveQualityLabel(opt?.label || '');
              setCurrentQuality(targetIdx);
            }

            video.addEventListener('loadedmetadata', playVideo, { once: true });
            return;
          }
        } catch (e) {
          console.error('Failed to parse native m3u8', e);
        }
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', playVideo, { once: true });
        return;
      }

      const Hls = await loadHlsLibrary();
      if (!Hls?.isSupported?.()) {
        video.src = streamUrl;
        return;
      }

      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const allOptions = hls.levels.map((lvl: any, idx: number) => ({
          id: idx,
          label: lvl?.height ? `${lvl.height}p` : lvl?.name || `Quality ${idx + 1}`,
          height: lvl.height,
        }));

        const filtered = filterQualityOptions(allOptions, settings?.minVideoQuality);
        setQualityOptions(filtered);

        // Configure Hls.js min bitrate
        const minQ = Number.parseInt(settings?.minVideoQuality || 'none', 10);
        if (!Number.isNaN(minQ)) {
          const minLevel = hls.levels.find((l: any) => l.height >= minQ);
          if (minLevel?.bitrate) hls.config.minAutoBitrate = minLevel.bitrate;
        }

        const targetIdx = getPreferredLevelIndex(allOptions, settings?.preferredVideoQuality);
        hls.currentLevel = targetIdx;
        hls.nextLevel = targetIdx;
        setCurrentQuality(targetIdx);
        setActiveQualityLabel(targetIdx === -1 ? '' : allOptions[targetIdx]?.label || '');

        playVideo();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
        const lvl = hls.levels?.[data?.level];
        if (lvl) setActiveQualityLabel(lvl.height ? `${lvl.height}p` : lvl.name || '');
      });
    },
    [useDesktopEnhancedPlayer]
  );

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [visibleChat]);

  useEffect(() => {
    const onFullScreenChanged = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', onFullScreenChanged);
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreenChanged);
    };
  }, []);

  useEffect(() => {
    if (!useDesktopEnhancedPlayer) return;

    if (!isPlaying) {
      clearControlsHideTimer();
      setControlsVisible(true);
      return;
    }

    scheduleControlsHide();
    return () => {
      clearControlsHideTimer();
    };
  }, [clearControlsHideTimer, isPlaying, scheduleControlsHide, useDesktopEnhancedPlayer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      if (!vodId) return;
      const minuteOffset = Math.floor(time / 60) * 60;
      if (minuteOffset !== lastChatOffsetRef.current) {
        void fetchChat(minuteOffset);
      }
    };

    const onDurationChanged = () => {
      const value = Number.isFinite(video.duration) ? video.duration : 0;
      setDuration(value);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted || video.volume <= 0);
    };
    const onRateChange = () => setPlaybackRate(video.playbackRate);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChanged);
    video.addEventListener('loadedmetadata', onDurationChanged);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChanged);
      video.removeEventListener('loadedmetadata', onDurationChanged);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
    };
  }, [fetchChat, vodId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;

    const run = async () => {
      if (!vodId) return;

      let initialTime = 0;
      let settingsRes: ExperienceSettings | undefined;

      try {
        const [histRes, markersRes, settings, infoRes] = await Promise.all([
          fetch(`/api/history/${vodId}`),
          fetch(`/api/vod/${vodId}/markers`),
          fetch('/api/settings'),
          fetch(`/api/vod/${vodId}/info`),
        ]);

        if (histRes.ok) {
          const hist = await histRes.json();
          if (hist?.timecode) {
            initialTime = Math.max(0, hist.timecode - 5);
          }
        }

        if (markersRes.ok) {
          setMarkers(await markersRes.json());
        } else {
          setMarkers([]);
        }

        if (settings.ok) {
          settingsRes = await settings.json();
        }

        if (infoRes.ok) {
          setVodInfo(await infoRes.json());
        }
      } catch (error) {
        console.error('Failed to fetch initial data', error);
      }

      if (disposed) return;
      await initializeStream(video, `/api/vod/${vodId}/master.m3u8`, initialTime, settingsRes);
    };

    void run();

    return () => {
      disposed = true;
      destroyPlaybackResources();
    };
  }, [destroyPlaybackResources, initializeStream, vodId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;

    const run = async () => {
      if (!liveId) return;

      let settingsRes: ExperienceSettings | undefined;
      try {
        const [settings, infoRes] = await Promise.all([
          fetch('/api/settings'),
          fetch(`/api/user/${encodeURIComponent(liveId)}/live`),
        ]);
        if (settings.ok) {
          settingsRes = await settings.json();
        }
        if (infoRes.ok) {
          setLiveInfo(await infoRes.json());
        }
      } catch (error) {
        console.error('Failed to fetch data', error);
      }

      setMarkers([]);
      if (disposed) return;
      await initializeStream(
        video,
        `/api/live/${encodeURIComponent(liveId)}/master.m3u8`,
        0,
        settingsRes
      );
    };

    void run();

    return () => {
      disposed = true;
      destroyPlaybackResources();
    };
  }, [destroyPlaybackResources, initializeStream, liveId]);

  useEffect(() => {
    if (!vodId) return;

    const video = videoRef.current;
    if (!video) return;

    const saveProgress = () => {
      if (video.currentTime <= 0) return;
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId,
          timecode: video.currentTime,
          duration: video.duration || 0,
        }),
      }).catch((error) => {
        console.error('Failed to save history', error);
      });
    };

    const intervalId = setInterval(() => {
      if (!video.paused) saveProgress();
    }, 10000);

    video.addEventListener('pause', saveProgress);

    return () => {
      clearInterval(intervalId);
      video.removeEventListener('pause', saveProgress);
      saveProgress();
    };
  }, [vodId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (videoRef.current) {
        handlePlayerKeyDown(e, videoRef.current, canSeek, playerViewportRef.current);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [canSeek]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) void video.play().catch((err) => console.log('Play failed', err));
      else video.pause();
    }
  };

  const handleSeek = (value: number) => {
    if (videoRef.current && canSeek) {
      videoRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };

  const handleVolume = (nextVolume: number) => {
    const video = videoRef.current;
    if (video) {
      const clamped = Math.max(0, Math.min(1, nextVolume));
      video.volume = clamped;
      video.muted = clamped === 0;
      setVolume(clamped);
      setIsMuted(clamped === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const changeSpeed = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const changeQualityHls = (value: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = value;
      hlsRef.current.nextLevel = value;
    }
  };

  const changeQualityNative = (value: number) => {
    const video = videoRef.current;
    if (!video || qualityOptions.length === 0) return;

    const time = video.currentTime;
    const isPlayingBefore = !video.paused;

    if (value < 0) {
      video.src = vodId
        ? `/api/vod/${vodId}/master.m3u8`
        : `/api/live/${encodeURIComponent(liveId!)}/master.m3u8`;
      setActiveQualityLabel('');
    } else {
      const opt = qualityOptions.find((o) => o.id === value);
      if (opt?.url) {
        video.src = opt.url;
        setActiveQualityLabel(opt.label);
      }
    }

    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = time;
        if (isPlayingBefore) void video.play().catch(() => {});
      },
      { once: true }
    );
  };

  const changeQuality = (value: number) => {
    setCurrentQuality(value);
    if (hlsRef.current) changeQualityHls(value);
    else changeQualityNative(value);
  };

  const toggleFullscreen = async () => {
    const viewport = playerViewportRef.current;
    if (!viewport) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    await viewport.requestFullscreen().catch(() => undefined);
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
        overscrollBehavior: 'none',
      }}
    >
      {!isFullscreen && (
        <PlayerHeader
          navigate={navigate}
          playerTitle={playerTitle}
          qualityOptions={qualityOptions}
          currentQuality={currentQuality}
          changeQuality={changeQuality}
          activeQualityLabel={activeQualityLabel}
          liveId={liveId}
          markers={markers}
          showMarkers={showMarkers}
          setShowMarkers={setShowMarkers}
          showChat={showChat}
          setShowChat={setShowChat}
        />
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
            ref={playerViewportRef}
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
            <video
              ref={videoRef}
              controls={!useDesktopEnhancedPlayer}
              playsInline
              onMouseMove={revealControls}
              onMouseEnter={revealControls}
              style={{ width: '100%', height: '100%', outline: 'none' }}
            >
              <track kind="captions" />
            </video>

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
                      if (videoRef.current) {
                        videoRef.current.currentTime = marker.displayTime;
                        setShowMarkers(false);
                      }
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
                      {Math.floor(marker.displayTime / 3600)}h
                      {Math.floor((marker.displayTime % 3600) / 60)}m
                    </span>
                    {marker.description}
                  </button>
                ))}
              </div>
            )}

            {useDesktopEnhancedPlayer && (
              <div
                style={{
                  position: 'absolute',
                  left: '12px',
                  right: '12px',
                  bottom: '12px',
                  backgroundColor: 'rgba(14, 16, 24, 0.88)',
                  border: '1px solid #2b2d38',
                  borderRadius: '12px',
                  padding: '11px 14px',
                  display: 'grid',
                  gap: '8px',
                  zIndex: 100,
                  pointerEvents: controlsVisible ? 'auto' : 'none',
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 8px 26px rgba(0,0,0,0.42)',
                  opacity: controlsVisible ? 1 : 0,
                  transform: controlsVisible ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 180ms ease, transform 180ms ease',
                }}
              >
                <input
                  type="range"
                  min={0}
                  max={canSeek ? Math.max(duration, 1) : 1}
                  step={0.1}
                  value={canSeek ? Math.min(currentTime, duration) : 0}
                  disabled={!canSeek}
                  onChange={(event) => handleSeek(Number(event.target.value))}
                  style={{
                    width: '100%',
                    accentColor: '#8f57ff',
                    cursor: canSeek ? 'pointer' : 'default',
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: '#f1f1f1',
                    fontSize: '13px',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    onClick={togglePlay}
                    type="button"
                    style={{
                      border: '1px solid #3a3a3d',
                      background: '#1b1e2b',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>

                  <span style={{ minWidth: '110px' }}>
                    {liveId ? 'LIVE' : `${formatClock(currentTime)} / ${formatClock(duration)}`}
                  </span>

                  <button
                    onClick={toggleMute}
                    type="button"
                    style={{
                      border: '1px solid #3a3a3d',
                      background: '#1b1e2b',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {isMuted ? 'Unmute' : 'Mute'}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(event) => handleVolume(Number(event.target.value))}
                    style={{ width: '120px', accentColor: '#8f57ff', cursor: 'pointer' }}
                  />

                  <select
                    value={playbackRate}
                    onChange={(event) => changeSpeed(Number(event.target.value))}
                    style={{
                      border: '1px solid #3a3a3d',
                      background: '#1b1e2b',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '7px 10px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}x
                      </option>
                    ))}
                  </select>

                  {qualityOptions.length > 0 && (
                    <select
                      value={currentQuality}
                      onChange={(event) => changeQuality(Number(event.target.value))}
                      style={{
                        border: '1px solid #3a3a3d',
                        background: '#1b1e2b',
                        color: '#fff',
                        borderRadius: '8px',
                        padding: '7px 10px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      <option value={-1}>Auto</option>
                      {qualityOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    onClick={() => {
                      void toggleFullscreen();
                    }}
                    type="button"
                    style={{
                      marginLeft: 'auto',
                      border: '1px solid #3a3a3d',
                      background: '#1b1e2b',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <InfoEncart liveInfo={liveInfo} vodInfo={vodInfo} isFullscreen={isFullscreen} />
        </div>

        <ChatSidebar
          liveId={liveId}
          showChat={showChat}
          visibleChat={visibleChat}
          chatScrollRef={chatScrollRef}
        />
      </div>
    </div>
  );
}

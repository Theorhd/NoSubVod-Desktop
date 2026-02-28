import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ChatMessage, VideoMarker } from '../../shared/types';

export default function Player() {
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get('vod');
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [currentTime, setCurrentTime] = useState(0);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [lastChatOffset, setLastChatOffset] = useState(-1);
  const [isFetchingChat, setIsFetchingChat] = useState(false);

  // Markers State
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showMarkers, setShowMarkers] = useState(false);

  // Settings State
  const [playbackRate, setPlaybackRate] = useState(1);
  const [qualities, setQualities] = useState<{ id: number; name: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1); // -1 for auto
  const [showSettings, setShowSettings] = useState(false);

  const hlsRef = useRef<any>(null);

  const visibleChat = useMemo(() => {
    return chatMessages.filter(
      (m) => m.contentOffsetSeconds <= currentTime && m.contentOffsetSeconds > currentTime - 60
    );
  }, [chatMessages, currentTime]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [visibleChat]);

  const fetchChat = async (offset: number) => {
    if (isFetchingChat || offset === lastChatOffset) return;
    setIsFetchingChat(true);
    try {
      const res = await fetch(`/api/vod/${vodId}/chat?offset=${offset}`);
      if (!res.ok) return;

      const data = await res.json();
      setChatMessages((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newMsgs = data.messages.filter((m: any) => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;

        return [...prev, ...newMsgs].sort(
          (a, b) => a.contentOffsetSeconds - b.contentOffsetSeconds
        );
      });
      setLastChatOffset(offset);
    } catch (e) {
      console.error('Failed to fetch chat', e);
    } finally {
      setIsFetchingChat(false);
    }
  };

  const setupHls = (video: HTMLVideoElement, streamUrl: string, initialTime: number) => {
    const Hls = (globalThis as any).Hls;
    if (!Hls) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (initialTime > 0) video.currentTime = initialTime;
        const levels = hls.levels.map((l: any, i: number) => ({
          id: i,
          name: l.name || `${l.height}p`,
        }));
        setQualities(levels);
        video.play().catch((e) => console.log('Auto-play prevented', e));
      });
    }
  };

  const initPlayer = async (video: HTMLVideoElement, vodId: string) => {
    let initialTime = 0;
    try {
      const [histRes, markersRes] = await Promise.all([
        fetch(`/api/history/${vodId}`),
        fetch(`/api/vod/${vodId}/markers`),
      ]);

      if (histRes.ok) {
        const hist = await histRes.json();
        if (hist?.timecode) initialTime = Math.max(0, hist.timecode - 5);
      }
      if (markersRes.ok) {
        setMarkers(await markersRes.json());
      }
    } catch (e) {
      console.error('Failed to fetch initial data', e);
    }

    const streamUrl = `/api/vod/${vodId}/master.m3u8`;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (initialTime > 0) video.currentTime = initialTime;
        video.play().catch((e) => console.log('Auto-play prevented', e));
      });
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      script.onload = () => setupHls(video, streamUrl, initialTime);
      document.body.appendChild(script);
    }
  };

  useEffect(() => {
    if (!vodId) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    initPlayer(video, vodId);

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      const minuteOffset = Math.floor(time / 60) * 60;
      if (minuteOffset !== lastChatOffset) {
        fetchChat(minuteOffset);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);

    const saveProgress = () => {
      if (video.currentTime > 0) {
        fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vodId,
            timecode: video.currentTime,
            duration: video.duration || 0,
          }),
        }).catch((e) => console.error('Failed to save history', e));
      }
    };

    const intervalId = setInterval(() => {
      if (!video.paused) saveProgress();
    }, 10000);

    video.addEventListener('pause', saveProgress);

    return () => {
      clearInterval(intervalId);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', saveProgress);
      saveProgress();
      if (hlsRef.current) hlsRef.current.destroy();
      const script = document.querySelector(
        'script[src="https://cdn.jsdelivr.net/npm/hls.js@latest"]'
      );
      if (script) script.remove();
    };
  }, [vodId]);

  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const changeQuality = (index: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
      setCurrentQuality(index);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#000',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div
          style={{
            backgroundColor: '#18181b',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #3a3a3d',
            zIndex: 10,
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
            {vodId ? `VOD: ${vodId}` : 'Error'}
          </h2>

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

        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <video
            ref={videoRef}
            controls
            playsInline
            style={{ width: '100%', height: '100%', outline: 'none' }}
          >
            <track kind="captions" />
          </video>

          {showMarkers && markers.length > 0 && (
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
              {markers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = m.displayTime;
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
                    {Math.floor(m.displayTime / 3600)}h{Math.floor((m.displayTime % 3600) / 60)}m
                  </span>
                  {m.description}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              position: 'absolute',
              bottom: '60px',
              right: '20px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              color: 'white',
              cursor: 'pointer',
              zIndex: 25,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '20px',
            }}
          >
            ⚙️
          </button>

          {showSettings && (
            <div
              style={{
                position: 'absolute',
                bottom: '110px',
                right: '20px',
                backgroundColor: 'rgba(24,24,27,0.95)',
                padding: '15px',
                borderRadius: '8px',
                zIndex: 30,
                width: '200px',
                border: '1px solid #3a3a3d',
                color: 'white',
              }}
            >
              <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Speed</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '15px' }}>
                {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    onClick={() => changePlaybackRate(r)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: playbackRate === r ? '#9146ff' : '#3a3a3d',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    {r}x
                  </button>
                ))}
              </div>

              {qualities.length > 0 && (
                <>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Quality</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button
                      onClick={() => changeQuality(-1)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: currentQuality === -1 ? '#9146ff' : '#3a3a3d',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        textAlign: 'left',
                      }}
                    >
                      Auto
                    </button>
                    {qualities.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => changeQuality(q.id)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: currentQuality === q.id ? '#9146ff' : '#3a3a3d',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          textAlign: 'left',
                        }}
                      >
                        {q.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showChat && (
        <div
          style={{
            width: '340px',
            backgroundColor: '#0e0e10',
            borderLeft: '1px solid #3a3a3d',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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
            {visibleChat.map((msg) => (
              <div
                key={msg.id}
                style={{ marginBottom: '8px', fontSize: '0.85rem', lineHeight: '1.4' }}
              >
                <span style={{ color: '#adadb8', marginRight: '8px', fontSize: '0.75rem' }}>
                  {Math.floor(msg.contentOffsetSeconds / 3600)}:
                  {Math.floor((msg.contentOffsetSeconds % 3600) / 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
                <span style={{ fontWeight: 'bold', color: '#efeff1' }}>
                  {msg.commenter?.displayName || 'Unknown'}:{' '}
                </span>
                <span style={{ color: '#efeff1' }}>
                  {(msg as any).message?.fragments?.map((f: any) => f.text).join('')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

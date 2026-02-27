import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function Player() {
  const [searchParams] = useSearchParams();
  const vodId = searchParams.get('vod');
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vodId) {
      setError('No VOD ID provided in URL');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const streamUrl = `/api/vod/${vodId}/master.m3u8`;

    // Check for native HLS support (Safari / iOS)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(e => console.log("Auto-play prevented", e));
      });
      video.addEventListener('error', () => {
        setError('Error loading native stream.');
      });
    } else {
      // Fallback to Hls.js for other browsers dynamically
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      script.onload = () => {
        const Hls = (window as any).Hls;
        if (Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(e => console.log("Auto-play prevented", e));
          });
          hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
              setError(`HLS Error: ${data.type} - ${data.details}`);
            }
          });
        } else {
          setError('Your browser does not support HLS video playback.');
        }
      };
      document.body.appendChild(script);
      
      return () => {
        document.body.removeChild(script);
      };
    }
  }, [vodId]);

  return (
    <div style={{ margin: 0, padding: 0, width: '100vw', height: '100vh', backgroundColor: '#000', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ backgroundColor: '#18181b', padding: '10px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #3a3a3d', zIndex: 10 }}>
        <button onClick={() => navigate(-1)} style={{ color: '#efeff1', fontSize: '14px', fontWeight: 'bold', padding: '5px 10px', backgroundColor: '#3a3a3d', borderRadius: '4px', marginRight: '15px', border: 'none', cursor: 'pointer' }}>&larr; Back</button>
        <h2 style={{ color: 'white', fontSize: '16px', margin: 0, flexGrow: 1 }}>{vodId ? `VOD: ${vodId}` : 'Error'}</h2>
      </div>
      <div style={{ flexGrow: 1, position: 'relative', background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <video ref={videoRef} controls playsInline style={{ width: '100%', height: '100%', maxHeight: '100%', outline: 'none' }}></video>
        {error && (
          <div style={{ position: 'absolute', color: '#000', background: 'rgba(255, 0, 0, 0.8)', padding: '10px 20px', borderRadius: '4px' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
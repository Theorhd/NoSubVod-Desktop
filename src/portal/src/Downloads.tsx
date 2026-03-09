import React, { useEffect, useRef, useState } from 'react';
import { Download as DownloadIcon, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { VOD } from '../../shared/types';

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

function bindHlsEvents(hlsInstance: any, Hls: any, video: HTMLVideoElement, setPlaybackError: (err: string | null) => void) {
  hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
    console.log('[Downloads][hls] MANIFEST_PARSED', { levels: data?.levels?.length });
    void video.play().catch((e: any) => {
      console.warn('[Downloads] autoplay blocked:', e?.message);
    });
  });
  hlsInstance.on(Hls.Events.LEVEL_LOADED, (_event: any, data: any) => {
    console.log('[Downloads][hls] LEVEL_LOADED', { fragments: data?.details?.fragments?.length, totalduration: data?.details?.totalduration });
  });
  hlsInstance.on(Hls.Events.FRAG_LOADING, (_event: any, data: any) => {
    console.log('[Downloads][hls] FRAG_LOADING', { url: data?.frag?.url?.substring(0, 120) });
  });
  hlsInstance.on(Hls.Events.FRAG_LOADED, (_event: any, data: any) => {
    console.log('[Downloads][hls] FRAG_LOADED', { bytes: data?.frag?.stats?.total, url: data?.frag?.url?.substring(0, 120) });
  });
  hlsInstance.on(Hls.Events.BUFFER_APPENDING, () => {
    console.log('[Downloads][hls] BUFFER_APPENDING');
  });
  hlsInstance.on(Hls.Events.BUFFER_APPENDED, () => {
    console.log('[Downloads][hls] BUFFER_APPENDED');
  });
  hlsInstance.on(Hls.Events.ERROR, (_event: any, data: any) => {
    console.error('[Downloads][hls] ERROR', { type: data?.type, details: data?.details, fatal: data?.fatal, reason: data?.reason, response: data?.response?.code });
    if (!data?.fatal) return;
    setPlaybackError('Lecture impossible: format non supporte dans le lecteur integre.');
  });
}

function bindVideoEvents(video: HTMLVideoElement) {
  const onLoadStart = () => console.log('[Downloads][video] loadstart');
  const onLoadedMetadata = () => console.log('[Downloads][video] loadedmetadata', { duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight });
  const onLoadedData = () => console.log('[Downloads][video] loadeddata');
  const onCanPlay = () => console.log('[Downloads][video] canplay');
  const onCanPlayThrough = () => console.log('[Downloads][video] canplaythrough');
  const onPlaying = () => console.log('[Downloads][video] playing');
  const onWaiting = () => console.log('[Downloads][video] waiting (buffering)');
  const onStalled = () => console.log('[Downloads][video] stalled');
  const onSuspend = () => console.log('[Downloads][video] suspend');
  const onError = () => {
    const err = video.error;
    console.error('[Downloads][video] error event', { code: err?.code, message: err?.message });
  };

  video.addEventListener('loadstart', onLoadStart);
  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('loadeddata', onLoadedData);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('canplaythrough', onCanPlayThrough);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('stalled', onStalled);
  video.addEventListener('suspend', onSuspend);
  video.addEventListener('error', onError);

  return () => {
    video.removeEventListener('loadstart', onLoadStart);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('loadeddata', onLoadedData);
    video.removeEventListener('canplay', onCanPlay);
    video.removeEventListener('canplaythrough', onCanPlayThrough);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('stalled', onStalled);
    video.removeEventListener('suspend', onSuspend);
    video.removeEventListener('error', onError);
  };
}

interface DownloadedFile {
  name: string;
  size: number;
  url: string;
  metadata?: VOD | null;
}

interface ActiveDownload {
  vod_id: string;
  title: string;
  status: any; // { Queued: null } | { Downloading: null } | { Finished: null } | { Error: string }
  progress: number;
  current_time: string;
  total_duration: number;
}

export default function Downloads() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingFile, setPlayingFile] = useState<DownloadedFile | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const fetchDownloads = async () => {
    try {
      const [filesRes, activeRes] = await Promise.all([
        fetch('/api/downloads'),
        fetch('/api/downloads/active'),
      ]);

      console.log('[Downloads] fetch /api/downloads status:', filesRes.status);
      console.log('[Downloads] fetch /api/downloads/active status:', activeRes.status);

      if (filesRes.ok) {
        const data = await filesRes.json();
        console.log('[Downloads] files received:', data.length, 'files', data.map((f: any) => ({ name: f.name, size: f.size, url: f.url })));
        setFiles(data);
      } else {
        console.error('[Downloads] /api/downloads failed:', filesRes.status, await filesRes.text().catch(() => ''));
      }

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveDownloads(data);
      }
    } catch (e) {
      console.error('[Downloads] Failed to fetch downloads', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDownloads();
    const interval = setInterval(fetchDownloads, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const resolveDownloadUrl = (url: string) => {
    if (!url) { console.warn('[Downloads] resolveDownloadUrl: empty url'); return ''; }
    let resolved: string;
    if (url.startsWith('/api/')) resolved = url;
    else if (url.startsWith('/shared-downloads/')) resolved = `/api${url}`;
    else if (url.startsWith('/')) resolved = `/api${url}`;
    else resolved = `/api/${url}`;
    console.log('[Downloads] resolveDownloadUrl:', url, '->', resolved);
    return resolved;
  };

  const isTsFile = (file: DownloadedFile | null) =>
    !!file?.name.toLowerCase().endsWith('.ts');

  useEffect(() => {
    setPlaybackError(null);

    const video = videoRef.current;
    console.log('[Downloads] playback useEffect triggered', {
      hasVideo: !!video,
      playingFile: playingFile ? { name: playingFile.name, url: playingFile.url, size: playingFile.size } : null,
      isTs: isTsFile(playingFile),
    });

    if (!video || !playingFile) {
      console.log('[Downloads] no video element or no playingFile, skipping');
      return;
    }

    // Attach diagnostic video element listeners
    const cleanupVideoListeners = bindVideoEvents(video);

    if (!isTsFile(playingFile)) {
      const directUrl = resolveDownloadUrl(playingFile.url);
      console.log('[Downloads] non-TS file, using direct src:', directUrl);

      // Probe the URL first
      fetch(directUrl, { method: 'HEAD' }).then(r => {
        console.log('[Downloads] HEAD probe', directUrl, ':', r.status, r.headers.get('content-type'), 'content-length:', r.headers.get('content-length'));
      }).catch(e => console.error('[Downloads] HEAD probe failed', directUrl, e));

      return cleanupVideoListeners;
    }

    let disposed = false;
    let hlsInstance: any = null;

    const hlsUrl = `/api/downloads/hls/${encodeURIComponent(playingFile.name)}`;
    console.log('[Downloads] .ts file detected, using HLS url:', hlsUrl);

    // Probe the HLS playlist
    fetch(hlsUrl).then(async r => {
      const text = await r.text();
      console.log('[Downloads] HLS playlist response:', r.status, r.headers.get('content-type'), '\n---\n' + text + '\n---');
    }).catch(e => console.error('[Downloads] HLS playlist fetch failed', e));

    const setupHlsPlayback = async () => {
      try {
        console.log('[Downloads] loading hls.js library...');
        const Hls = await loadHlsLibrary();
        console.log('[Downloads] hls.js loaded, isSupported:', Hls?.isSupported?.());
        if (disposed) { console.log('[Downloads] disposed before setup, aborting'); return; }

        if (Hls?.isSupported?.()) {
          hlsInstance = new Hls({ debug: false });
          bindHlsEvents(hlsInstance, Hls, video, setPlaybackError);

          console.log('[Downloads][hls] loadSource + attachMedia');
          hlsInstance.loadSource(hlsUrl);
          hlsInstance.attachMedia(video);
          return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('[Downloads] native HLS support, setting src directly');
          video.src = hlsUrl;
          void video.play().catch((e: any) => {
            console.warn('[Downloads] native HLS autoplay blocked:', e?.message);
          });
          return;
        }

        console.error('[Downloads] no HLS support available');
        setPlaybackError('Votre lecteur integre ne prend pas en charge ce format video.');
      } catch (err) {
        console.error('[Downloads] setupHlsPlayback exception:', err);
        setPlaybackError('Impossible de charger le moteur de lecture pour ce fichier.');
      }
    };

    void setupHlsPlayback();

    return () => {
      disposed = true;
      cleanupVideoListeners();
      if (hlsInstance) {
        console.log('[Downloads] destroying hls instance');
        hlsInstance.destroy();
      }
    };
  }, [playingFile]);
 
  const getStatusDisplay = (status: any) => {
    if (status === 'Queued')
      return { label: 'En attente', icon: <Clock size={16} />, color: 'var(--text-muted)' };
    if (status === 'Downloading')
      return {
        label: 'Téléchargement...',
        icon: <DownloadIcon size={16} className="spinning" />,
        color: '#9146ff',
      };
    if (status === 'Finished')
      return { label: 'Terminé', icon: <CheckCircle2 size={16} />, color: '#4ade80' };
    if (status && typeof status === 'object' && 'Error' in status) {
      return {
        label: `Erreur: ${status.Error}`,
        icon: <AlertCircle size={16} />,
        color: '#ff4a4a',
      };
    }
    return { label: 'Inconnu', icon: null, color: 'var(--text-muted)' };
  };

  return (
    <>
      <div className="top-bar">
        <h1>Downloads</h1>
      </div>

      <div className="container">
        {playingFile && (
          <div
            style={{
              marginBottom: '32px',
              background: '#0e0e10',
              padding: '16px',
              borderRadius: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h2 style={{ fontSize: '1.2rem', margin: 0 }}>{playingFile.name}</h2>
              <button
                onClick={() => setPlayingFile(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ff4a4a',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Fermer
              </button>
            </div>
            <video
              ref={videoRef}
              key={playingFile.name}
              controls
              autoPlay
              src={isTsFile(playingFile) ? undefined : resolveDownloadUrl(playingFile.url)}
              onError={(e) => {
                const vid = e.currentTarget;
                console.error('[Downloads][video] onError in JSX', { code: vid.error?.code, message: vid.error?.message, src: vid.src?.substring(0, 120), networkState: vid.networkState, readyState: vid.readyState });
                setPlaybackError('Lecture impossible: verifiez le format ou telechargez le fichier.');
              }}
              style={{ width: '100%', borderRadius: '8px', maxHeight: '60vh', background: 'black' }}
            >
              <track kind="captions" />
              Votre navigateur ne supporte pas la balise vidéo.
            </video>
            {playbackError && (
              <div
                style={{
                  marginTop: '10px',
                  color: '#ff8b8b',
                  fontSize: '0.9rem',
                }}
              >
                {playbackError}
              </div>
            )}
          </div>
        )}

        {activeDownloads.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: 'var(--text-muted)' }}>
              Téléchargements actifs
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {activeDownloads.map((dl) => {
                const statusInfo = getStatusDisplay(dl.status);
                return (
                  <div key={dl.vod_id} className="card" style={{ padding: '16px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 'bold' }}>{dl.title}</div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: statusInfo.color,
                          fontSize: '0.9rem',
                        }}
                      >
                        {statusInfo.icon}
                        {statusInfo.label}
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'var(--surface-soft)',
                        height: '8px',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        marginBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: `${dl.progress}%`,
                          height: '100%',
                          background: statusInfo.color,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span>{dl.progress.toFixed(1)}%</span>
                      <span>{dl.current_time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: 'var(--text-muted)' }}>
          Fichiers terminés
        </h2>
        {(() => {
          if (loading && files.length === 0) {
            return <div className="status-line">Chargement des fichiers...</div>;
          }
          if (files.length === 0) {
            return <div className="status-line">Aucun fichier téléchargé trouvé.</div>;
          }
          return (
            <div
              style={{
                display: 'grid',
                gap: '16px',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              }}
            >
              {files.map((file) => (
                <div
                  key={file.name}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>
                    {file.metadata ? file.metadata.title : file.name}
                  </div>
                  {file.metadata && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {file.metadata.owner?.displayName || 'Unknown Streamer'}
                      {file.metadata.game?.name ? ` • ${file.metadata.game.name}` : ''}
                    </div>
                  )}
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {formatSize(file.size)}
                    {file.metadata?.lengthSeconds
                      ? ` • ${formatDuration(file.metadata.lengthSeconds)}`
                      : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={() => {
                        console.log('[Downloads] Lire clicked:', { name: file.name, url: file.url, size: file.size, isTs: isTsFile(file) });
                        setPlayingFile(file);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="action-btn"
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        background: '#9146ff',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      ▶ Lire
                    </button>
                    <a
                      href={resolveDownloadUrl(file.url)}
                      download={file.name}
                      className="action-btn"
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        textDecoration: 'none',
                        background: '#3a3a3d',
                        color: 'white',
                      }}
                    >
                      <DownloadIcon size={16} />
                      Télécharger
                    </a>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinning {
          animation: spin 2s linear infinite;
        }
      `}</style>
    </>
  );
}

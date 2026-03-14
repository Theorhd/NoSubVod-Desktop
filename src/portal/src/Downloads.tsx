import React, { useEffect, useState } from 'react';
import { Download as DownloadIcon, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { VOD } from '../../shared/types';
import NSVPlayer, { NSVMediaSource } from './components/NSVPlayer';
import { formatSize, formatDurationHuman } from './utils/formatters.ts';
import { TopBar } from './components/TopBar';

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

const DEBUG_DOWNLOADS = false;

export default function Downloads() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingFile, setPlayingFile] = useState<DownloadedFile | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const fetchDownloads = async () => {
    try {
      const [filesRes, activeRes] = await Promise.all([
        fetch('/api/downloads'),
        fetch('/api/downloads/active'),
      ]);

      if (DEBUG_DOWNLOADS) {
        console.log('[Downloads] fetch /api/downloads status:', filesRes.status);
        console.log('[Downloads] fetch /api/downloads/active status:', activeRes.status);
      }

      if (filesRes.ok) {
        const data = await filesRes.json();
        if (DEBUG_DOWNLOADS) {
          console.log(
            '[Downloads] files received:',
            data.length,
            'files',
            data.map((f: any) => ({ name: f.name, size: f.size, url: f.url }))
          );
        }
        setFiles(data);
      } else {
        console.error(
          '[Downloads] /api/downloads failed:',
          filesRes.status,
          await filesRes.text().catch(() => '')
        );
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

  const resolveDownloadUrl = (url: string) => {
    if (!url) {
      console.warn('[Downloads] resolveDownloadUrl: empty url');
      return '';
    }
    let resolved: string;
    if (url.startsWith('/api/')) resolved = url;
    else if (url.startsWith('/shared-downloads/')) resolved = `/api${url}`;
    else if (url.startsWith('/')) resolved = `/api${url}`;
    else resolved = `/api/${url}`;

    const token = sessionStorage.getItem('nsv_token');
    if (token) {
      const sep = resolved.includes('?') ? '&' : '?';
      resolved = `${resolved}${sep}t=${encodeURIComponent(token)}`;
    }

    if (DEBUG_DOWNLOADS) {
      console.log('[Downloads] resolveDownloadUrl:', url, '->', resolved);
    }
    return resolved;
  };

  const isTsFile = (file: DownloadedFile | null) => !!file?.name.toLowerCase().endsWith('.ts');

  useEffect(() => {
    setPlaybackError(null);
  }, [playingFile]);

  const getPlaybackSource = (file: DownloadedFile | null): NSVMediaSource | null => {
    if (!file) return null;

    if (isTsFile(file)) {
      return {
        src: `/api/downloads/hls/${encodeURIComponent(file.name)}`,
        type: 'application/x-mpegurl',
      };
    }

    const url = resolveDownloadUrl(file.url);
    const lower = file.name.toLowerCase();

    if (lower.endsWith('.m3u8')) {
      return { src: url, type: 'application/x-mpegurl' };
    }

    if (lower.endsWith('.mp4')) {
      return { src: url, type: 'video/mp4' };
    }

    if (lower.endsWith('.webm')) {
      return { src: url, type: 'video/webm' };
    }

    return { src: url };
  };

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
      <TopBar mode="logo" title="Downloads" />

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
            {(() => {
              const source = getPlaybackSource(playingFile);
              if (!source) return null;

              return (
                <NSVPlayer
                  key={playingFile.name}
                  source={source}
                  title={playingFile.metadata?.title || playingFile.name}
                  autoPlay
                  streamType="on-demand"
                  className="nsv-download-player"
                  onError={(message) => {
                    console.error('[Downloads][vidstack] error:', message);
                    setPlaybackError(
                      'Lecture impossible: verifiez le format, le fichier, ou les droits d acces.'
                    );
                  }}
                />
              );
            })()}
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
                      ? ` • ${formatDurationHuman(file.metadata.lengthSeconds)}`
                      : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={() => {
                        console.log('[Downloads] Lire clicked:', {
                          name: file.name,
                          url: file.url,
                          size: file.size,
                          isTs: isTsFile(file),
                        });
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

import React, { useEffect, useState } from 'react';
import { Download as DownloadIcon, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { VOD } from '../../shared/types';

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

  const fetchDownloads = async () => {
    try {
      const [filesRes, activeRes] = await Promise.all([
        fetch('/api/downloads'),
        fetch('/api/downloads/active'),
      ]);

      if (filesRes.ok) {
        const data = await filesRes.json();
        setFiles(data);
      }

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveDownloads(data);
      }
    } catch (e) {
      console.error('Failed to fetch downloads', e);
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
              controls
              autoPlay
              src={playingFile.url}
              style={{ width: '100%', borderRadius: '8px', maxHeight: '60vh', background: 'black' }}
            >
              <track kind="captions" />
              Votre navigateur ne supporte pas la balise vidéo.
            </video>
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
                      href={file.url}
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

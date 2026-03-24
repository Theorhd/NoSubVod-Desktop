import React, { useMemo, useRef, useState } from 'react';
import {
  Download as DownloadIcon,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
} from 'lucide-react';
import NSVPlayer, { NSVMediaSource } from './components/NSVPlayer';
import { formatSize } from './utils/formatters.ts';
import { TopBar } from './components/TopBar';
import { DownloadedFile, useDownloadsData } from './hooks/useDownloadsData';

export default function Downloads() {
  const { files, activeDownloads, loading, resolveDownloadUrl } = useDownloadsData();
  const [playingFile, setPlayingFile] = useState<DownloadedFile | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);

  const formatDate = (value?: string) => {
    if (!value) return 'Date inconnue';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Date inconnue';
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const isTsFile = (file: DownloadedFile | null) => !!file?.name.toLowerCase().endsWith('.ts');

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

  const getActiveThumbnail = (dl: any) => {
    return (
      dl.previewThumbnailURL || dl.previewImageURL || dl.preview_image_url || dl.thumbnail || null
    );
  };

  const getActiveSubtitle = (dl: any) => {
    return dl.speed || dl.download_speed || dl.rate || dl.current_time || 'En cours';
  };

  const knownVodById = useMemo(() => {
    const byId: Record<string, DownloadedFile> = {};
    files.forEach((f) => {
      if (f.metadata?.id) byId[f.metadata.id] = f;
    });
    return byId;
  }, [files]);

  const scrollQueue = (direction: 'left' | 'right') => {
    if (!queueRef.current) return;
    const distance = direction === 'left' ? -360 : 360;
    queueRef.current.scrollBy({ left: distance, behavior: 'smooth' });
  };

  return (
    <>
      <TopBar mode="logo" title="Downloads" />

      <div className="container download-page">
        {playingFile && (
          <div className="download-player-shell card">
            <div className="download-player-head">
              <h2>{playingFile.metadata?.title || playingFile.name}</h2>
              <button
                onClick={() => {
                  setPlaybackError(null);
                  setPlayingFile(null);
                }}
                className="queue-nav-btn"
                type="button"
                aria-label="Fermer le lecteur"
              >
                <X size={16} />
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
            {playbackError && <div className="error-text">{playbackError}</div>}
          </div>
        )}

        {activeDownloads.length > 0 && (
          <section className="download-section">
            <div className="download-section-head">
              <h2>Download Queue</h2>
              <div className="queue-nav-group">
                <button
                  type="button"
                  className="queue-nav-btn"
                  onClick={() => scrollQueue('left')}
                  aria-label="Scroll left"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="queue-nav-btn"
                  onClick={() => scrollQueue('right')}
                  aria-label="Scroll right"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="download-queue-track" ref={queueRef}>
              {activeDownloads.map((dl) => {
                const statusInfo = getStatusDisplay(dl.status);
                const statusName = typeof dl.status === 'string' ? dl.status : '';
                const knownFile = knownVodById[dl.vod_id];
                const thumbnail =
                  getActiveThumbnail(dl) || knownFile?.metadata?.previewThumbnailURL || null;
                let queueIcon = statusInfo.icon;

                if (statusName === 'Downloading') {
                  queueIcon = <Pause size={14} />;
                } else if (statusName === 'Queued') {
                  queueIcon = <Clock size={14} />;
                }

                return (
                  <article key={dl.vod_id} className="download-queue-card">
                    <div className="download-queue-top">
                      <div className="queue-thumb-wrap">
                        {thumbnail ? (
                          <img src={thumbnail} alt={dl.title} className="queue-thumb" />
                        ) : (
                          <div className="queue-thumb-placeholder">
                            <DownloadIcon size={18} />
                          </div>
                        )}
                      </div>
                      <div className="download-queue-main">
                        <div className="download-title-row">
                          <h3>{dl.title}</h3>
                          <span className="queue-status-dot" style={{ color: statusInfo.color }}>
                            {queueIcon}
                          </span>
                        </div>
                        <div className="download-queue-subline">{getActiveSubtitle(dl)}</div>
                        <div className="download-progress-track">
                          <div
                            className="download-progress-fill"
                            style={{
                              width: `${dl.progress}%`,
                              background:
                                statusName === 'Downloading'
                                  ? 'linear-gradient(90deg, #a855f7, #3b82f6)'
                                  : undefined,
                            }}
                          />
                        </div>
                        <div className="download-queue-meta">
                          <span>{dl.progress.toFixed(0)}%</span>
                          <span style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="download-section">
          <div className="download-section-head">
            <h2>Local Storage</h2>
          </div>
          {(() => {
            if (loading && files.length === 0) {
              return <div className="status-line">Chargement des fichiers...</div>;
            }
            if (files.length === 0) {
              return <div className="status-line">Aucun fichier téléchargé trouvé.</div>;
            }
            return (
              <div className="download-library-grid">
                {files.map((file) => (
                  <article key={file.name} className="download-library-card">
                    <button
                      type="button"
                      className="download-library-thumb-btn"
                      onClick={() => {
                        setPlaybackError(null);
                        setPlayingFile(file);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <div className="download-library-thumb-wrap">
                        {file.metadata?.previewThumbnailURL ? (
                          <img
                            src={file.metadata.previewThumbnailURL}
                            alt={file.metadata?.title || file.name}
                            className="download-library-thumb"
                          />
                        ) : (
                          <div className="download-library-thumb-placeholder">
                            <DownloadIcon size={22} />
                          </div>
                        )}
                        <span className="download-complete-chip">
                          <CheckCircle2 size={12} />
                          COMPLETED
                        </span>
                      </div>
                    </button>

                    <div className="download-library-body">
                      <h3 className="download-file-title">{file.metadata?.title || file.name}</h3>
                      <div className="download-meta-row">
                        <span>
                          {file.metadata?.owner?.displayName ||
                            file.metadata?.owner?.login ||
                            'Unknown channel'}
                        </span>
                        {file.metadata?.game?.name && <span>{file.metadata.game.name}</span>}
                      </div>
                      <div className="download-meta-row muted">
                        <span>Size: {formatSize(file.size)}</span>
                        <span>Date: {formatDate(file.metadata?.createdAt)}</span>
                      </div>
                      <div className="download-card-actions">
                        <button
                          onClick={() => {
                            setPlaybackError(null);
                            setPlayingFile(file);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="download-card-btn primary"
                          type="button"
                        >
                          <Play size={14} />
                          Lire
                        </button>
                        <a
                          href={resolveDownloadUrl(file.url)}
                          download={file.name}
                          className="download-card-btn secondary"
                        >
                          <DownloadIcon size={14} />
                          Télécharger
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            );
          })()}
        </section>
      </div>
    </>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryVodEntry } from '../../shared/types';

function formatRelative(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt;
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 60) return `${minutes || 1} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function History() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryVodEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/history/list')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load history');
        return res.json();
      })
      .then((data: HistoryVodEntry[]) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <>
      <div className="top-bar">
        <div className="bar-main">
          <button
            onClick={() => navigate('/')}
            className="back-btn"
            aria-label="Back to Home"
            type="button"
          >
            &larr;
          </button>
          <h1>Watch History</h1>
        </div>
      </div>

      <div className="container">
        {loading && <div className="status-line">Loading history...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="empty-state">
            No history yet. Start watching a VOD to populate this page.
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="history-list">
            {items.map((entry) => {
              const progress =
                entry.duration > 0
                  ? Math.min(100, Math.max(0, (entry.timecode / entry.duration) * 100))
                  : 0;

              return (
                <div key={entry.vodId} className="history-item">
                  <button
                    type="button"
                    className="history-item-main"
                    onClick={() => navigate(`/player?vod=${entry.vodId}`)}
                  >
                    <img
                      src={
                        entry.vod?.previewThumbnailURL ||
                        'https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg'
                      }
                      alt={entry.vod?.title || `VOD ${entry.vodId}`}
                    />
                    <div className="history-item-content">
                      <h3 title={entry.vod?.title || entry.vodId}>
                        {entry.vod?.title || `VOD ${entry.vodId}`}
                      </h3>
                      <div className="vod-meta-row">
                        <span>{entry.vod?.owner?.displayName || 'Unknown channel'}</span>
                        <span>{entry.vod?.game?.name || 'No category'}</span>
                        <span>{formatRelative(entry.updatedAt)}</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

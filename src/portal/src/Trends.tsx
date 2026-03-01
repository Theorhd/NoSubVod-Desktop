import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VOD } from '../../shared/types';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const hoursPrefix = h > 0 ? `${h}:` : '';
  return `${hoursPrefix}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (!views) return '0 views';
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} views`;
}

export default function Trends() {
  const navigate = useNavigate();
  const [vods, setVods] = useState<VOD[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/trends')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch trending VODs');
        return res.json();
      })
      .then((data: VOD[]) => {
        setVods(data);
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
          <h1>
            <button
              className="logo-btn"
              onClick={() => navigate('/')}
              aria-label="Home"
              type="button"
            >
              Trending VODs
            </button>
          </h1>
        </div>
      </div>

      <div className="container">
        {loading && <div className="status-line">Loading trending VODs...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && vods.length === 0 && (
          <div className="empty-state">No trends available right now.</div>
        )}

        {!loading && !error && vods.length > 0 && (
          <div className="vod-grid">
            {vods.map((vod) => (
              <div
                key={vod.id}
                onClick={() => navigate(`/player?vod=${vod.id}`)}
                className="vod-card"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/player?vod=${vod.id}`);
                  }
                }}
              >
                <div className="vod-thumb-wrap">
                  <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
                  <div className="vod-chip vod-duration">{formatTime(vod.lengthSeconds)}</div>
                </div>
                <div className="vod-body">
                  <div className="vod-owner-row">
                    {vod.owner?.profileImageURL && (
                      <img src={vod.owner.profileImageURL} alt={vod.owner.displayName} />
                    )}
                    <span>{vod.owner?.displayName || 'Unknown Streamer'}</span>
                  </div>
                  <h3 title={vod.title}>{vod.title}</h3>
                  <div className="vod-meta-row">
                    <span>{vod.game?.name || 'No Category'}</span>
                    <span>{formatViews(vod.viewCount)}</span>
                  </div>
                  <div className="vod-date">{new Date(vod.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

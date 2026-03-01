import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { HistoryEntry, VOD } from '../../shared/types';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const hoursPrefix = h > 0 ? `${h}:` : '';
  return `${hoursPrefix}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} views`;
}

export default function Channel() {
  const [searchParams] = useSearchParams();
  const user = searchParams.get('user');
  const category = searchParams.get('category');
  const navigate = useNavigate();

  const [vods, setVods] = useState<VOD[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const title = useMemo(() => {
    if (category) return `${category} VODs`;
    if (user) return `${user} VODs`;
    return 'VODs';
  }, [category, user]);

  useEffect(() => {
    if (!user && !category) {
      setError('No channel or category specified');
      setLoading(false);
      return;
    }

    const vodEndpoint = user
      ? `/api/user/${encodeURIComponent(user)}/vods`
      : `/api/search/category-vods?name=${encodeURIComponent(category || '')}`;

    Promise.all([
      fetch(vodEndpoint).then((res) => {
        if (!res.ok) throw new Error('Failed to fetch VODs');
        return res.json();
      }),
      fetch('/api/history')
        .then((res) => {
          if (!res.ok) return {};
          return res.json();
        })
        .catch(() => ({})),
    ])
      .then(([vodsData, historyData]) => {
        setVods(vodsData as VOD[]);
        setHistory(historyData as Record<string, HistoryEntry>);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [category, user]);

  const addToWatchlist = async (e: React.MouseEvent, vod: VOD) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId: vod.id,
          title: vod.title,
          previewThumbnailURL: vod.previewThumbnailURL,
          lengthSeconds: vod.lengthSeconds,
        }),
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <div className="top-bar">
        <div className="bar-main">
          <button onClick={() => navigate(-1)} className="back-btn" aria-label="Back" type="button">
            &larr;
          </button>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="container">
        {loading && <div className="status-line">Loading VODs...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && vods.length === 0 && (
          <div className="empty-state">No VODs found.</div>
        )}

        {!loading && !error && vods.length > 0 && (
          <div className="vod-grid">
            {vods.map((vod) => {
              const hist = history[vod.id];
              const progress =
                hist && hist.duration > 0
                  ? Math.min(100, (hist.timecode / hist.duration) * 100)
                  : 0;

              return (
                <button
                  key={vod.id}
                  type="button"
                  onClick={() => navigate(`/player?vod=${vod.id}`)}
                  className="vod-card"
                >
                  <div className="vod-thumb-wrap">
                    <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
                    <div className="vod-chip vod-duration">{formatTime(vod.lengthSeconds)}</div>
                    <button
                      onClick={(e) => {
                        void addToWatchlist(e, vod);
                      }}
                      className="vod-watchlist-btn"
                      type="button"
                      title="Add to watch later"
                    >
                      +
                    </button>
                    {progress > 0 && (
                      <div className="progress-track absolute-track">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="vod-body">
                    <h3 title={vod.title}>{vod.title}</h3>
                    <div className="vod-meta-row">
                      <span>{vod.game?.name || 'No Category'}</span>
                      <span>{formatViews(vod.viewCount)}</span>
                    </div>
                    <div className="vod-date">{new Date(vod.createdAt).toLocaleDateString()}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

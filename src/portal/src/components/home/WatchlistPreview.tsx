import React from 'react';
import { useNavigate } from 'react-router-dom';
import { WatchlistEntry } from '../../../../shared/types';

interface WatchlistPreviewProps {
  readonly watchlist: WatchlistEntry[];
  readonly removeFromWatchlist: (vodId: string) => Promise<void>;
}

export default function WatchlistPreview({
  watchlist,
  removeFromWatchlist,
}: WatchlistPreviewProps) {
  const navigate = useNavigate();

  if (watchlist.length === 0) {
    return null;
  }

  return (
    <>
      <h2>Watch Later</h2>
      <div className="vod-grid compact-grid">
        {watchlist.map((vod) => (
          <div key={vod.vodId} className="watchlist-card">
            <button
              type="button"
              className="watchlist-main"
              onClick={() => navigate(`/player?vod=${vod.vodId}`)}
            >
              <img src={vod.previewThumbnailURL} alt={vod.title} />
              <div className="watchlist-body">
                <div className="watchlist-title" title={vod.title}>
                  {vod.title}
                </div>
              </div>
            </button>
            <button
              type="button"
              className="watchlist-remove"
              onClick={() => removeFromWatchlist(vod.vodId)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
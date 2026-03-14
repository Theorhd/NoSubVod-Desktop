import React from 'react';
import { VOD, HistoryEntry } from '../../../shared/types';
import { formatTime, formatViews } from '../utils/formatters';
import { Download as DownloadIcon } from 'lucide-react';
import DownloadMenu from './DownloadMenu';

export type VODCardProps = {
  vod: VOD;
  onWatch: (vodId: string) => void;
  onAddToWatchlist?: (e: React.MouseEvent, vod: VOD) => void;
  historyEntry?: HistoryEntry;
  showOwner?: boolean;
  hideDownload?: boolean;
};

export const VODCard: React.FC<VODCardProps> = ({
  vod,
  onWatch,
  onAddToWatchlist,
  historyEntry,
  showOwner,
  hideDownload,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (menuOpen) {
      setMenuOpen(false);
    } else {
      setAnchorRect((e.currentTarget as HTMLButtonElement).getBoundingClientRect());
      setMenuOpen(true);
    }
  };

  const progress =
    historyEntry && historyEntry.duration > 0
      ? Math.min(100, (historyEntry.timecode / historyEntry.duration) * 100)
      : 0;

  return (
    <div className="vod-card">
      <div className="vod-thumb-wrap">
        <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
        <div className="vod-chip vod-duration">{formatTime(vod.lengthSeconds)}</div>
        {onAddToWatchlist && (
          <button
            type="button"
            onClick={(e) => onAddToWatchlist(e, vod)}
            className="vod-watchlist-btn"
            title="Add to watch later"
            style={{ position: 'relative', zIndex: 2 }}
          >
            +
          </button>
        )}
        {progress > 0 && (
          <div className="progress-track absolute-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="vod-body" style={{ position: 'relative' }}>
        {showOwner && vod.owner && (
          <div className="vod-owner-row">
            {vod.owner.profileImageURL && (
              <img src={vod.owner.profileImageURL} alt={vod.owner.displayName} />
            )}
            <span>{vod.owner.displayName || 'Unknown Streamer'}</span>
          </div>
        )}

        <h3 title={vod.title}>
          <button
            type="button"
            className="stretched-link"
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              font: 'inherit',
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onClick={() => onWatch(vod.id)}
          >
            {vod.title}
          </button>
        </h3>

        <div
          className="vod-meta-row"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              cursor: 'default',
              position: 'relative',
              zIndex: 2,
            }}
          >
            <span className="vod-game">{vod.game?.name || 'No Category'}</span>
            <span>{formatViews(vod.viewCount)}</span>
          </div>

          {!hideDownload && (
            <div style={{ position: 'relative', zIndex: 3 }}>
              <button
                type="button"
                onClick={handleDownloadClick}
                className="action-btn secondary-btn"
                style={{ padding: '4px', borderRadius: '50%' }}
                title="Télécharger"
              >
                <DownloadIcon size={16} />
              </button>
              {menuOpen && anchorRect && (
                <DownloadMenu
                  vodId={vod.id}
                  title={vod.title}
                  duration={vod.lengthSeconds}
                  anchorRect={anchorRect}
                  onClose={() => setMenuOpen(false)}
                />
              )}
            </div>
          )}
        </div>

        <div className="vod-date">{new Date(vod.createdAt).toLocaleDateString()}</div>
      </div>
    </div>
  );
};

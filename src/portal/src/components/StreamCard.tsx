import React from 'react';
import { LiveStream } from '../../../shared/types';
import { formatViewers, formatUptime } from '../utils/formatters';

type StreamCardProps = {
  stream: LiveStream;
  onWatch: (login: string) => void;
  onCategoryClick?: (categoryName: string) => void;
  onChannelClick?: (login: string) => void;
  showBroadcaster?: boolean;
};

export const StreamCard: React.FC<StreamCardProps> = ({ 
  stream, 
  onWatch, 
  onCategoryClick, 
  onChannelClick,
  showBroadcaster = true
}) => {
  return (
    <div className="vod-card live-card">
      <div className="vod-thumb-wrap">
        <img
          src={
            stream.previewImageURL?.replace('-{width}x{height}', '') ||
            'https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg'
          }
          alt={stream.title}
          className="vod-thumb"
          loading="lazy"
        />
        <div className="vod-chip live-chip">LIVE</div>
      </div>
      <div className="vod-body" style={{ position: 'relative' }}>
        {showBroadcaster && stream.broadcaster && (
          <div className="vod-owner-row">
            {stream.broadcaster.profileImageURL && (
              <img src={stream.broadcaster.profileImageURL} alt={stream.broadcaster.displayName} />
            )}
            {onChannelClick ? (
               <button
               type="button"
               style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer', fontWeight: 'bold' }}
               onClick={(e) => {
                 e.stopPropagation();
                 onChannelClick(stream.broadcaster.login);
               }}
             >
               {stream.broadcaster.displayName}
             </button>
            ) : (
              <span>{stream.broadcaster.displayName}</span>
            )}
          </div>
        )}

        <h3 title={stream.title}>
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
            onClick={(e) => {
              e.stopPropagation();
              onWatch(stream.broadcaster.login);
            }}
          >
            {stream.title}
          </button>
        </h3>
        
        <div className="vod-meta-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {stream.game?.name && onCategoryClick ? (
            <button
              type="button"
              className="meta-tag-btn"
              style={{ position: 'relative', zIndex: 2 }}
              onClick={(e) => {
                e.stopPropagation();
                onCategoryClick(stream.game!.name);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onCategoryClick(stream.game!.name);
                }
              }}
            >
              {stream.game.name}
            </button>
          ) : (
            <span>{stream.game?.name || 'No category'}</span>
          )}

          <span className="live-viewers">{formatViewers(stream.viewerCount)}</span>
        </div>
        {stream.startedAt && (
           <div className="vod-date">Uptime: {formatUptime(stream.startedAt)}</div>
        )}
      </div>
    </div>
  );
};

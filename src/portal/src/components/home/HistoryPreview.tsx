import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryVodEntry } from '../../../../shared/types';

interface HistoryPreviewProps {
  readonly historyPreview: HistoryVodEntry[];
}

function formatProgress(timecode: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (timecode / duration) * 100));
}

export default function HistoryPreview({ historyPreview }: HistoryPreviewProps) {
  const navigate = useNavigate();

  return (
    <>
      <div className="section-head" style={{ marginTop: '0' }}>
        <h2>History</h2>
        <button type="button" className="ghost-btn" onClick={() => navigate('/history')}>
          View all history
        </button>
      </div>

      {historyPreview.length === 0 ? (
        <div className="empty-state">No recent VODs yet.</div>
      ) : (
        <div className="history-list history-list-compact">
          {historyPreview.map((entry) => {
            const progress = formatProgress(entry.timecode, entry.duration);

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
    </>
  );
}
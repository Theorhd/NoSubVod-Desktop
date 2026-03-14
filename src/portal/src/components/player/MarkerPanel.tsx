import React from 'react';
import { VideoMarker } from '../../../../shared/types';
import { formatSafeClock as formatClock } from '../../utils/formatters';

interface MarkerPanelProps {
  markers: VideoMarker[];
  onSeek: (time: number) => void;
  onClose: () => void;
}

const MarkerPanel: React.FC<MarkerPanelProps> = ({ markers, onSeek, onClose }) => {
  if (markers.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        backgroundColor: 'rgba(0,0,0,0.85)',
        padding: '15px',
        borderRadius: '8px',
        zIndex: 20,
        maxHeight: '80%',
        overflowY: 'auto',
        border: '1px solid #3a3a3d',
      }}
    >
      <h3 style={{ marginTop: 0, fontSize: '1rem', color: '#fff' }}>Chapters</h3>
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          onClick={() => {
            onSeek(marker.displayTime);
            onClose();
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            color: '#adadb8',
            padding: '8px 0',
            cursor: 'pointer',
            borderBottom: '1px solid #222',
          }}
        >
          <span style={{ color: '#9146ff', fontWeight: 'bold', marginRight: '10px' }}>
            {formatClock(marker.displayTime)}
          </span>
          {marker.description}
        </button>
      ))}
    </div>
  );
};

export default MarkerPanel;

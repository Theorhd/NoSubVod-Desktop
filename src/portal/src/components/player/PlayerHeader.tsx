import React from 'react';

interface PlayerHeaderProps {
  onBack: () => void;
  isMobileLayout: boolean;
  statusLabel: string;
  rtcStatus: string;
  signalStatus: string;
}

export const PlayerHeader: React.FC<PlayerHeaderProps> = ({
  onBack,
  isMobileLayout,
  statusLabel,
  rtcStatus,
  signalStatus,
}) => {
  return (
    <div
      style={{
        backgroundColor: '#18181b',
        padding: isMobileLayout ? '8px 12px' : '10px 20px',
        paddingTop: isMobileLayout ? 'calc(8px + var(--safe-top))' : '10px',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid #3a3a3d',
        zIndex: 10,
        flexShrink: 0,
        gap: isMobileLayout ? '8px' : '10px',
      }}
    >
      <button
        onClick={onBack}
        style={{
          color: '#efeff1',
          fontSize: isMobileLayout ? '12px' : '14px',
          fontWeight: 'bold',
          padding: isMobileLayout ? '6px 10px' : '5px 10px',
          backgroundColor: '#3a3a3d',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        type="button"
      >
        Back
      </button>

      <h2
        style={{
          color: 'white',
          fontSize: isMobileLayout ? '13px' : '14px',
          margin: 0,
          flexGrow: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        Screen Share
      </h2>

      <span
        style={{
          color: '#efeff1',
          fontSize: isMobileLayout ? '11px' : '12px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {isMobileLayout
          ? `${statusLabel} · ${rtcStatus}`
          : `${statusLabel} · ${signalStatus} · ${rtcStatus}`}
      </span>
    </div>
  );
};

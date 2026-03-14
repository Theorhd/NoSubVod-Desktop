import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveStatusMap, SubEntry, ExperienceSettings } from '../../../../shared/types';

interface MySubsListProps {
  readonly subs: SubEntry[];
  readonly liveStatus: LiveStatusMap;
  readonly settings: ExperienceSettings;
  readonly handleDeleteSub: (e: React.MouseEvent, login: string) => Promise<void>;
}

export default function MySubsList({
  subs,
  liveStatus,
  settings,
  handleDeleteSub,
}: MySubsListProps) {
  const navigate = useNavigate();

  return (
    <>
      <h2>My Subs</h2>
      <div className="sub-list" style={{ marginBottom: '24px' }}>
        {subs.length === 0 ? (
          <div className="empty-state">No subs yet. Click + to add one.</div>
        ) : (
          subs.map((sub) => (
            <div key={sub.login} className="sub-item">
              <button
                type="button"
                className="sub-link"
                aria-label={`Open ${sub.displayName} channel`}
                onClick={() => navigate(`/channel?user=${encodeURIComponent(sub.login)}`)}
              >
                <div className="sub-avatar-wrap">
                  <img src={sub.profileImageURL} alt={sub.displayName} />
                  {Boolean(liveStatus[sub.login.toLowerCase()]) && (
                    <span className="sub-live-badge">LIVE</span>
                  )}
                </div>
                <div className="name">{sub.displayName}</div>
              </button>
              <button
                type="button"
                className="delete-btn"
                onClick={(e) => {
                  void handleDeleteSub(e, sub.login);
                }}
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
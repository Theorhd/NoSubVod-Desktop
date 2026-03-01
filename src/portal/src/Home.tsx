import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExperienceSettings,
  HistoryVodEntry,
  SubEntry,
  UserInfo,
  WatchlistEntry,
} from '../../shared/types';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
};

function formatProgress(timecode: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (timecode / duration) * 100));
}

export default function Home() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<HistoryVodEntry[]>([]);
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);

  const [showModal, setShowModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSearchingStreamer, setIsSearchingStreamer] = useState(false);

  const [channelSearch, setChannelSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserInfo[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [watchlistRes, settingsRes, historyRes] = await Promise.all([
          fetch('/api/watchlist'),
          fetch('/api/settings'),
          fetch('/api/history/list?limit=3'),
        ]);

        if (watchlistRes.ok) {
          setWatchlist((await watchlistRes.json()) as WatchlistEntry[]);
        }

        if (historyRes.ok) {
          setHistoryPreview((await historyRes.json()) as HistoryVodEntry[]);
        }

        let oneSyncEnabled = false;
        if (settingsRes.ok) {
          const remoteSettings = (await settingsRes.json()) as ExperienceSettings;
          oneSyncEnabled = Boolean(remoteSettings.oneSync);
          setSettings({ oneSync: oneSyncEnabled });
        }

        if (oneSyncEnabled) {
          const subsRes = await fetch('/api/subs');
          if (subsRes.ok) {
            setSubs((await subsRes.json()) as SubEntry[]);
          }
        } else {
          const saved = localStorage.getItem('nsv_subs');
          setSubs(saved ? (JSON.parse(saved) as SubEntry[]) : []);
        }
      } catch (error) {
        console.error('Failed to fetch initial home data', error);
      }
    };

    void loadData();
  }, []);

  const saveSubsLocal = (newSubs: SubEntry[]) => {
    setSubs(newSubs);
    localStorage.setItem('nsv_subs', JSON.stringify(newSubs));
  };

  const saveSubServer = async (entry: SubEntry) => {
    const res = await fetch('/api/subs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });

    if (res.ok) {
      setSubs((await res.json()) as SubEntry[]);
    }
  };

  const removeSubServer = async (login: string) => {
    const res = await fetch(`/api/subs/${encodeURIComponent(login)}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      setSubs((await res.json()) as SubEntry[]);
    }
  };

  const removeFromWatchlist = async (vodId: string) => {
    try {
      const res = await fetch(`/api/watchlist/${vodId}`, { method: 'DELETE' });
      if (res.ok) setWatchlist((await res.json()) as WatchlistEntry[]);
    } catch (error) {
      console.error(error);
    }
  };

  const handleChannelSearch = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const query = channelSearch.trim();
    if (!query) return;

    setIsSearchingChannels(true);
    try {
      const res = await fetch(`/api/search/channels?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Failed to search channels');
      const data = (await res.json()) as UserInfo[];
      setSearchResults(data);
    } catch (error) {
      console.error(error);
      setSearchResults([]);
    } finally {
      setIsSearchingChannels(false);
    }
  };

  const handleAddSub = async () => {
    const username = streamerInput.trim().toLowerCase();
    if (!username) return;

    if (subs.some((sub) => sub.login === username)) {
      setModalError('Already subbed to this user.');
      return;
    }

    setIsSearchingStreamer(true);
    setModalError('');

    try {
      const res = await fetch(`/api/user/${username}`);
      if (!res.ok) throw new Error('User not found');
      const user = (await res.json()) as UserInfo;

      const newSub: SubEntry = {
        login: user.login,
        displayName: user.displayName,
        profileImageURL: user.profileImageURL,
      };

      if (settings.oneSync) {
        await saveSubServer(newSub);
      } else {
        saveSubsLocal([...subs, newSub]);
      }

      setShowModal(false);
      setStreamerInput('');
    } catch (error: any) {
      setModalError(error?.message || 'Error finding user.');
    } finally {
      setIsSearchingStreamer(false);
    }
  };

  const handleDeleteSub = async (e: React.MouseEvent, login: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!globalThis.confirm('Remove this streamer?')) {
      return;
    }

    if (settings.oneSync) {
      await removeSubServer(login);
      return;
    }

    saveSubsLocal(subs.filter((sub) => sub.login !== login));
  };

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
              NoSubVod
            </button>
          </h1>
        </div>
        <div className="top-actions">
          <button
            className="add-btn"
            onClick={() => setShowModal(true)}
            aria-label="Add sub"
            type="button"
          >
            +
          </button>
          <button
            className="settings-btn"
            onClick={() => navigate('/settings')}
            aria-label="Open settings"
            title="Settings"
            type="button"
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="container">
        <div className="card hero-card">
          <h2>Quick channel search</h2>
          <p className="card-subtitle">Find a streamer instantly and jump to recent VODs.</p>
          <form onSubmit={handleChannelSearch}>
            <div className="input-row">
              <input
                type="text"
                id="channelSearch"
                placeholder="e.g. Domingo"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                autoComplete="off"
              />
              <button type="submit" className="action-btn" disabled={isSearchingChannels}>
                {isSearchingChannels ? '...' : 'Search'}
              </button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="sub-list">
              {searchResults.map((user) => (
                <div key={user.id} className="sub-item">
                  <button
                    type="button"
                    className="sub-link"
                    onClick={() => navigate(`/channel?user=${encodeURIComponent(user.login)}`)}
                  >
                    <img src={user.profileImageURL} alt={user.displayName} />
                    <div className="name">{user.displayName}</div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="section-head">
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

        {watchlist.length > 0 && (
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
        )}

        <h2>My Subs</h2>
        <div className="sub-list">
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
                  <img src={sub.profileImageURL} alt={sub.displayName} />
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
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Sub to a Streamer</h3>
            <label htmlFor="streamerInput">Twitch Username</label>
            <input
              type="text"
              id="streamerInput"
              placeholder="e.g. zerator"
              value={streamerInput}
              onChange={(e) => setStreamerInput(e.target.value)}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleAddSub();
                }
              }}
            />
            {modalError && <div className="error-text">{modalError}</div>}
            <div className="btn-row">
              <button
                className="action-btn cancel"
                onClick={() => setShowModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="action-btn"
                onClick={() => void handleAddSub()}
                disabled={isSearchingStreamer}
                type="button"
              >
                {isSearchingStreamer ? 'Searching...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

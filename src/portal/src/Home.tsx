import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExperienceSettings, SubEntry } from '../../shared/types';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
};

export default function Home() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [showModal, setShowModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [watchlistRes, settingsRes] = await Promise.all([
          fetch('/api/watchlist'),
          fetch('/api/settings'),
        ]);

        if (watchlistRes.ok) {
          setWatchlist(await watchlistRes.json());
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
      } catch (e) {
        console.error('Failed to fetch initial home data', e);
      }
    };

    loadData();
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
      if (res.ok) setWatchlist(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const handleChannelSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = channelSearch.trim();
    if (!query) return;

    setIsSearchingChannels(true);
    try {
      const res = await fetch(`/api/search/channels?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Failed to search');
      const data = await res.json();
      setSearchResults(data);
    } catch (err: any) {
      console.error(err);
      setSearchResults([]);
    } finally {
      setIsSearchingChannels(false);
    }
  };

  const handleAddSub = async () => {
    const username = streamerInput.trim().toLowerCase();
    if (!username) return;

    if (subs.some((s) => s.login === username)) {
      setModalError('Already subbed to this user.');
      return;
    }

    setIsSearching(true);
    setModalError('');

    try {
      const res = await fetch(`/api/user/${username}`);
      if (!res.ok) throw new Error('User not found');
      const user = await res.json();

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
    } catch (err: any) {
      setModalError(err.message || 'Error finding user.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeleteSub = async (e: React.MouseEvent, login: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (globalThis.confirm('Remove this streamer?')) {
      if (settings.oneSync) {
        await removeSubServer(login);
      } else {
        saveSubsLocal(subs.filter((s) => s.login !== login));
      }
    }
  };

  return (
    <>
      <div className="top-bar">
        <h1>
          <button className="logo-btn" onClick={() => navigate('/')} aria-label="Home">
            NoSubVod
          </button>
        </h1>
        <div className="top-actions">
          <button className="add-btn" onClick={() => setShowModal(true)} aria-label="Add sub">
            +
          </button>
          <button
            className="settings-btn"
            onClick={() => navigate('/settings')}
            aria-label="Open settings"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="container">
        <div className="card">
          <form onSubmit={handleChannelSearch}>
            <label htmlFor="channelSearch">Search Twitch Channels</label>
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
            <div className="search-results" style={{ marginTop: '20px' }}>
              <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Results:</h3>
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
            </div>
          )}
        </div>

        {watchlist.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h2>Ma Liste (Watch Later)</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '15px',
              }}
            >
              {watchlist.map((vod) => (
                <div
                  key={vod.vodId}
                  style={{
                    position: 'relative',
                    backgroundColor: 'var(--surface)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => navigate(`/player?vod=${vod.vodId}`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <img
                      src={vod.previewThumbnailURL}
                      alt={vod.title}
                      style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
                    />
                    <div style={{ padding: '8px' }}>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: 'var(--text)',
                        }}
                      >
                        {vod.title}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => removeFromWatchlist(vod.vodId)}
                    style={{
                      position: 'absolute',
                      top: '5px',
                      right: '5px',
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2>My Subs</h2>
        <div className="sub-list">
          {subs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              No subs yet. Click the + button to add one!
            </div>
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
                  onClick={(e) => void handleDeleteSub(e, sub.login)}
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
              onKeyDown={(e) => e.key === 'Enter' && handleAddSub()}
            />
            {modalError && <div className="error-text">{modalError}</div>}
            <div className="btn-row">
              <button className="action-btn cancel" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="action-btn" onClick={handleAddSub} disabled={isSearching}>
                {isSearching ? 'Searching...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

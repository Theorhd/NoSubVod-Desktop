import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExperienceSettings,
  HistoryVodEntry,
  LiveStatusMap,
  ScreenShareSourceType,
  SubEntry,
  UserInfo,
  WatchlistEntry,
} from '../../shared/types';
import ChannelSearchCard from './components/home/ChannelSearchCard';
import MySubsList from './components/home/MySubsList';
import HistoryPreview from './components/home/HistoryPreview';
import WatchlistPreview from './components/home/WatchlistPreview';
import { TopBar } from './components/TopBar';

const defaultSettings: ExperienceSettings = {
  oneSync: false,
};

export default function Home() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<HistoryVodEntry[]>([]);
  const [settings, setSettings] = useState<ExperienceSettings>(defaultSettings);
  const [liveStatus, setLiveStatus] = useState<LiveStatusMap>({});

  const [showModal, setShowModal] = useState(false);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSearchingStreamer, setIsSearchingStreamer] = useState(false);
  const [isStartingStream, setIsStartingStream] = useState(false);
  const [streamError, setStreamError] = useState('');

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

  useEffect(() => {
    const loadLiveStatus = async () => {
      if (subs.length === 0) {
        setLiveStatus({});
        return;
      }

      try {
        const logins = subs.map((sub) => sub.login.toLowerCase()).join(',');
        const res = await fetch(`/api/live/status?logins=${encodeURIComponent(logins)}`);
        if (!res.ok) {
          setLiveStatus({});
          return;
        }

        setLiveStatus((await res.json()) as LiveStatusMap);
      } catch (error) {
        console.error('Failed to fetch live status for subs', error);
        setLiveStatus({});
      }
    };

    void loadLiveStatus();
  }, [subs]);

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

  const handleStartScreenShare = async (sourceType: ScreenShareSourceType) => {
    setIsStartingStream(true);
    setStreamError('');

    try {
      const response = await fetch('/api/screenshare/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Unable to start screen share session.');
      }

      const payload = (await response.json()) as { sessionId?: string | null };
      if (payload.sessionId) {
        localStorage.setItem('nsv_screenshare_host_session', payload.sessionId);
      }

      setShowStreamModal(false);
      navigate('/screen-share');
    } catch (error: any) {
      setStreamError(error?.message || 'Unable to start screen share session.');
    } finally {
      setIsStartingStream(false);
    }
  };

  return (
    <>
      <TopBar
        mode="logo"
        title="NoSubVod"
        actions={
          <>
            <button
              className="stream-btn"
              onClick={() => setShowStreamModal(true)}
              aria-label="Start screen share"
              type="button"
            >
              Lancer une diffusion
            </button>
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
          </>
        }
      />

      <div className="container">
        <ChannelSearchCard
          channelSearch={channelSearch}
          setChannelSearch={setChannelSearch}
          isSearchingChannels={isSearchingChannels}
          searchResults={searchResults}
          handleChannelSearch={handleChannelSearch}
        />

        <MySubsList subs={subs} liveStatus={liveStatus} handleDeleteSub={handleDeleteSub} />

        <HistoryPreview historyPreview={historyPreview} />

        <WatchlistPreview watchlist={watchlist} removeFromWatchlist={removeFromWatchlist} />
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

      {showStreamModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Lancer une diffusion</h3>
            <p className="card-subtitle">
              Choisis la source a diffuser en direct sur l'onglet Screen Share.
            </p>
            {streamError && <div className="error-text">{streamError}</div>}

            <div className="btn-col">
              <button
                className="action-btn"
                disabled={isStartingStream}
                onClick={() => void handleStartScreenShare('browser')}
                type="button"
              >
                Solution 1: Fenetre navigateur Tauri (Google par defaut)
              </button>
              <button
                className="action-btn"
                disabled={isStartingStream}
                onClick={() => void handleStartScreenShare('application')}
                type="button"
              >
                Solution 2: Application locale (jeu, navigateur, etc.)
              </button>
            </div>

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="action-btn cancel"
                disabled={isStartingStream}
                onClick={() => setShowStreamModal(false)}
                type="button"
              >
                Cancel
              </button>
              <span className="status-line" style={{ padding: 0, margin: 0 }}>
                {isStartingStream ? 'Starting session...' : 'Interactive mode: ON'}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

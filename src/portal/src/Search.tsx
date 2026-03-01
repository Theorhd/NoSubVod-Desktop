import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserInfo } from '../../shared/types';

function formatViewers(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M viewers`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K viewers`;
  return `${value} viewers`;
}

type SearchGame = {
  id: string;
  name: string;
  boxArtURL: string;
  __typename: 'Game';
};

type SearchUser = UserInfo & {
  __typename: 'User';
  stream?: {
    id: string;
    title: string;
    viewersCount: number;
    previewImageURL: string;
  } | null;
};

type SearchResult = SearchGame | SearchUser;

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const channels = useMemo(
    () => results.filter((result): result is SearchUser => result.__typename === 'User'),
    [results]
  );
  const liveStreams = useMemo(() => channels.filter((user) => user.stream != null), [channels]);
  const categories = useMemo(
    () => results.filter((result): result is SearchGame => result.__typename === 'Game'),
    [results]
  );

  const handleSearch = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);

    try {
      const res = await fetch(`/api/search/global?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Failed to search');
      const data = (await res.json()) as SearchResult[];
      setResults(data);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('q', q);
        return next;
      });
    } catch (error) {
      console.error(error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
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
              Search Twitch
            </button>
          </h1>
        </div>
      </div>

      <div className="container">
        <div className="card">
          <form onSubmit={handleSearch}>
            <label htmlFor="globalSearch">Search Channels, Categories...</label>
            <div className="input-row">
              <input
                type="text"
                id="globalSearch"
                placeholder="What are you looking for?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <button type="submit" className="action-btn" disabled={isSearching}>
                {isSearching ? '...' : 'Search'}
              </button>
            </div>
          </form>
        </div>

        {hasSearched && !isSearching && results.length === 0 && (
          <div className="empty-state">No results found.</div>
        )}

        {categories.length > 0 && (
          <div className="block-section">
            <h2>Categories</h2>
            <div className="categories-grid">
              {categories.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="category-card"
                  onClick={() => navigate(`/channel?category=${encodeURIComponent(game.name)}`)}
                >
                  <img src={game.boxArtURL} alt={game.name} />
                  <span>{game.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {liveStreams.length > 0 && (
          <div className="block-section">
            <h2>Live Streams</h2>
            <div className="vod-grid">
              {liveStreams.map((user) => (
                <div
                  key={user.id}
                  onClick={() => navigate(`/player?live=${encodeURIComponent(user.login)}`)}
                  className="vod-card live-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/player?live=${encodeURIComponent(user.login)}`);
                    }
                  }}
                >
                  <div className="vod-thumb-wrap">
                    <img
                      src={
                        user.stream?.previewImageURL ||
                        'https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg'
                      }
                      alt={user.stream?.title}
                      className="vod-thumb"
                    />
                    <div className="vod-chip live-chip">LIVE</div>
                  </div>
                  <div className="vod-body">
                    <div className="vod-owner-row">
                      {user.profileImageURL && (
                        <img src={user.profileImageURL} alt={user.displayName} />
                      )}
                      <span>{user.displayName}</span>
                    </div>
                    <h3 title={user.stream?.title}>{user.stream?.title}</h3>
                    <div className="vod-meta-row">
                      <span className="live-viewers">
                        {formatViewers(user.stream?.viewersCount || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {channels.length > 0 && (
          <div className="block-section">
            <h2>Channels</h2>
            <div className="sub-list">
              {channels.map((user) => (
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
    </>
  );
}

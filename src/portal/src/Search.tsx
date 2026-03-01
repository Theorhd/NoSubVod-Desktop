import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserInfo, VOD } from '../../shared/types';

type SearchGame = {
  id: string;
  name: string;
  boxArtURL: string;
  __typename: 'Game';
};

type SearchUser = UserInfo & {
  __typename: 'User';
};

type SearchResult = SearchGame | SearchUser;

function formatViews(views: number): string {
  if (!views) return '0 views';
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} views`;
}

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [categoryVods, setCategoryVods] = useState<VOD[]>([]);
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);

  const channels = useMemo(
    () => results.filter((result): result is SearchUser => result.__typename === 'User'),
    [results]
  );
  const categories = useMemo(
    () => results.filter((result): result is SearchGame => result.__typename === 'Game'),
    [results]
  );

  const fetchCategoryVods = async (categoryName: string) => {
    const normalized = categoryName.trim();
    if (!normalized) return;

    setSelectedCategory(normalized);
    setIsCategoryLoading(true);
    try {
      const res = await fetch(`/api/search/category-vods?name=${encodeURIComponent(normalized)}`);
      if (!res.ok) {
        throw new Error('Failed to fetch category VODs');
      }
      const data = (await res.json()) as VOD[];
      setCategoryVods(data);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('category', normalized);
        return next;
      });
    } catch (error) {
      console.error(error);
      setCategoryVods([]);
    } finally {
      setIsCategoryLoading(false);
    }
  };

  useEffect(() => {
    const category = searchParams.get('category') || '';
    if (!category) {
      setSelectedCategory('');
      setCategoryVods([]);
      return;
    }

    void fetchCategoryVods(category);
  }, []);

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

        {categories.length > 0 && (
          <div className="block-section">
            <h2>Categories</h2>
            <div className="categories-grid">
              {categories.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className={`category-card ${selectedCategory === game.name ? 'active' : ''}`}
                  onClick={() => {
                    void fetchCategoryVods(game.name);
                  }}
                >
                  <img src={game.boxArtURL} alt={game.name} />
                  <span>{game.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedCategory && (
          <div className="block-section">
            <div className="section-head">
              <h2>{selectedCategory} VODs</h2>
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  navigate(`/channel?category=${encodeURIComponent(selectedCategory)}`)
                }
              >
                Open dedicated page
              </button>
            </div>

            {isCategoryLoading && <div className="status-line">Loading category VODs...</div>}

            {!isCategoryLoading && categoryVods.length === 0 && (
              <div className="empty-state">No VODs found for this category.</div>
            )}

            {!isCategoryLoading && categoryVods.length > 0 && (
              <div className="vod-grid">
                {categoryVods.map((vod) => (
                  <button
                    key={vod.id}
                    type="button"
                    className="vod-card"
                    onClick={() => navigate(`/player?vod=${vod.id}`)}
                  >
                    <div className="vod-thumb-wrap">
                      <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
                    </div>
                    <div className="vod-body">
                      <h3 title={vod.title}>{vod.title}</h3>
                      <div className="vod-meta-row">
                        <span>{vod.owner?.displayName || 'Unknown stream'}</span>
                        <span>{formatViews(vod.viewCount)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

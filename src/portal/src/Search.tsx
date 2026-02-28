import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/search/global?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Failed to search');
      const data = await res.json();
      setSearchResults(data);
    } catch (err: any) {
      console.error(err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const channels = results.filter(r => r.__typename === 'User');
  const categories = results.filter(r => r.__typename === 'Game');

  return (
    <>
      <div className="top-bar">
        <h1>
          <button className="logo-btn" onClick={() => navigate('/')} aria-label="Home" style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer' }}>Search Twitch</button>
        </h1>
      </div>

      <div className="container" style={{ maxWidth: '800px' }}>
        <div className="card">
          <form onSubmit={handleSearch}>
            <label htmlFor="globalSearch">Search Channels, Categories...</label>
            <div className="input-row">
              <input 
                type="text" 
                id="globalSearch" 
                placeholder="What are you looking for?" 
                value={query}
                onChange={e => setQuery(e.target.value)}
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
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '20px' }}>
            No results found.
          </div>
        )}

        {channels.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h2>Channels</h2>
            <div className="sub-list">
              {channels.map(user => (
                <div key={user.id} className="sub-item">
                  <button
                    type="button"
                    className="sub-link"
                    onClick={() => navigate(`/channel?user=${encodeURIComponent(user.login)}`)}
                  >
                    <img src={user.profileImageURL} alt={user.displayName} style={{ borderRadius: '50%', width: '50px', height: '50px', objectFit: 'cover' }} />
                    <div className="name" style={{ marginLeft: '1.5rem', fontWeight: 'bold', fontSize: '1.1rem' }}>{user.displayName}</div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div>
            <h2>Categories</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '15px' }}>
              {categories.map(game => (
                <div key={game.id} style={{ textAlign: 'center', backgroundColor: 'var(--surface)', padding: '10px', borderRadius: '8px' }}>
                  <img src={game.boxArtURL} alt={game.name} style={{ width: '100%', borderRadius: '4px', marginBottom: '10px' }} />
                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{game.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();
  const [subs, setSubs] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [streamerInput, setStreamerInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [vodInput, setVodInput] = useState('');
  const [vodError, setVodError] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('nsv_subs');
    if (saved) setSubs(JSON.parse(saved));
  }, []);

  const saveSubs = (newSubs: any[]) => {
    setSubs(newSubs);
    localStorage.setItem('nsv_subs', JSON.stringify(newSubs));
  };

  const handleVodSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = vodInput.trim();
    setVodError(false);
    
    let vodId = input;
    const match = input.match(/videos\/(\d+)/) || input.match(/^(\d+)$/);
    
    if (match && match[1]) {
      vodId = match[1];
      navigate(`/player?vod=${vodId}`);
    } else {
      setVodError(true);
    }
  };

  const handleAddSub = async () => {
    const username = streamerInput.trim().toLowerCase();
    if (!username) return;

    if (subs.some(s => s.login === username)) {
      setModalError('Already subbed to this user.');
      return;
    }

    setIsSearching(true);
    setModalError('');

    try {
      const res = await fetch(`/api/user/${username}`);
      if (!res.ok) throw new Error('User not found');
      const user = await res.json();
      
      saveSubs([...subs, {
        login: user.login,
        displayName: user.displayName,
        profileImageURL: user.profileImageURL
      }]);
      setShowModal(false);
      setStreamerInput('');
    } catch (err: any) {
      setModalError(err.message || 'Error finding user.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeleteSub = (e: React.MouseEvent, login: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (globalThis.confirm('Remove this streamer?')) {
      saveSubs(subs.filter(s => s.login !== login));
    }
  };

  return (
    <>
      <div className="top-bar">
        <h1>
          <button className="logo-btn" onClick={() => navigate('/')} aria-label="Home">NoSubVod</button>
        </h1>
        <button className="add-btn" onClick={() => setShowModal(true)}>+</button>
      </div>

      <div className="container">
        <div className="card">
          <form onSubmit={handleVodSubmit}>
            <label htmlFor="vodInput">Direct VOD ID or URL</label>
            <div className="input-row">
              <input 
                type="text" 
                id="vodInput" 
                placeholder="e.g. 2012345678" 
                value={vodInput}
                onChange={e => setVodInput(e.target.value)}
                autoComplete="off" 
              />
              <button type="submit" className="action-btn">Play</button>
            </div>
            {vodError && <div className="error-text">Please enter a valid VOD ID.</div>}
          </form>
        </div>

        <h2>My Subs</h2>
        <div className="sub-list">
          {subs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              No subs yet. Click the + button to add one!
            </div>
          ) : (
            subs.map(sub => (
              <div 
                key={sub.login} 
                className="sub-item"
              >
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
                  onClick={(e) => handleDeleteSub(e, sub.login)}
                >&times;</button>
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
              onChange={e => setStreamerInput(e.target.value)}
              autoComplete="off" 
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleAddSub()}
            />
            {modalError && <div className="error-text">{modalError}</div>}
            <div className="btn-row">
              <button className="action-btn cancel" onClick={() => setShowModal(false)}>Cancel</button>
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
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number) {
  if (!views) return '0 views';
  if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M views';
  if (views >= 1000) return (views / 1000).toFixed(1) + 'K views';
  return views + ' views';
}

export default function Trends() {
  const navigate = useNavigate();
  const [vods, setVods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/trends`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch trending VODs');
        return res.json();
      })
      .then(data => {
        setVods(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <>
      <div className="top-bar">
        <h1>
          <button className="logo-btn" onClick={() => navigate('/')} aria-label="Home" style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer' }}>Trending VODs</button>
        </h1>
      </div>

      <div className="container" style={{ maxWidth: '800px' }}>
        {loading && <div style={{ textAlign: 'center', marginTop: '50px' }}>Loading Trending VODs...</div>}
        {error && <div className="error-text" style={{ textAlign: 'center', marginTop: '50px' }}>{error}</div>}
        
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {vods.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)' }}>No trends available right now.</div>
            ) : (
              vods.map(vod => (
                <button
                  key={vod.id}
                  type="button"
                  onClick={() => navigate(`/player?vod=${vod.id}`)}
                  onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  onFocus={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onBlur={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', width: '100%', backgroundColor: 'var(--surface)', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s' }}
                >
                  <div style={{ position: 'relative' }}>
                    <img src={vod.previewThumbnailURL} alt={vod.title} style={{ width: '100%', display: 'block', aspectRatio: '16/9', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', backgroundColor: 'rgba(0,0,0,0.8)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                      {formatTime(vod.lengthSeconds)}
                    </div>
                  </div>
                  <div style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      {vod.owner && vod.owner.profileImageURL && (
                        <img 
                          src={vod.owner.profileImageURL} 
                          alt={vod.owner.displayName} 
                          style={{ width: '30px', height: '30px', borderRadius: '50%', marginRight: '10px', objectFit: 'cover' }}
                        />
                      )}
                      <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text)' }}>
                        {vod.owner ? vod.owner.displayName : 'Unknown Streamer'}
                      </div>
                    </div>
                    <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={vod.title}>{vod.title}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{vod.game?.name || 'No Category'}</span>
                      <span>{formatViews(vod.viewCount)}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                      {new Date(vod.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

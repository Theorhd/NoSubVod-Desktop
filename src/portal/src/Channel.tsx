import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number) {
  if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M views';
  if (views >= 1000) return (views / 1000).toFixed(1) + 'K views';
  return views + ' views';
}

export default function Channel() {
  const [searchParams] = useSearchParams();
  const user = searchParams.get('user');
  const navigate = useNavigate();

  const [vods, setVods] = useState<any[]>([]);
  const [history, setHistory] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      setError('No user specified');
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/user/${user}/vods`).then((res) => {
        if (!res.ok) throw new Error('Failed to fetch VODs');
        return res.json();
      }),
      fetch('/api/history')
        .then((res) => res.json())
        .catch(() => ({})),
    ])
      .then(([vodsData, historyData]) => {
        setVods(vodsData);
        setHistory(historyData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [user]);

  const addToWatchlist = async (e: React.MouseEvent, vod: any) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodId: vod.id,
          title: vod.title,
          previewThumbnailURL: vod.previewThumbnailURL,
          lengthSeconds: vod.lengthSeconds,
        }),
      });
      alert('VOD ajoutée à Ma Liste !');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              marginRight: '15px',
            }}
          >
            &larr;
          </button>
          <h1 style={{ margin: 0 }}>
            <button
              type="button"
              onClick={() => navigate('/')}
              aria-label={`Go to home`}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text)',
                fontSize: '1.2rem',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
              }}
            >
              {user}&apos;s VODs
            </button>
          </h1>
        </div>
      </div>

      <div className="container" style={{ maxWidth: '800px' }}>
        {loading && <div style={{ textAlign: 'center', marginTop: '50px' }}>Loading VODs...</div>}
        {error && (
          <div className="error-text" style={{ textAlign: 'center', marginTop: '50px' }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '20px',
            }}
          >
            {vods.length === 0 ? (
              <div
                style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)' }}
              >
                No VODs found.
              </div>
            ) : (
              vods.map((vod) => {
                const hist = history[vod.id];
                const progress =
                  hist && hist.duration > 0
                    ? Math.min(100, (hist.timecode / hist.duration) * 100)
                    : 0;

                return (
                  <button
                    key={vod.id}
                    type="button"
                    onClick={() => navigate(`/player?vod=${vod.id}`)}
                    onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                    onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    onFocus={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                    onBlur={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      textAlign: 'left',
                      width: '100%',
                      backgroundColor: 'var(--surface)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'transform 0.2s',
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={vod.previewThumbnailURL}
                        alt={vod.title}
                        style={{
                          width: '100%',
                          display: 'block',
                          aspectRatio: '16/9',
                          objectFit: 'cover',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '8px',
                          backgroundColor: 'rgba(0,0,0,0.8)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {formatTime(vod.lengthSeconds)}
                      </div>
                      <button
                        onClick={(e) => addToWatchlist(e, vod)}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          backgroundColor: 'rgba(0,0,0,0.8)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '50%',
                          width: '30px',
                          height: '30px',
                          cursor: 'pointer',
                          zIndex: 10,
                        }}
                      >
                        +
                      </button>
                      {progress > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            width: '100%',
                            height: '4px',
                            backgroundColor: 'rgba(255,255,255,0.2)',
                          }}
                        >
                          <div
                            style={{
                              width: `${progress}%`,
                              height: '100%',
                              backgroundColor: '#e91e63',
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '12px' }}>
                      <h3
                        style={{
                          margin: '0 0 5px 0',
                          fontSize: '1rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={vod.title}
                      >
                        {vod.title}
                      </h3>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{vod.game?.name || 'No Category'}</span>
                        <span>{formatViews(vod.viewCount)}</span>
                      </div>
                      <div
                        style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '5px' }}
                      >
                        {new Date(vod.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}

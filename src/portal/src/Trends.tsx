import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VOD } from '../../shared/types';

const PAGE_SIZE = 24;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const hoursPrefix = h > 0 ? `${h}:` : '';
  return `${hoursPrefix}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (!views) return '0 views';
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} views`;
}

function filterShortVods(vods: VOD[]): VOD[] {
  return vods.filter((v) => v.lengthSeconds >= 210);
}

export default function Trends() {
  const navigate = useNavigate();
  const [vods, setVods] = useState<VOD[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  // ── Pagination state ──
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [allVods, setAllVods] = useState<VOD[]>([]);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    fetch('/api/trends')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch trending VODs');
        return res.json();
      })
      .then((data: VOD[]) => {
        const filtered = filterShortVods(data);
        setAllVods(filtered);
        setVods(filtered.slice(0, PAGE_SIZE));
        setIsInitialLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsInitialLoading(false);
      });
  }, []);

  const loadMore = useCallback(() => {
    if (isFetchingRef.current || visibleCount >= allVods.length) return;

    isFetchingRef.current = true;
    setIsLoadingMore(true);

    // Slight artificial delay to allow UI to render loading state gracefully
    setTimeout(() => {
      const nextCount = visibleCount + PAGE_SIZE;
      setVods(allVods.slice(0, nextCount));
      setVisibleCount(nextCount);
      setIsLoadingMore(false);
      isFetchingRef.current = false;
    }, 150);
  }, [allVods, visibleCount]);

  const observerRef = useRef<IntersectionObserver | null>(null);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingRef.current || isInitialLoading) return;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      if (node) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting) {
              loadMore();
            }
          },
          { rootMargin: '400px' }
        );
        observerRef.current.observe(node);
      }
    },
    [isInitialLoading, loadMore]
  );
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
              Trending VODs
            </button>
          </h1>
        </div>
      </div>

      <div className="container">
        {isInitialLoading && <div className="status-line">Loading trending VODs...</div>}
        {error && <div className="error-text">{error}</div>}

        {!isInitialLoading && !error && vods.length === 0 && (
          <div className="empty-state">No trends available right now.</div>
        )}

        {!isInitialLoading && !error && vods.length > 0 && (
          <div className="vod-grid">
            {vods.map((vod) => (
              <div key={vod.id} className="vod-card">
                <div className="vod-thumb-wrap">
                  <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
                  <div className="vod-chip vod-duration">{formatTime(vod.lengthSeconds)}</div>
                </div>
                <div className="vod-body">
                  <div className="vod-owner-row">
                    {vod.owner?.profileImageURL && (
                      <img src={vod.owner.profileImageURL} alt={vod.owner.displayName} />
                    )}
                    <span>{vod.owner?.displayName || 'Unknown Streamer'}</span>
                  </div>
                  <h3 title={vod.title}>
                    <button
                      type="button"
                      className="stretched-link"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        font: 'inherit',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                      onClick={() => navigate(`/player?vod=${vod.id}`)}
                    >
                      {vod.title}
                    </button>
                  </h3>
                  <div className="vod-meta-row">
                    <span>{vod.game?.name || 'No Category'}</span>
                    <span>{formatViews(vod.viewCount)}</span>
                  </div>
                  <div className="vod-date">{new Date(vod.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={lastElementRef} style={{ height: '20px', width: '100%' }} aria-hidden="true" />
        {isLoadingMore && <div className="status-line">Loading more...</div>}
      </div>
    </>
  );
}

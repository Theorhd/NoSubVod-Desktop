import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { HistoryEntry, LiveStream, LiveStreamsPage, VOD } from '../../shared/types';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const hoursPrefix = h > 0 ? `${h}:` : '';
  return `${hoursPrefix}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} views`;
}

function formatViewers(viewers: number): string {
  if (viewers >= 1000000) return `${(viewers / 1000000).toFixed(1)}M viewers`;
  if (viewers >= 1000) return `${(viewers / 1000).toFixed(1)}K viewers`;
  return `${viewers} viewers`;
}

type CategoryVodPage = {
  items: VOD[];
  hasMore: boolean;
  nextCursor: string | null;
};

export default function Channel() {
  const [searchParams] = useSearchParams();
  const user = searchParams.get('user');
  const category = searchParams.get('category');
  const navigate = useNavigate();

  // ── Shared state ──────────────────────────────────────────────────────────
  const [vods, setVods] = useState<VOD[]>([]);
  const [liveStream, setLiveStream] = useState<LiveStream | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Category-specific state ───────────────────────────────────────────────
  const [catLiveStreams, setCatLiveStreams] = useState<LiveStream[]>([]);
  const [catLiveCursor, setCatLiveCursor] = useState<string | null>(null);
  const [catLiveHasMore, setCatLiveHasMore] = useState(false);
  const [catLiveLoading, setCatLiveLoading] = useState(false);
  const [catVodCursor, setCatVodCursor] = useState<string | null>(null);
  const [catVodHasMore, setCatVodHasMore] = useState(false);
  const [catVodLoading, setCatVodLoading] = useState(false);

  const title = useMemo(() => {
    if (category) return category;
    if (user) return `${user}`;
    return 'VODs';
  }, [category, user]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user && !category) {
      setError('No channel or category specified');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    if (user) {
      Promise.all([
        fetch(`/api/user/${encodeURIComponent(user)}/vods`).then((res) => {
          if (!res.ok) throw new Error('Failed to fetch VODs');
          return res.json();
        }),
        fetch(`/api/user/${encodeURIComponent(user)}/live`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
        fetch('/api/history')
          .then((res) => (res.ok ? res.json() : {}))
          .catch(() => ({})),
      ])
        .then(([vodsData, liveData, historyData]) => {
          setVods(vodsData as VOD[]);
          setLiveStream((liveData as LiveStream | null) || null);
          setHistory(historyData as Record<string, HistoryEntry>);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    } else if (category) {
      Promise.all([
        fetch(`/api/search/category-vods?name=${encodeURIComponent(category)}&limit=24`).then(
          (res) => {
            if (!res.ok) throw new Error('Failed to fetch VODs');
            return res.json() as Promise<CategoryVodPage>;
          }
        ),
        fetch(`/api/live/category?name=${encodeURIComponent(category)}&limit=12`)
          .then((res) => (res.ok ? (res.json() as Promise<LiveStreamsPage>) : null))
          .catch(() => null),
        fetch('/api/history')
          .then((res) => (res.ok ? res.json() : {}))
          .catch(() => ({})),
      ])
        .then(([vodPage, livePage, historyData]) => {
          setVods(vodPage.items || []);
          setCatVodCursor(vodPage.nextCursor || null);
          setCatVodHasMore(Boolean(vodPage.hasMore));
          if (livePage) {
            setCatLiveStreams(livePage.items || []);
            setCatLiveCursor(livePage.nextCursor || null);
            setCatLiveHasMore(Boolean(livePage.hasMore));
          }
          setHistory(historyData as Record<string, HistoryEntry>);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [user, category]);

  // ── Load more handlers ────────────────────────────────────────────────────
  const loadMoreCatVods = async () => {
    if (!category || catVodLoading || !catVodHasMore) return;
    setCatVodLoading(true);
    try {
      const params = new URLSearchParams({ name: category, limit: '24' });
      if (catVodCursor) params.set('cursor', catVodCursor);
      const res = await fetch(`/api/search/category-vods?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load more VODs');
      const page = (await res.json()) as CategoryVodPage;
      setVods((prev) => {
        const existingIds = new Set(prev.map((v) => v.id));
        return [...prev, ...(page.items || []).filter((v) => !existingIds.has(v.id))];
      });
      setCatVodCursor(page.nextCursor || null);
      setCatVodHasMore(Boolean(page.hasMore));
    } catch {
      // ignore
    } finally {
      setCatVodLoading(false);
    }
  };

  const loadMoreCatLive = async () => {
    if (!category || catLiveLoading || !catLiveHasMore) return;
    setCatLiveLoading(true);
    try {
      const params = new URLSearchParams({ name: category, limit: '12' });
      if (catLiveCursor) params.set('cursor', catLiveCursor);
      const res = await fetch(`/api/live/category?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load more lives');
      const page = (await res.json()) as LiveStreamsPage;
      setCatLiveStreams((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        return [...prev, ...(page.items || []).filter((s) => !existingIds.has(s.id))];
      });
      setCatLiveCursor(page.nextCursor || null);
      setCatLiveHasMore(Boolean(page.hasMore));
    } catch {
      // ignore
    } finally {
      setCatLiveLoading(false);
    }
  };

  // ── Watchlist ─────────────────────────────────────────────────────────────
  const addToWatchlist = async (e: React.MouseEvent, vod: VOD) => {
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
    } catch (err) {
      console.error(err);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderLiveCard = (stream: LiveStream, loginKey?: string) => (
    <button
      key={stream.id}
      type="button"
      onClick={() =>
        navigate(`/player?live=${encodeURIComponent(loginKey || stream.broadcaster.login)}`)
      }
      className="vod-card live-card"
    >
      <div className="vod-thumb-wrap">
        <img
          src={
            stream.previewImageURL ||
            'https://static-cdn.jtvnw.net/ttv-static/404_preview-320x180.jpg'
          }
          alt={stream.title}
          className="vod-thumb"
        />
        <div className="vod-chip live-chip">LIVE</div>
      </div>
      <div className="vod-body">
        <div className="vod-owner-row">
          {stream.broadcaster.profileImageURL && (
            <img src={stream.broadcaster.profileImageURL} alt={stream.broadcaster.displayName} />
          )}
          <span>{stream.broadcaster.displayName}</span>
        </div>
        <h3 title={stream.title}>{stream.title}</h3>
        <div className="vod-meta-row">
          <span>{stream.game?.name || 'No category'}</span>
          <span className="live-viewers">{formatViewers(stream.viewerCount)}</span>
        </div>
      </div>
    </button>
  );

  return (
    <>
      <div className="top-bar">
        <div className="bar-main">
          <button onClick={() => navigate(-1)} className="back-btn" aria-label="Back" type="button">
            &larr;
          </button>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="container">
        {loading && <div className="status-line">Loading...</div>}
        {error && <div className="error-text">{error}</div>}

        {!loading && !error && vods.length === 0 && catLiveStreams.length === 0 && (
          <div className="empty-state">No content found.</div>
        )}

        {/* User live (user-channel mode) */}
        {!loading && !error && liveStream && user && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <h2>Live</h2>
            <div className="vod-grid">{renderLiveCard(liveStream, user)}</div>
          </div>
        )}

        {/* Category live streams */}
        {!loading && !error && category && catLiveStreams.length > 0 && (
          <div className="block-section" style={{ marginTop: 0 }}>
            <div className="section-header-row">
              <h2>Lives en ce moment</h2>
              <span className="section-count">
                {catLiveStreams.length} stream{catLiveStreams.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="vod-grid">{catLiveStreams.map((stream) => renderLiveCard(stream))}</div>
            {catLiveHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatLive()}
                  disabled={catLiveLoading}
                >
                  {catLiveLoading ? 'Chargement...' : 'Voir plus de lives'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* VODs */}
        {!loading && !error && vods.length > 0 && (
          <div
            className="block-section"
            style={{ marginTop: catLiveStreams.length > 0 || liveStream ? '16px' : '0' }}
          >
            <div className="section-header-row">
              <h2>VODs</h2>
              <span className="section-count">
                {vods.length} VOD{vods.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="vod-grid">
              {vods.map((vod) => {
                const hist = history[vod.id];
                const progress =
                  hist && hist.duration > 0
                    ? Math.min(100, (hist.timecode / hist.duration) * 100)
                    : 0;
                return (
                  <div
                    key={vod.id}
                    onClick={() => navigate(`/player?vod=${vod.id}`)}
                    className="vod-card"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/player?vod=${vod.id}`);
                      }
                    }}
                  >
                    <div className="vod-thumb-wrap">
                      <img src={vod.previewThumbnailURL} alt={vod.title} className="vod-thumb" />
                      <div className="vod-chip vod-duration">{formatTime(vod.lengthSeconds)}</div>
                      <button
                        onClick={(e) => {
                          void addToWatchlist(e, vod);
                        }}
                        className="vod-watchlist-btn"
                        type="button"
                        title="Add to watch later"
                      >
                        +
                      </button>
                      {progress > 0 && (
                        <div className="progress-track absolute-track">
                          <div className="progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="vod-body">
                      <h3 title={vod.title}>{vod.title}</h3>
                      <div className="vod-meta-row">
                        <span>{vod.game?.name || 'No Category'}</span>
                        <span>{formatViews(vod.viewCount)}</span>
                      </div>
                      <div className="vod-date">{new Date(vod.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {catVodHasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => void loadMoreCatVods()}
                  disabled={catVodLoading}
                >
                  {catVodLoading ? 'Chargement...' : 'Voir plus de VODs'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

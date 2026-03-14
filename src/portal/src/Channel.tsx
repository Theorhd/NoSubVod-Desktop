import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { HistoryEntry, LiveStream, LiveStreamsPage, VOD } from '../../shared/types';
import { StreamCard } from './components/StreamCard';
import { VODCard } from './components/VODCard';
import { TopBar } from './components/TopBar';

type CategoryVodPage = {
  items: VOD[];
  hasMore: boolean;
  nextCursor: string | null;
};

const MIN_VOD_DURATION_SECONDS = 210;

function filterShortVods(vods: VOD[]): VOD[] {
  return vods.filter((vod) => (vod.lengthSeconds || 0) >= MIN_VOD_DURATION_SECONDS);
}

export default function Channel() {
  const [searchParams] = useSearchParams();
  const user = searchParams.get('user');
  const category = searchParams.get('category');
  const categoryId = searchParams.get('categoryId');
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
          setVods(filterShortVods(vodsData as VOD[]));
          setLiveStream((liveData as LiveStream | null) || null);
          setHistory(historyData as Record<string, HistoryEntry>);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    } else if (category) {
      const categoryVodParams = new URLSearchParams({ name: category, limit: '24' });
      if (categoryId) categoryVodParams.set('id', categoryId);
      Promise.all([
        fetch(`/api/search/category-vods?${categoryVodParams.toString()}`).then((res) => {
          if (!res.ok) throw new Error('Failed to fetch VODs');
          return res.json() as Promise<CategoryVodPage>;
        }),
        fetch(`/api/live/category?name=${encodeURIComponent(category)}&limit=12`)
          .then((res) => (res.ok ? (res.json() as Promise<LiveStreamsPage>) : null))
          .catch(() => null),
        fetch('/api/history')
          .then((res) => (res.ok ? res.json() : {}))
          .catch(() => ({})),
      ])
        .then(([vodPage, livePage, historyData]) => {
          setVods(filterShortVods(vodPage.items || []));
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
  }, [user, category, categoryId]);

  // ── Load more handlers ────────────────────────────────────────────────────
  const loadMoreCatVods = async () => {
    if (!category || catVodLoading || !catVodHasMore) return;
    setCatVodLoading(true);
    try {
      const params = new URLSearchParams({ name: category, limit: '24' });
      if (categoryId) params.set('id', categoryId);
      if (catVodCursor) params.set('cursor', catVodCursor);
      const res = await fetch(`/api/search/category-vods?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load more VODs');
      const page = (await res.json()) as CategoryVodPage;
      if (page.items && page.items.length > 0) {
        setVods((prev) => {
          const existingIds = new Set(prev.map((v) => v.id));
          return [...prev, ...filterShortVods(page.items).filter((v) => !existingIds.has(v.id))];
        });
      }
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
      if (page.items && page.items.length > 0) {
        setCatLiveStreams((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          return [...prev, ...page.items.filter((s) => !existingIds.has(s.id))];
        });
      }
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

  return (
    <>
      <TopBar mode="back" title={title} />

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
            <div className="vod-grid">
              <StreamCard 
                key={liveStream.id} 
                stream={liveStream} 
                onWatch={(login) => navigate(`/player?live=${encodeURIComponent(login)}`)} 
              />
            </div>
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
            <div className="vod-grid">
              {catLiveStreams.map((stream) => (
                <StreamCard 
                  key={stream.id} 
                  stream={stream} 
                  onWatch={(login) => navigate(`/player?live=${encodeURIComponent(login)}`)} 
                />
              ))}
            </div>
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
                return (
                  <VODCard
                    key={vod.id}
                    vod={vod}
                    onWatch={(id) => navigate(`/player?vod=${id}`)}
                    historyEntry={hist}
                    onAddToWatchlist={(e, vodItem) => {
                      e.stopPropagation();
                      void addToWatchlist(e as any, vodItem);
                    }}
                  />
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

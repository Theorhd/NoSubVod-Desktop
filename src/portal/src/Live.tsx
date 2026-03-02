import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveStream, LiveStreamsPage, SubEntry } from '../../shared/types';

const PAGE_SIZE = 24;

type LiveMode = 'all' | 'search' | 'category';

type StreamWithScore = LiveStream & {
  __score: number;
};

type TopCategory = {
  id: string;
  name: string;
  boxArtURL: string;
};

function formatViewers(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M viewers`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K viewers`;
  return `${value} viewers`;
}

function formatUptime(startedAt: string): string {
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  const minutes = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function computeScore(stream: LiveStream, subLogins: Set<string>): number {
  const login = stream.broadcaster.login.toLowerCase();
  const subBoost = subLogins.has(login) ? 32 : 0;
  const frenchBoost = (stream.language || '').toLowerCase() === 'fr' ? 8 : 0;
  const viewerScore = Math.log10((stream.viewerCount || 0) + 10) * 10;
  const uptimeHours = Math.max(0, (Date.now() - new Date(stream.startedAt).getTime()) / 3600000);
  const freshnessBoost = Math.max(0, 4 - Math.min(uptimeHours, 4));

  return viewerScore + subBoost + frenchBoost + freshnessBoost;
}

function rankStreams(streams: LiveStream[], subLogins: Set<string>): LiveStream[] {
  return streams
    .map(
      (stream) =>
        ({
          ...stream,
          __score: computeScore(stream, subLogins),
        }) as StreamWithScore
    )
    .sort((left, right) => right.__score - left.__score)
    .map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { __score, ...stream } = item;
      return stream;
    });
}

export default function Live() {
  const navigate = useNavigate();

  // ── Mode & search state ───────────────────────────────────────────────────
  const [mode, setMode] = useState<LiveMode>('all');
  const [searchInput, setSearchInput] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [topCategories, setTopCategories] = useState<TopCategory[]>([]);

  // ── Stream list state ─────────────────────────────────────────────────────
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [subLogins, setSubLogins] = useState<Set<string>>(new Set());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingRef = useRef(false);
  const isInitialLoadingRef = useRef(true);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetStreamState = useCallback(() => {
    setStreams([]);
    seenIdsRef.current = new Set();
    setNextCursor(null);
    setHasMore(true);
    setError('');
    isInitialLoadingRef.current = true;
    isFetchingRef.current = false;
  }, []);

  const appendRankedStreams = useCallback(
    (incoming: LiveStream[]) => {
      const fresh = incoming.filter((stream) => {
        if (seenIdsRef.current.has(stream.id)) return false;
        seenIdsRef.current.add(stream.id);
        return true;
      });
      if (fresh.length === 0) return;
      setStreams((current) => rankStreams([...current, ...fresh], subLogins));
    },
    [subLogins]
  );

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchAllPage = useCallback(
    async (cursor?: string | null) => {
      if (isFetchingRef.current) return;
      if (!isInitialLoadingRef.current && !hasMore) return;

      isFetchingRef.current = true;
      setError('');
      if (isInitialLoadingRef.current) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/live?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load live streams');
        const payload = (await res.json()) as LiveStreamsPage;
        appendRankedStreams(payload.items || []);
        setNextCursor(payload.nextCursor || null);
        setHasMore(Boolean(payload.hasMore));
      } catch (err: any) {
        setError(err?.message || 'Failed to load live streams');
      } finally {
        isFetchingRef.current = false;
        isInitialLoadingRef.current = false;
        setIsInitialLoading(false);
        setIsLoadingMore(false);
      }
    },
    [appendRankedStreams, hasMore]
  );

  const fetchCategoryPage = useCallback(
    async (name: string, cursor?: string | null) => {
      if (isFetchingRef.current) return;
      if (!isInitialLoadingRef.current && !hasMore) return;

      isFetchingRef.current = true;
      setError('');
      if (isInitialLoadingRef.current) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const params = new URLSearchParams({ name, limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/live/category?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load category streams');
        const payload = (await res.json()) as LiveStreamsPage;
        appendRankedStreams(payload.items || []);
        setNextCursor(payload.nextCursor || null);
        setHasMore(Boolean(payload.hasMore));
      } catch (err: any) {
        setError(err?.message || 'Failed to load category streams');
      } finally {
        isFetchingRef.current = false;
        isInitialLoadingRef.current = false;
        setIsInitialLoading(false);
        setIsLoadingMore(false);
      }
    },
    [appendRankedStreams, hasMore]
  );

  const fetchSearch = useCallback(async (q: string) => {
    isFetchingRef.current = true;
    setError('');
    setIsInitialLoading(true);
    try {
      const res = await fetch(`/api/live/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error('Search failed');
      const payload = (await res.json()) as LiveStreamsPage;
      const fresh = (payload.items || []).filter((s) => {
        if (seenIdsRef.current.has(s.id)) return false;
        seenIdsRef.current.add(s.id);
        return true;
      });
      setStreams(fresh);
      setHasMore(false);
      setNextCursor(null);
    } catch (err: any) {
      setError(err?.message || 'Search failed');
    } finally {
      isFetchingRef.current = false;
      isInitialLoadingRef.current = false;
      setIsInitialLoading(false);
    }
  }, []);

  // ── Load subs + initial data ──────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      // Load subs
      try {
        const settingsRes = await fetch('/api/settings');
        let oneSync = false;
        if (settingsRes.ok) {
          const s = (await settingsRes.json()) as { oneSync?: boolean };
          oneSync = Boolean(s.oneSync);
        }
        let subEntries: SubEntry[] = [];
        if (oneSync) {
          const subsRes = await fetch('/api/subs');
          if (subsRes.ok) subEntries = (await subsRes.json()) as SubEntry[];
        } else {
          const local = localStorage.getItem('nsv_subs');
          subEntries = local ? (JSON.parse(local) as SubEntry[]) || [] : [];
        }
        setSubLogins(new Set(subEntries.map((e) => e.login.toLowerCase())));
      } catch {
        setSubLogins(new Set());
      }

      // Load top categories (non-blocking)
      fetch('/api/live/top-categories')
        .then((r) => (r.ok ? r.json() : []))
        .then((cats: TopCategory[]) => setTopCategories(cats || []))
        .catch(() => {});

      // First page of "all"
      void fetchAllPage(null);
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setStreams((current) => rankStreams(current, subLogins));
  }, [subLogins]);

  // ── Infinite scroll observer (only in all/category modes) ────────────────
  useEffect(() => {
    if (mode === 'search') return;
    if (!sentinelRef.current) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        if (isFetchingRef.current || !hasMore) return;
        if (mode === 'all') void fetchAllPage(nextCursor);
        if (mode === 'category' && activeCategory)
          void fetchCategoryPage(activeCategory, nextCursor);
      },
      { root: null, rootMargin: '520px 0px', threshold: 0.01 }
    );
    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [fetchAllPage, fetchCategoryPage, hasMore, nextCursor, mode, activeCategory]);

  // ── Mode switching helpers ────────────────────────────────────────────────
  const switchToAll = useCallback(() => {
    setMode('all');
    setActiveCategory(null);
    setSearchInput('');
    resetStreamState();
    void fetchAllPage(null);
  }, [resetStreamState, fetchAllPage]);

  const switchToCategory = useCallback(
    (name: string) => {
      setMode('category');
      setActiveCategory(name);
      setSearchInput('');
      resetStreamState();
      void fetchCategoryPage(name, null);
    },
    [resetStreamState, fetchCategoryPage]
  );

  const handleSearchSubmit = useCallback(
    (e: React.SubmitEvent<HTMLFormElement>) => {
      e.preventDefault();
      const q = searchInput.trim();
      if (!q) {
        switchToAll();
        return;
      }
      setMode('search');
      setActiveCategory(null);
      resetStreamState();
      void fetchSearch(q);
    },
    [searchInput, resetStreamState, fetchSearch, switchToAll]
  );

  // ── UI labels ─────────────────────────────────────────────────────────────
  const emptyStateMessage = useMemo(() => {
    if (mode === 'search') return 'Aucun live trouvé pour cette recherche.';
    if (mode === 'category') return `Aucun live pour la catégorie "${activeCategory}".`;
    return 'Aucun stream disponible pour le moment.';
  }, [mode, activeCategory]);

  const headerLabel = useMemo(() => {
    if (mode === 'category' && activeCategory) return activeCategory;
    if (mode === 'search') return `"${searchInput}"`;
    return 'En direct maintenant';
  }, [mode, activeCategory, searchInput]);

  const streamCountLabel = useMemo(() => {
    if (streams.length <= 0) return 'Aucun stream chargé';
    return `${streams.length} stream${streams.length > 1 ? 's' : ''} chargé${streams.length > 1 ? 's' : ''}`;
  }, [streams.length]);

  return (
    <>
      <div className="top-bar">
        <div className="bar-main">
          <h1>
            <button className="logo-btn" onClick={switchToAll} aria-label="Home" type="button">
              Live Twitch
            </button>
          </h1>
        </div>
      </div>

      <div className="container">
        {/* ── Search bar ── */}
        <div className="card live-search-card">
          <form className="live-search-form" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              className="live-search-input"
              placeholder="Chercher par catégorie, mot-clé, chaîne..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Rechercher des lives"
            />
            <button type="submit" className="action-btn">
              Rechercher
            </button>
            {mode !== 'all' && (
              <button type="button" className="secondary-btn" onClick={switchToAll}>
                ✕ Réinitialiser
              </button>
            )}
          </form>

          {/* ── Top 5 categories ── */}
          {topCategories.length > 0 && (
            <div className="live-top-categories">
              <span className="live-cats-label">Populaires&nbsp;:</span>
              {topCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`live-cat-pill${activeCategory === cat.name ? ' active' : ''}`}
                  onClick={() =>
                    activeCategory === cat.name ? switchToAll() : switchToCategory(cat.name)
                  }
                  title={cat.name}
                >
                  {cat.boxArtURL && (
                    <img src={cat.boxArtURL} alt="" className="live-cat-pill-art" />
                  )}
                  <span>{cat.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Section header ── */}
        <div className="card live-intro-card">
          <h2>{headerLabel}</h2>
          {mode === 'all' && (
            <p className="card-subtitle">
              Flux dynamique classé par popularité, abonnements et fraîcheur du live.
            </p>
          )}
          <div className="live-count">{streamCountLabel}</div>
        </div>

        {isInitialLoading && <div className="status-line">Chargement des streams...</div>}
        {error && <div className="error-text">{error}</div>}

        {!isInitialLoading && !error && streams.length === 0 && (
          <div className="empty-state">{emptyStateMessage}</div>
        )}

        {!isInitialLoading && streams.length > 0 && (
          <div className="vod-grid">
            {streams.map((stream) => (
              <button
                key={stream.id}
                type="button"
                onClick={() =>
                  navigate(`/player?live=${encodeURIComponent(stream.broadcaster.login)}`)
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
                      <img
                        src={stream.broadcaster.profileImageURL}
                        alt={stream.broadcaster.displayName}
                      />
                    )}
                    <span>{stream.broadcaster.displayName}</span>
                  </div>
                  <h3 title={stream.title}>{stream.title}</h3>
                  <div className="vod-meta-row">
                    {stream.game?.name && (
                      <button
                        type="button"
                        className="meta-tag-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          switchToCategory(stream.game!.name);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            switchToCategory(stream.game!.name);
                          }
                        }}
                      >
                        {stream.game.name}
                      </button>
                    )}
                    <span className="live-viewers">{formatViewers(stream.viewerCount)}</span>
                  </div>
                  <div className="vod-date">Uptime: {formatUptime(stream.startedAt)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="live-load-sentinel" aria-hidden="true" />

        {!isInitialLoading && isLoadingMore && (
          <div className="status-line">Chargement de plus de streams...</div>
        )}
      </div>
    </>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiveStream, LiveStreamsPage, SubEntry } from '../../shared/types';

const PAGE_SIZE = 24;

type StreamWithScore = LiveStream & {
  __score: number;
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

  const fetchPage = useCallback(
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
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
        });
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

  useEffect(() => {
    const loadSubs = async () => {
      try {
        const settingsRes = await fetch('/api/settings');
        let oneSync = false;

        if (settingsRes.ok) {
          const settings = (await settingsRes.json()) as { oneSync?: boolean };
          oneSync = Boolean(settings.oneSync);
        }

        let subEntries: SubEntry[] = [];
        if (oneSync) {
          const subsRes = await fetch('/api/subs');
          if (subsRes.ok) {
            subEntries = (await subsRes.json()) as SubEntry[];
          }
        } else {
          const local = localStorage.getItem('nsv_subs');
          subEntries = local ? (JSON.parse(local) as SubEntry[]) || [] : [];
        }

        setSubLogins(new Set(subEntries.map((entry) => entry.login.toLowerCase())));
      } catch {
        setSubLogins(new Set());
      }
    };

    void loadSubs();
    void fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    setStreams((current) => rankStreams(current, subLogins));
  }, [subLogins]);

  useEffect(() => {
    if (!sentinelRef.current) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        if (isFetchingRef.current || !hasMore) return;
        void fetchPage(nextCursor);
      },
      {
        root: null,
        rootMargin: '520px 0px',
        threshold: 0.01,
      }
    );

    observerRef.current.observe(sentinelRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [fetchPage, hasMore, nextCursor]);

  const streamCountLabel = useMemo(() => {
    if (streams.length <= 0) return 'Live now on Twitch';
    return `${streams.length} stream${streams.length > 1 ? 's' : ''} loaded`;
  }, [streams.length]);

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
              Live Twitch
            </button>
          </h1>
        </div>
      </div>

      <div className="container">
        <div className="card live-intro-card">
          <h2>En direct maintenant</h2>
          <p className="card-subtitle">
            Flux dynamique classé par popularité, abonnements et fraîcheur du live.
          </p>
          <div className="live-count">{streamCountLabel}</div>
        </div>

        {isInitialLoading && <div className="status-line">Loading live streams...</div>}
        {error && <div className="error-text">{error}</div>}

        {!isInitialLoading && !error && streams.length === 0 && (
          <div className="empty-state">No live streams available right now.</div>
        )}

        {!isInitialLoading && streams.length > 0 && (
          <div className="vod-grid">
            {streams.map((stream) => (
              <div
                key={stream.id}
                onClick={() =>
                  navigate(`/player?live=${encodeURIComponent(stream.broadcaster.login)}`)
                }
                className="vod-card live-card"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/player?live=${encodeURIComponent(stream.broadcaster.login)}`);
                  }
                }}
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
                    <span>{stream.game?.name || 'No category'}</span>
                    <span className="live-viewers">{formatViewers(stream.viewerCount)}</span>
                  </div>
                  <div className="vod-date">Uptime: {formatUptime(stream.startedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="live-load-sentinel" aria-hidden="true" />

        {!isInitialLoading && isLoadingMore && (
          <div className="status-line">Loading more streams...</div>
        )}
      </div>
    </>
  );
}

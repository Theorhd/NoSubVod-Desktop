import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { HistoryEntry, LiveStream, LiveStreamsPage, VOD } from '../../../shared/types';

type CategoryVodPage = {
  items: VOD[];
  hasMore: boolean;
  nextCursor: string | null;
};

const MIN_VOD_DURATION_SECONDS = 210;

const filterShortVods = (vods: VOD[]): VOD[] =>
  vods.filter((vod) => (vod.lengthSeconds || 0) >= MIN_VOD_DURATION_SECONDS);

type UseChannelDataParams = Readonly<{
  user: string | null;
  category: string | null;
  categoryId: string | null;
}>;

export function useChannelData({ user, category, categoryId }: UseChannelDataParams) {
  const [vods, setVods] = useState<VOD[]>([]);
  const [liveStream, setLiveStream] = useState<LiveStream | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [catLiveStreams, setCatLiveStreams] = useState<LiveStream[]>([]);
  const [catLiveCursor, setCatLiveCursor] = useState<string | null>(null);
  const [catLiveHasMore, setCatLiveHasMore] = useState(false);
  const [catLiveLoading, setCatLiveLoading] = useState(false);
  const [catVodCursor, setCatVodCursor] = useState<string | null>(null);
  const [catVodHasMore, setCatVodHasMore] = useState(false);
  const [catVodLoading, setCatVodLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const isUserMode = Boolean(user);
  const isCategoryMode = !isUserMode && Boolean(category);

  const title = useMemo(() => {
    if (category) return category;
    if (user) return user;
    return 'VODs';
  }, [category, user]);

  const fetchData = useCallback(async () => {
    if (!isUserMode && !isCategoryMode) {
      setError('No channel or category specified');
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError('');

    try {
      if (isUserMode && user) {
        const [vodsData, liveData, historyData] = await Promise.all([
          fetch(`/api/user/${encodeURIComponent(user)}/vods`, { signal }).then((res) => {
            if (!res.ok) throw new Error('Failed to fetch VODs');
            return res.json();
          }),
          fetch(`/api/user/${encodeURIComponent(user)}/live`, { signal })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
          fetch('/api/history', { signal })
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({})),
        ]);

        if (signal.aborted) return;

        setVods(filterShortVods(vodsData as VOD[]));
        setLiveStream((liveData as LiveStream | null) || null);
        setHistory(historyData as Record<string, HistoryEntry>);
        setCatLiveStreams([]);
        setCatLiveCursor(null);
        setCatLiveHasMore(false);
        setCatVodCursor(null);
        setCatVodHasMore(false);
      } else if (isCategoryMode && category) {
        const categoryVodParams = new URLSearchParams({ name: category, limit: '24' });
        if (categoryId) categoryVodParams.set('id', categoryId);

        const [vodPage, livePage, historyData] = await Promise.all([
          fetch(`/api/search/category-vods?${categoryVodParams.toString()}`, { signal }).then(
            (res) => {
              if (!res.ok) throw new Error('Failed to fetch VODs');
              return res.json() as Promise<CategoryVodPage>;
            }
          ),
          fetch(`/api/live/category?name=${encodeURIComponent(category)}&limit=12`, { signal })
            .then((res) => (res.ok ? (res.json() as Promise<LiveStreamsPage>) : null))
            .catch(() => null),
          fetch('/api/history', { signal })
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({})),
        ]);

        if (signal.aborted) return;

        setVods(filterShortVods(vodPage.items || []));
        setCatVodCursor(vodPage.nextCursor || null);
        setCatVodHasMore(Boolean(vodPage.hasMore));
        if (livePage) {
          setCatLiveStreams(livePage.items || []);
          setCatLiveCursor(livePage.nextCursor || null);
          setCatLiveHasMore(Boolean(livePage.hasMore));
        } else {
          setCatLiveStreams([]);
          setCatLiveCursor(null);
          setCatLiveHasMore(false);
        }
        setLiveStream(null);
        setHistory(historyData as Record<string, HistoryEntry>);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [category, categoryId, isCategoryMode, isUserMode, user]);

  useEffect(() => {
    void fetchData();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchData]);

  const loadMoreCatVods = useCallback(async () => {
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
      // ignore load-more transient failures
    } finally {
      setCatVodLoading(false);
    }
  }, [catVodCursor, catVodHasMore, catVodLoading, category, categoryId]);

  const loadMoreCatLive = useCallback(async () => {
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
      // ignore load-more transient failures
    } finally {
      setCatLiveLoading(false);
    }
  }, [catLiveCursor, catLiveHasMore, catLiveLoading, category]);

  const addToWatchlist = useCallback(async (vod: VOD) => {
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
    } catch {
      // ignore watchlist failures
    }
  }, []);

  return {
    title,
    isUserMode,
    isCategoryMode,
    vods,
    liveStream,
    history,
    loading,
    error,
    catLiveStreams,
    catLiveHasMore,
    catLiveLoading,
    catVodHasMore,
    catVodLoading,
    loadMoreCatVods,
    loadMoreCatLive,
    addToWatchlist,
  };
}

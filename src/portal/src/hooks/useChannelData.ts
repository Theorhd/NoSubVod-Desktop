import { useCallback, useEffect, useMemo, useState } from 'react';
import { HistoryEntry, LiveStream, LiveStreamsPage, VOD } from '../../../shared/types';

type CategoryVodPage = {
  items: VOD[];
  hasMore: boolean;
  nextCursor: string | null;
};

const MIN_VOD_DURATION_SECONDS = 210;

function filterShortVods(vods: VOD[]): VOD[] {
  return vods.filter((vod) => (vod.lengthSeconds || 0) >= MIN_VOD_DURATION_SECONDS);
}

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

  const isUserMode = Boolean(user);
  const isCategoryMode = !isUserMode && Boolean(category);

  const title = useMemo(() => {
    if (category) return category;
    if (user) return user;
    return 'VODs';
  }, [category, user]);

  useEffect(() => {
    if (!isUserMode && !isCategoryMode) {
      setError('No channel or category specified');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    if (isUserMode && user) {
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
          setCatLiveStreams([]);
          setCatLiveCursor(null);
          setCatLiveHasMore(false);
          setCatVodCursor(null);
          setCatVodHasMore(false);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
      return;
    }

    if (isCategoryMode && category) {
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
          } else {
            setCatLiveStreams([]);
            setCatLiveCursor(null);
            setCatLiveHasMore(false);
          }
          setLiveStream(null);
          setHistory(historyData as Record<string, HistoryEntry>);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [category, categoryId, isCategoryMode, isUserMode, user]);

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

import { Router } from 'express';
import {
  generateMasterPlaylist,
  generateLiveMasterPlaylist,
  proxyVariantPlaylist,
  fetchUserInfo,
  fetchUserLiveStream,
  fetchLiveStatusByLogins,
  fetchUserVods,
  searchChannels,
  fetchTrendingVODs,
  searchGlobalContent,
  fetchGameVodsByName,
  fetchVodsByIds,
  fetchVideoChat,
  fetchVideoMarkers,
  fetchLiveStreams,
} from '../services/twitch.service';
import {
  getAllHistory,
  getHistoryByVodId,
  updateHistory,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getSettings,
  updateSettings,
  getSubs,
  addSub,
  removeSub,
} from '../services/history.service';

const router = Router();

// Video Data
router.get('/vod/:vodId/chat', async (req, res) => {
  try {
    const offset = Number.parseInt(req.query.offset as string, 10) || 0;
    const chatData = await fetchVideoChat(req.params.vodId, offset);
    res.json(chatData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vod/:vodId/markers', async (req, res) => {
  try {
    const markers = await fetchVideoMarkers(req.params.vodId);
    res.json(markers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Watchlist
router.get('/watchlist', (req, res) => {
  res.json(getWatchlist());
});

router.post('/watchlist', async (req, res) => {
  try {
    const list = await addToWatchlist(req.body);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/watchlist/:vodId', async (req, res) => {
  try {
    const list = await removeFromWatchlist(req.params.vodId);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Experience Settings
router.get('/settings', (req, res) => {
  res.json(getSettings());
});

router.post('/settings', async (req, res) => {
  try {
    const { oneSync } = req.body;

    if (oneSync !== undefined && typeof oneSync !== 'boolean') {
      res.status(400).json({ error: 'oneSync must be a boolean' });
      return;
    }

    const patch: { oneSync?: boolean } = {};
    if (typeof oneSync === 'boolean') {
      patch.oneSync = oneSync;
    }

    const settings = await updateSettings(patch);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Shared Subscriptions (for OneSync)
router.get('/subs', (req, res) => {
  res.json(getSubs());
});

router.post('/subs', async (req, res) => {
  try {
    const { login, displayName, profileImageURL } = req.body;
    if (!login || !displayName || !profileImageURL) {
      res.status(400).json({ error: 'Invalid sub payload' });
      return;
    }

    const updatedSubs = await addSub({
      login,
      displayName,
      profileImageURL,
    });
    res.json(updatedSubs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/subs/:login', async (req, res) => {
  try {
    const updatedSubs = await removeSub(req.params.login);
    res.json(updatedSubs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Search & Trends
router.get('/search/channels', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);
    const results = await searchChannels(q);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/search/global', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);
    const results = await searchGlobalContent(q);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/search/category-vods', async (req, res) => {
  try {
    const name = (req.query.name as string) || '';
    if (!name.trim()) {
      res.json([]);
      return;
    }

    const results = await fetchGameVodsByName(name.trim(), 36);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/trends', async (req, res) => {
  try {
    const results = await fetchTrendingVODs(getAllHistory(), getSubs());
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/live', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt((req.query.limit as string) || '', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.max(8, Math.min(requestedLimit, 48)) : 24;
    const cursor = ((req.query.cursor as string) || '').trim();

    const results = await fetchLiveStreams(limit, cursor || undefined);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/live/status', async (req, res) => {
  try {
    const rawLogins = ((req.query.logins as string) || '').trim();
    if (!rawLogins) {
      res.json({});
      return;
    }

    const logins = rawLogins
      .split(',')
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean);

    const result = await fetchLiveStatusByLogins(logins);
    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// History
router.get('/history', (req, res) => {
  res.json(getAllHistory());
});

router.get('/history/list', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt((req.query.limit as string) || '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 100))
      : undefined;

    const orderedHistory = Object.values(getAllHistory()).sort(
      (left, right) => right.updatedAt - left.updatedAt
    );
    const entries = typeof limit === 'number' ? orderedHistory.slice(0, limit) : orderedHistory;
    const metadata = await fetchVodsByIds(entries.map((entry) => entry.vodId));
    const byVodId = new Map(metadata.map((vod) => [vod.id, vod]));

    const enriched = entries.map((entry) => ({
      ...entry,
      vod: byVodId.get(entry.vodId) || null,
    }));

    res.json(enriched);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:vodId', (req, res) => {
  const entry = getHistoryByVodId(req.params.vodId);
  if (entry) {
    res.json(entry);
  } else {
    res.status(404).json({ error: 'History not found' });
  }
});

router.post('/history', async (req, res) => {
  const { vodId, timecode, duration } = req.body;
  if (!vodId || typeof timecode !== 'number') {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  try {
    const updated = await updateHistory(vodId, timecode, duration || 0);
    res.json(updated);
  } catch (err: any) {
    console.error('Error updating history:', err);
    res.status(500).json({ error: 'Failed to update history' });
  }
});

// Master Playlist generation
router.get('/vod/:vodId/master.m3u8', async (req, res) => {
  try {
    const vodId = req.params.vodId;
    const host = req.get('host') || 'localhost';

    const playlist = await generateMasterPlaylist(vodId, host);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
  } catch (err: any) {
    console.error(err);
    res.status(500).send('Error generating master playlist: ' + err.message);
  }
});

router.get('/live/:login/master.m3u8', async (req, res) => {
  try {
    const login = (req.params.login || '').trim().toLowerCase();
    if (!login) {
      res.status(400).send('Missing channel login');
      return;
    }

    const host = req.get('host') || 'localhost';
    const m3u8 = await generateLiveMasterPlaylist(login, host);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(m3u8);
  } catch (err: any) {
    console.error('Error generating live master playlist:', err);
    res.status(500).send('Failed to generate live playlist');
  }
});

// Variant Playlist proxying
router.get('/proxy/variant.m3u8', async (req, res) => {
  try {
    const proxyId = req.query.id as string;
    if (!proxyId) {
      res.status(400).send('Missing id parameter');
      return;
    }

    const modifiedVariant = await proxyVariantPlaylist(proxyId);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(modifiedVariant);
  } catch (err: any) {
    console.error(err);
    res.status(500).send('Error proxying variant: ' + err.message);
  }
});

// User Info
router.get('/user/:username', async (req, res) => {
  try {
    const user = await fetchUserInfo(req.params.username);
    res.json(user);
  } catch (err: any) {
    console.error(err);
    res.status(404).json({ error: err.message });
  }
});

// User VODs
router.get('/user/:username/vods', async (req, res) => {
  try {
    const vods = await fetchUserVods(req.params.username);
    res.json(vods);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/user/:username/live', async (req, res) => {
  try {
    const stream = await fetchUserLiveStream(req.params.username);
    res.json(stream);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

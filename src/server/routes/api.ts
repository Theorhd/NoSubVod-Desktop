import { Router } from 'express';
import {
  generateMasterPlaylist,
  proxyVariantPlaylist,
  fetchUserInfo,
  fetchUserVods,
  searchChannels,
  fetchTrendingVODs,
  searchGlobalContent,
  fetchVideoChat,
  fetchVideoMarkers,
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

router.get('/trends', async (req, res) => {
  try {
    const results = await fetchTrendingVODs(getAllHistory(), getSubs());
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// History
router.get('/history', (req, res) => {
  res.json(getAllHistory());
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

// Variant Playlist proxying
router.get('/proxy/variant.m3u8', async (req, res) => {
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).send('Missing url parameter');
      return;
    }

    const modifiedVariant = await proxyVariantPlaylist(targetUrl);
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

export default router;
